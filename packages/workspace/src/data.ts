import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type Collection, type DataKey, type DataRecord, type DataWho, type RulesContext, z } from "@humanharness/harness-sdk";
import { APP_SCOPE, dataFile, dataMetaFile, dataPath, isScopeDir } from "./layout";

export type DataErrorCode = "unknown-collection" | "refused" | "invalid" | "not-found" | "broken-file" | "no-scope";

/** A refused data request; its message goes back to whoever asked (the agent's tool error, the harness UI). */
export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

/** Who asks, and in which scope (the running task's for the agent; the open one for the person). */
export interface DataContext {
  who: DataWho;
  scope: string;
  action?: string;
}

export interface DataQuery {
  /** Equality (`{ state: "seen" }`) or membership (`{ id: { in: ["a", "b"] } }`) only (spec §4.4). */
  where?: Record<string, unknown>;
  /** The fields to return; the key always comes. */
  fields?: string[];
  limit?: number;
}

export interface DataQueryResult {
  records: DataRecord[];
  /** Matches before the limit. */
  total: number;
  /** Records in the file that fail the schema (a hand edit): skipped. */
  invalid: number;
}

export interface DataChange {
  collection: string;
  scope: string;
  who: DataWho;
  op: "put" | "patch" | "delete";
  key?: DataKey;
}

export const QUERY_LIMIT = 50;
export const QUERY_MAX = 200;

/** Rules slower than this are logged (spec §7.4: a synchronous function can't be stopped, only reported). */
export const RULES_SLOW_MS = 100;

interface Loaded {
  records: DataRecord[];
  invalid: number;
  /** Not JSON, or not the shape of the collection (an array, or one object for `single`). */
  broken: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isKey = (v: unknown): v is DataKey => (typeof v === "string" && v.length > 0) || (typeof v === "number" && Number.isFinite(v));
const issues = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");

function byKey(key: string) {
  return (a: DataRecord, b: DataRecord): number => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return x - y;
    const s = String(x);
    const t = String(y);
    return s < t ? -1 : s > t ? 1 : 0;
  };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * The harness's data (spec §4): one JSON file per collection and scope under `<base>/.harness/data/`. Nothing is
 * cached: every call reads the file again, so a hand edit is seen at once (§7.3). Writes are checked (permission,
 * schema, key, and from Task 19 the harness's rules), atomic, and one at a time.
 */
export class DataStore {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(change: DataChange) => void>();

  constructor(
    private readonly base: string,
    private readonly collections: Record<string, Collection>,
    private readonly opts: { now?: () => Date; log?: (message: string) => void; rulesSlowMs?: number } = {},
  ) {}

  /** Called after every write, from any writer (spec §4.5 `subscribe`). */
  onChange(listener: (change: DataChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  collection(name: string): Collection {
    if (!Object.hasOwn(this.collections, name)) throw new DataError("unknown-collection", `There is no collection "${name}"`);
    return this.collections[name];
  }

  /** The scope folder a request made in `scope` acts on: `_app` for app-wide collections. */
  scopeFor(name: string, scope: string): string {
    const c = this.collection(name);
    if (!isScopeDir(scope)) throw new DataError("invalid", `Invalid scope: "${scope}"`);
    if (!c.scoped) return APP_SCOPE;
    if (scope === APP_SCOPE) throw new DataError("no-scope", `"${name}" belongs to a scope: open one first`);
    return scope;
  }

  /** Every valid record of a collection in a scope folder, with no permission check (context, rules, diffs). */
  async readAll(name: string, scope: string): Promise<{ records: DataRecord[]; invalid: number }> {
    const { records, invalid } = await this.load(name, this.collection(name), scope);
    return { records, invalid };
  }

  async get(name: string, key: DataKey | undefined, ctx: DataContext): Promise<DataRecord | null> {
    const c = this.readable(name, ctx);
    const { records } = await this.load(name, c, this.scopeFor(name, ctx.scope));
    if (c.single) return records[0] ?? null;
    this.needKey(key);
    return records.find((r) => r[c.key!] === key) ?? null;
  }

  async query(name: string, q: DataQuery, ctx: DataContext): Promise<DataQueryResult> {
    const c = this.readable(name, ctx);
    const { records, invalid } = await this.load(name, c, this.scopeFor(name, ctx.scope));
    const where = Object.entries(q.where ?? {});
    const matches = records.filter((r) =>
      where.every(([field, cond]) => (isObject(cond) && Array.isArray(cond.in) ? cond.in.includes(r[field]) : r[field] === cond)),
    );
    const limit = Math.min(Math.max(1, Math.trunc(q.limit !== undefined && Number.isFinite(q.limit) ? q.limit : QUERY_LIMIT)), QUERY_MAX);
    const fields = q.fields?.length ? [...new Set([...(c.key ? [c.key] : []), ...q.fields])] : null;
    const pick = (r: DataRecord): DataRecord => (fields ? Object.fromEntries(fields.filter((f) => Object.hasOwn(r, f)).map((f) => [f, r[f]])) : r);
    return { records: matches.slice(0, limit).map(pick), total: matches.length, invalid };
  }

  /** Creates the record, or replaces the one with the same key (spec §4.3). */
  put(name: string, record: unknown, ctx: DataContext): Promise<DataRecord> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      const next = this.parse(name, c, record);
      const key = c.single ? undefined : this.keyOf(c, next);
      const file = await this.loadForWrite(name, c, scope);
      const prev = (c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key)) ?? null;
      await this.checkRules(name, c, scope, next, prev, ctx);
      const records = c.single ? [next] : [...file.records.filter((r) => r[c.key!] !== key), next];
      await this.save(name, c, scope, records);
      await this.touch(name, scope, key, true);
      this.emit({ collection: name, scope, who: ctx.who, op: "put", ...(key !== undefined ? { key } : {}) });
      return next;
    });
  }

  /**
   * Writes several records at once (an answer's `saveTo`, input-blocks spec §6). Each is checked like `put`
   * (permission, schema, key, rules) before the file is saved once: any refusal writes none. Two records with the
   * same key are refused. The rules run as for `put` calls in a row: `records(name)` holds the batch's earlier records.
   */
  putMany(name: string, records: unknown[], ctx: DataContext): Promise<DataRecord[]> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      if (c.single && records.length > 1) throw new DataError("invalid", `"${name}" holds one record`);
      const written = records.map((record) => {
        const next = this.parse(name, c, record);
        return { record: next, key: c.single ? undefined : this.keyOf(c, next) };
      });
      const keys = new Set<DataKey>();
      for (const { key } of written) {
        if (key === undefined) continue;
        if (keys.has(key)) throw new DataError("invalid", `Two records in "${name}" have the key "${key}"`);
        keys.add(key);
      }
      if (written.length === 0) return [];
      const file = await this.loadForWrite(name, c, scope);
      let current = file.records;
      // One snapshot for the whole batch; this collection's entry follows the batch.
      const snapshot = c.rules ? await this.rulesSnapshot(name, scope) : undefined;
      for (const { record: next, key } of written) {
        const prev = (c.single ? current[0] : current.find((r) => r[c.key!] === key)) ?? null;
        snapshot?.set(name, current);
        await this.checkRules(name, c, scope, next, prev, ctx, snapshot);
        current = c.single ? [next] : [...current.filter((r) => r[c.key!] !== key), next];
      }
      await this.save(name, c, scope, current);
      await this.touch(name, scope, written.map((w) => w.key), true);
      for (const { key } of written) this.emit({ collection: name, scope, who: ctx.who, op: "put", ...(key !== undefined ? { key } : {}) });
      return written.map((w) => w.record);
    });
  }

  /** Merges `patch` into the record with `key` (the one record of a `single` collection); the key can't change. */
  patch(name: string, key: DataKey | undefined, patch: unknown, ctx: DataContext): Promise<DataRecord> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      if (!isObject(patch)) throw new DataError("invalid", "A patch is an object of fields");
      if (!c.single) this.needKey(key);
      const file = await this.loadForWrite(name, c, scope);
      const prev = c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key);
      if (!prev) throw new DataError("not-found", c.single ? `"${name}" has no record yet` : `"${name}" has no record "${String(key)}"`);
      if (!c.single && Object.hasOwn(patch, c.key!) && patch[c.key!] !== key) throw new DataError("invalid", `The key "${c.key}" can't change`);
      const next = this.parse(name, c, { ...prev, ...patch });
      await this.checkRules(name, c, scope, next, prev, ctx);
      const records = c.single ? [next] : file.records.map((r) => (r[c.key!] === key ? next : r));
      await this.save(name, c, scope, records);
      await this.touch(name, scope, key, true);
      this.emit({ collection: name, scope, who: ctx.who, op: "patch", ...(key !== undefined && !c.single ? { key } : {}) });
      return next;
    });
  }

  /** False when there was no such record. Deleting a `single` collection's record removes its file. */
  delete(name: string, key: DataKey | undefined, ctx: DataContext): Promise<boolean> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      if (!c.single) this.needKey(key);
      const file = await this.loadForWrite(name, c, scope);
      const prev = c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key);
      if (!prev) return false;
      await this.checkRules(name, c, scope, null, prev, ctx);
      if (c.single) await fs.rm(dataFile(this.base, scope, name), { force: true });
      else await this.save(name, c, scope, file.records.filter((r) => r[c.key!] !== key));
      await this.touch(name, scope, c.single ? undefined : key, false);
      this.emit({ collection: name, scope, who: ctx.who, op: "delete", ...(key !== undefined && !c.single ? { key } : {}) });
      return true;
    });
  }

  /** When each record last changed, by key (`""` for a `single` record). Best effort: {} when unknown. */
  async changedAt(name: string, scope: string): Promise<Record<string, string>> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(dataMetaFile(this.base, scope, name), "utf8"));
      return isObject(raw) ? Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    } catch {
      return {};
    }
  }

  /** The agent reads every collection except `none` ones (spec §4.1). */
  private readable(name: string, ctx: DataContext): Collection {
    const c = this.collection(name);
    if (ctx.who === "agent" && c.agent === "none") throw new DataError("refused", `"${name}" is not available to the agent`);
    return c;
  }

  /** Checked first (spec §4.3, check 4): the agent writes only `write` collections. */
  private writable(name: string, ctx: DataContext): Collection {
    const c = this.collection(name);
    if (ctx.who === "agent" && c.agent !== "write") throw new DataError("refused", `The agent may not change "${name}": it is ${c.agent === "read" ? "read-only" : "hidden"} for the agent`);
    return c;
  }

  private parse(name: string, c: Collection, record: unknown): DataRecord {
    const parsed = c.schema.safeParse(record);
    if (!parsed.success) throw new DataError("invalid", `Not a valid "${name}" record: ${issues(parsed.error)}`);
    return parsed.data as DataRecord;
  }

  /** A keyed collection's get, patch and delete name their record. */
  private needKey(key: DataKey | undefined): asserts key is DataKey {
    if (key === undefined) throw new DataError("invalid", "A key is needed");
  }

  private keyOf(c: Collection, record: DataRecord): DataKey {
    const key = record[c.key!];
    if (!isKey(key)) throw new DataError("invalid", `The key "${c.key}" is missing`);
    return key;
  }

  /** What the rules of `name` see of every collection in `scope` (app-wide ones too); a broken file reads as empty. */
  private async rulesSnapshot(name: string, scope: string): Promise<Map<string, DataRecord[]>> {
    const snapshot = new Map<string, DataRecord[]>();
    for (const [other, oc] of Object.entries(this.collections)) {
      const folder = oc.scoped ? scope : APP_SCOPE;
      if (oc.scoped && scope === APP_SCOPE) {
        snapshot.set(other, []);
        continue;
      }
      const loaded = await this.load(other, oc, folder);
      if (loaded.broken) this.log(`${dataPath(folder, other)} is not valid JSON: the rules of "${name}" see "${other}" as empty`);
      snapshot.set(other, loaded.records);
    }
    return snapshot;
  }

  /**
   * Check 3 (spec §4.3): the harness's `rules`, a pure synchronous function. It gets copies: of the records, and
   * of the other collections in the same scope (app-wide ones too), read before it runs unless `snapshot` is given.
   */
  private async checkRules(
    name: string,
    c: Collection,
    scope: string,
    next: DataRecord | null,
    prev: DataRecord | null,
    ctx: DataContext,
    given?: Map<string, DataRecord[]>,
  ): Promise<void> {
    if (!c.rules) return;
    const snapshot = given ?? (await this.rulesSnapshot(name, scope));
    const rulesCtx: RulesContext = {
      ...(ctx.action !== undefined ? { action: ctx.action } : {}),
      scope,
      who: ctx.who,
      records: (other) => structuredClone(snapshot.get(other) ?? []),
    };
    const rules = c.rules;
    const started = performance.now();
    let verdict: unknown;
    try {
      verdict = rules(structuredClone(next), structuredClone(prev), rulesCtx);
    } catch (err) {
      throw new DataError("refused", `The rules of "${name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      const ms = performance.now() - started;
      if (ms > (this.opts.rulesSlowMs ?? RULES_SLOW_MS)) this.log(`The rules of "${name}" took ${Math.round(ms)} ms: keep them small and pure`);
    }
    if (verdict === true) return;
    if (typeof (verdict as { then?: unknown } | null)?.then === "function") {
      void Promise.resolve(verdict).catch(() => {});
      throw new DataError("refused", `The rules of "${name}" must be synchronous: return true or a message`);
    }
    throw new DataError("refused", typeof verdict === "string" && verdict.trim() ? verdict : `The rules of "${name}" refused the change`);
  }

  private async load(name: string, c: Collection, scope: string): Promise<Loaded> {
    let text: string;
    try {
      text = await fs.readFile(dataFile(this.base, scope, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], invalid: 0, broken: false };
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { records: [], invalid: 0, broken: true };
    }
    const list = c.single ? [raw] : Array.isArray(raw) ? raw : null;
    if (!list) return { records: [], invalid: 0, broken: true };
    const records: DataRecord[] = [];
    const seen = new Set<DataKey>();
    let invalid = 0;
    for (const item of list) {
      const parsed = c.schema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      const record = parsed.data as DataRecord;
      if (!c.single) {
        // A duplicate key (a hand edit) counts as invalid: the first record wins, and writes are refused until fixed.
        const key = record[c.key!];
        if (!isKey(key) || seen.has(key)) {
          invalid++;
          continue;
        }
        seen.add(key);
      }
      records.push(record);
    }
    return { records, invalid, broken: false };
  }

  /** A file a person broke by hand is never overwritten: they fix it, or go back in History (§7.3). */
  private async loadForWrite(name: string, c: Collection, scope: string): Promise<Loaded> {
    const file = await this.load(name, c, scope);
    if (file.broken || file.invalid > 0) {
      throw new DataError("broken-file", `${dataPath(scope, name)} was changed by hand and no longer matches "${name}": fix it, or go back in History`);
    }
    return file;
  }

  /** Sorted by key, two-space indented, one record per block, so history diffs stay readable (spec §4.2). */
  private async save(name: string, c: Collection, scope: string, records: DataRecord[]): Promise<void> {
    const value = c.single ? records[0] : [...records].sort(byKey(c.key!));
    await writeAtomic(dataFile(this.base, scope, name), `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Stamps (or forgets) when the records with `key` changed: one key, or a batch's keys in one write. */
  private async touch(name: string, scope: string, key: DataKey | undefined | (DataKey | undefined)[], changed: boolean): Promise<void> {
    try {
      const stamps = await this.changedAt(name, scope);
      const at = (this.opts.now?.() ?? new Date()).toISOString();
      for (const k of Array.isArray(key) ? key : [key]) {
        const id = k === undefined ? "" : String(k);
        if (changed) stamps[id] = at;
        else delete stamps[id];
      }
      await writeAtomic(dataMetaFile(this.base, scope, name), `${JSON.stringify(stamps)}\n`);
    } catch (err) {
      this.log(`Could not stamp the change in "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emit(change: DataChange): void {
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (err) {
        this.log(`A data listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private log(message: string): void {
    (this.opts.log ?? console.error)(message);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}

const key = z.union([z.string().min(1), z.number()]);
const fields = z.record(z.string(), z.unknown());

/** A request from the agent's tools (over the RPC socket) or the harness UI (over IPC). */
export const dataRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get"), collection: z.string(), key: key.optional() }),
  z.object({ op: z.literal("query"), collection: z.string(), where: fields.optional(), fields: z.array(z.string()).optional(), limit: z.number().optional() }),
  z.object({ op: z.literal("put"), collection: z.string(), record: fields }),
  z.object({ op: z.literal("patch"), collection: z.string(), key: key.optional(), patch: fields }),
  z.object({ op: z.literal("delete"), collection: z.string(), key: key.optional() }),
]);
export type DataRequest = z.output<typeof dataRequestSchema>;

export const isDataWrite = (request: unknown): boolean =>
  isObject(request) && (request.op === "put" || request.op === "patch" || request.op === "delete");

/** Runs one request against the store, as `ctx` (who asks, in which scope). */
export async function runDataRequest(store: DataStore, request: unknown, ctx: DataContext): Promise<unknown> {
  const parsed = dataRequestSchema.safeParse(request);
  if (!parsed.success) throw new DataError("invalid", `Not a data request: ${issues(parsed.error)}`);
  const r = parsed.data;
  switch (r.op) {
    case "get":
      return store.get(r.collection, r.key, ctx);
    case "query":
      return store.query(r.collection, { ...(r.where ? { where: r.where } : {}), ...(r.fields ? { fields: r.fields } : {}), ...(r.limit !== undefined ? { limit: r.limit } : {}) }, ctx);
    case "put":
      return store.put(r.collection, r.record, ctx);
    case "patch":
      return store.patch(r.collection, r.key, r.patch, ctx);
    case "delete":
      return store.delete(r.collection, r.key, ctx);
  }
}
