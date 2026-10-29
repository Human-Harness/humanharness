import { randomUUID } from "node:crypto";
import { type PluginManifest, execAllowed, secretRefs } from "@humanharness/harness-sdk";
import type { PluginSeverity } from "@humanharness/harness-sdk/plugin-backend";
import { type FetchRequest, pluginFetch } from "./plugin-fetch";
import { pluginExec, type runFile } from "./plugin-exec";

/**
 * The plugin broker (plugins spec §4.2; threat model B4, B6, B7, B9, B11): every `ctx` call of one plugin's backend
 * lands here, from code assumed hostile. One broker per plugin (and base), so its identity is never taken from the
 * call. A call needs a live run; its name must be one of BROKER_CALLS (nothing reaches the engine or the task manager:
 * B9); every argument's shape is checked here before any dependency sees it, and only what the approved manifest
 * declares goes through. A refusal is an answer, never a throw: the host script turns it into a "PluginRefused" error.
 */

export const BROKER_CALLS: ReadonlySet<string> = new Set([
  "fetch",
  "exec",
  "data.get",
  "data.query",
  "data.put",
  "data.patch",
  "data.delete",
  "data.replaceAll",
  "settings.get",
  "attention.raise",
  "attention.resolve",
  "chip.set",
  "chip.clear",
  "log",
]);

export type BrokerAnswer = { ok: true; value: unknown } | { ok: false; refused: string };

/** What a plugin may raise in the Attention inbox, checked and cleaned (Decision 12). */
export interface PluginAttentionInput {
  key: string;
  severity: PluginSeverity;
  title: string;
  body?: string;
  target?: { panel: string; focus?: string } | { action: string; vars?: Record<string, unknown> };
}

export type BrokerDataOp =
  | { op: "get" | "delete"; collection: string; key?: string | number }
  | { op: "query"; collection: string; query: { where?: Record<string, unknown>; fields?: string[]; limit?: number } }
  | { op: "put"; collection: string; record: Record<string, unknown> }
  | { op: "patch"; collection: string; key?: string | number; patch: Record<string, unknown> }
  | { op: "replaceAll"; collection: string; records: Record<string, unknown>[] };

export interface BrokerDeps {
  /** The approved manifest: the broker enforces nothing wider than it (B8 is the controller's). */
  manifest: PluginManifest;
  /** This plugin's own data in the current base (one PluginData per plugin and base). */
  data: { run(op: BrokerDataOp): Promise<unknown> };
  /** The stored values of `ids`, which are always declared ones. */
  secrets(ids: string[]): Promise<Record<string, string>>;
  settings(): Promise<Record<string, unknown>>;
  attention: { raise(item: PluginAttentionInput): Promise<void>; resolve(key: string): Promise<void> };
  chips(id: string, chip: { text: string; severity: PluginSeverity } | null): void;
  /**
   * The plugin's error log; may reject (a refused write), which the broker swallows. `message` is one line but uncut
   * (bounded by the call's `chars`): the receiver hides the keys, then cuts to `BROKER_LIMITS.logChars` — cutting
   * first could keep the start of a key, which then no longer reads as one (B6).
   */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  fetch: typeof fetch;
  /** An extra check of each fetch hop's host name (e.g. public addresses only). */
  allowHost?: (hostname: string) => Promise<boolean>;
  exec: { resolve(cmd: string): Promise<string | null>; run: typeof runFile; cwd(): Promise<string>; env(): Promise<Record<string, string>> };
  /**
   * Fixture mode (P10): the fetch and command runner of a run's source, in place of `fetch` and `exec.run`. Every check
   * above still applies first: hosts, https, exec patterns, key references and redaction.
   */
  transport?(source: string): { fetch: typeof fetch; run: typeof runFile };
}

export const BROKER_LIMITS = {
  inFlight: 16,
  concurrent: 4,
  logChars: 2000,
  titleChars: 120,
  bodyChars: 500,
  chipChars: 40,
  focusChars: 200,
  varsBytes: 4096,
  keyChars: 200,
  records: 2000,
  depth: 32,
  /** Per call, over all its arguments: values reached (a shared reference counts each time) and text characters. */
  nodes: 200_000,
  chars: 10 * 1024 * 1024,
  queryLimit: 1000,
} as const;

const SEVERITIES: readonly PluginSeverity[] = ["info", "warn", "action"];
const LEVELS = ["info", "warn", "error"] as const;
const ATTENTION_KEY = /^[A-Za-z0-9:._-]{1,80}$/;
/** C0 controls, DEL, C1 controls and the bidirectional overrides: never in a plugin's visible text. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const CONTROLS_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const ENDED = "This sync run has ended";

/** A refusal for a malformed call; the message names the problem, never the values. */
class Malformed extends Error {}
const fail = (message: string): never => {
  throw new Malformed(message);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * One budget for a whole call, checked before anything else looks at it. Structured clone (Electron IPC) keeps shared
 * references and cycles, so a small message can unfold into a huge walk: every value reached counts, each time it is
 * reached, and so does every string's and key's length. Only arrays and plain objects are walked (the shape checks
 * refuse anything else); the walk stops at the first value over the budget, so it is bounded whatever arrives.
 */
function checkBudget(args: unknown[]): void {
  const stack: unknown[] = [...args];
  let nodes = 0;
  let chars = 0;
  const over = () => fail("The call is too large");
  while (stack.length > 0) {
    const v = stack.pop();
    if (++nodes > BROKER_LIMITS.nodes) over();
    if (typeof v === "string") {
      if ((chars += v.length) > BROKER_LIMITS.chars) over();
      continue;
    }
    if (Array.isArray(v)) {
      // Everything on the stack will be counted, so a list that can't fit is refused before it is pushed.
      if (nodes + stack.length + v.length > BROKER_LIMITS.nodes) over();
      for (const item of v) stack.push(item);
      continue;
    }
    if (!isPlainObject(v)) continue;
    const keys = Object.keys(v);
    if (nodes + stack.length + keys.length > BROKER_LIMITS.nodes) over();
    for (const k of keys) {
      if ((chars += k.length) > BROKER_LIMITS.chars) over();
      stack.push(v[k]);
    }
  }
}

/**
 * Plain JSON data, bounded: null, booleans, finite numbers, strings, arrays and plain objects (undefined as a missing
 * value), at most BROKER_LIMITS.depth deep and .nodes values, no `__proto__` key. Iterative, so depth can't overflow.
 */
function checkJson(value: unknown, what: string): void {
  const stack: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (++nodes > BROKER_LIMITS.nodes) fail(`${what} is too large`);
    if (v === null || v === undefined || typeof v === "boolean" || typeof v === "string") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(`${what} holds a number that is not finite`);
      continue;
    }
    if (depth >= BROKER_LIMITS.depth) fail(`${what} is nested too deep`);
    if (Array.isArray(v)) {
      for (const item of v) stack.push([item, depth + 1]);
      continue;
    }
    if (!isPlainObject(v)) fail(`${what} is not plain JSON data`);
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      if (k === "__proto__") fail(`${what} has a key that is not allowed`);
      stack.push([item, depth + 1]);
    }
  }
}

function record(v: unknown, what = "A record"): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`${what} is an object`);
  checkJson(v, what);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== "string" || v.length > max) fail(`${what} is text of at most ${max} characters`);
  return v as string;
}

function dataKey(v: unknown): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length <= BROKER_LIMITS.keyChars) return v;
  return fail("A key is text or a number");
}

/** Visible text: controls removed (newlines kept only where asked), trimmed, within `max` and not empty unless allowed. */
function visible(v: unknown, what: string, max: number, o: { newlines?: boolean; optional?: boolean } = {}): string {
  if (typeof v !== "string" || v.length > max * 4) fail(`${what} is text`);
  const text = (v as string).replace(o.newlines ? CONTROLS_BUT_NEWLINE : CONTROLS, "").trim();
  if (text.length > max) fail(`${what} is at most ${max} characters`);
  if (text === "" && !o.optional) fail(`${what} is empty`);
  return text;
}

function onlyKeys(v: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${what} has an unknown field`);
}

/** A counting semaphore: at most `n` holders, the rest wait in order. */
class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];
  constructor(n: number) {
    this.free = n;
  }
  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((r) => this.waiting.push(r));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    };
  }
}

interface Run {
  source: string;
  controller: AbortController;
  writes: number;
}

type Handler = (run: Run, args: unknown[]) => Promise<BrokerAnswer>;

export class PluginBroker {
  private readonly runs = new Map<string, Run>();
  private inFlight = 0;
  private readonly slots = new Slots(BROKER_LIMITS.concurrent);
  private readonly handlers: ReadonlyMap<string, { max: number; fn: Handler }>;

  constructor(private readonly d: BrokerDeps) {
    const m = d.manifest;
    const collection = (v: unknown): string => {
      if (typeof v !== "string" || !Object.hasOwn(m.data, v)) fail("The collection is not declared in plugin.json data");
      return v as string;
    };
    const data = (op: BrokerDataOp, run: Run, write: boolean) => this.data(op, run, write);
    this.handlers = new Map<string, { max: number; fn: Handler }>([
      ["fetch", { max: 2, fn: (run, [url, init]) => this.fetch(run, url, init) }],
      ["exec", { max: 2, fn: (run, [cmd, args]) => this.exec(run, cmd, args) }],
      ["data.get", { max: 2, fn: (run, [c, key]) => data(withKey({ op: "get", collection: collection(c) }, dataKey(key)), run, false) }],
      ["data.query", { max: 2, fn: (run, [c, q]) => data({ op: "query", collection: collection(c), query: query(q) }, run, false) }],
      ["data.put", { max: 2, fn: (run, [c, r]) => data({ op: "put", collection: collection(c), record: record(r) }, run, true) }],
      [
        "data.patch",
        { max: 3, fn: (run, [c, key, p]) => data(withKey({ op: "patch", collection: collection(c), patch: record(p, "A patch") }, dataKey(key)), run, true) },
      ],
      ["data.delete", { max: 2, fn: (run, [c, key]) => data(withKey({ op: "delete", collection: collection(c) }, dataKey(key)), run, true) }],
      ["data.replaceAll", { max: 2, fn: (run, [c, rs]) => data({ op: "replaceAll", collection: collection(c), records: records(rs) }, run, true) }],
      ["settings.get", { max: 0, fn: async () => ({ ok: true, value: await d.settings() }) }],
      ["attention.raise", { max: 1, fn: async (_run, [item]) => ok(await d.attention.raise(this.attentionItem(item))) }],
      ["attention.resolve", { max: 1, fn: async (_run, [key]) => ok(await d.attention.resolve(attentionKey(key))) }],
      ["chip.set", { max: 2, fn: async (_run, [id, chip]) => ok(d.chips(this.chipId(id), chipValue(chip))) }],
      ["chip.clear", { max: 1, fn: async (_run, [id]) => ok(d.chips(this.chipId(id), null)) }],
      ["log", { max: 2, fn: async (_run, [level, message]) => ok(await this.log(logLevel(level), oneLine(message))) }],
    ]);
  }

  /** A run of a declared source: its id is what every `ctx` call must carry. */
  startRun(source: string): { id: string; signal: AbortSignal } {
    if (!this.d.manifest.sources.some((s) => s.id === source)) throw new Error(`The source ${String(source)} is not declared`);
    const id = randomUUID();
    const controller = new AbortController();
    this.runs.set(id, { source, controller, writes: 0 });
    return { id, signal: controller.signal };
  }

  /** Ends a run: its id dies, its in-flight fetches and commands abort. */
  endRun(id: string): { writes: number } {
    const run = this.runs.get(id);
    if (!run) return { writes: 0 };
    this.runs.delete(id);
    run.controller.abort();
    return { writes: run.writes };
  }

  killAll(): void {
    for (const id of [...this.runs.keys()]) this.endRun(id);
  }

  async call(runId: unknown, name: unknown, args: unknown): Promise<BrokerAnswer> {
    const run = typeof runId === "string" ? this.runs.get(runId) : undefined;
    if (!run) return { ok: false, refused: ENDED };
    if (this.inFlight >= BROKER_LIMITS.inFlight) return { ok: false, refused: `Too many calls at once (at most ${BROKER_LIMITS.inFlight})` };
    this.inFlight += 1;
    try {
      const handler = typeof name === "string" && BROKER_CALLS.has(name) ? this.handlers.get(name) : undefined;
      if (!handler) return await this.refuseMalformed(String(typeof name === "string" ? name : typeof name).slice(0, 40), "Unknown call");
      if (!Array.isArray(args) || args.length > handler.max) return await this.refuseMalformed(name as string, "Wrong arguments");
      try {
        const list = [...args];
        checkBudget(list);
        return await handler.fn(run, list);
      } catch (err) {
        if (err instanceof Malformed) return await this.refuseMalformed(name as string, err.message);
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, refused: message.slice(0, 500) || "Refused" };
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  /** A malformed call: refused and logged as a warning with the call's name and the reason, never its arguments. */
  private async refuseMalformed(name: string, reason: string): Promise<BrokerAnswer> {
    await this.log("warn", oneLine(`${name}: ${reason}`));
    return { ok: false, refused: `${reason} (${name})` };
  }

  private async log(level: (typeof LEVELS)[number], message: string): Promise<void> {
    await this.d.log(level, message).catch(() => undefined);
  }

  private async data(op: BrokerDataOp, run: Run, write: boolean): Promise<BrokerAnswer> {
    const value = await this.d.data.run(op);
    if (write) run.writes += 1;
    return { ok: true, value: value ?? null };
  }

  /** Waits for one of the plugin's fetch/exec slots, then runs `fn` only if the run is still live. */
  private async limited<T>(run: Run, fn: () => Promise<T>): Promise<T | BrokerAnswer> {
    const release = await this.slots.acquire();
    try {
      if (run.controller.signal.aborted) return { ok: false, refused: ENDED };
      return await fn();
    } finally {
      release();
    }
  }

  private async fetch(run: Run, url: unknown, init: unknown): Promise<BrokerAnswer> {
    const req = fetchRequest(url, init);
    // Only declared keys are ever asked for; a reference to any other is refused before the store is read (B6).
    const texts = [...Object.values(req.init?.headers ?? {}), req.init?.body ?? ""];
    const ids = [...new Set(texts.flatMap(secretRefs))];
    const declared = new Set(this.d.manifest.permissions.secrets.map((s) => s.id));
    const undeclared = ids.find((id) => !declared.has(id));
    if (undeclared !== undefined) return { ok: false, refused: `The key "${undeclared}" is not declared in permissions.secrets` };
    return this.limited(run, async () => {
      const stored = ids.length > 0 ? await this.d.secrets(ids) : {};
      // Only the asked ids, whatever the store gave back.
      const secrets = Object.fromEntries(ids.filter((id) => Object.hasOwn(stored, id) && typeof stored[id] === "string").map((id) => [id, stored[id]]));
      const out = await pluginFetch(req, {
        hosts: this.d.manifest.permissions.hosts,
        secrets,
        fetch: this.transportOf(run).fetch,
        signal: run.controller.signal,
        ...(this.d.allowHost ? { allowHost: this.d.allowHost } : {}),
      });
      return out.ok ? { ok: true, value: out.response } : { ok: false, refused: out.reason };
    });
  }

  /** The live fetch and runner, or the run's source's transport in fixture mode. */
  private transportOf(run: Run): { fetch: typeof fetch; run: typeof runFile } {
    return this.d.transport?.(run.source) ?? { fetch: this.d.fetch, run: this.d.exec.run };
  }

  private async exec(run: Run, cmd: unknown, args: unknown): Promise<BrokerAnswer> {
    const c = str(cmd, "A command", 64);
    if (!Array.isArray(args) || args.length > 256 || !args.every((a) => typeof a === "string" && a.length <= 4096)) fail("A command's arguments are a list of text");
    const list = [...(args as string[])];
    const patterns = this.d.manifest.permissions.exec;
    // Checked before the folder and the env are made, so a refused command costs nothing.
    if (!execAllowed(c, list, patterns)) return { ok: false, refused: `${[c, ...list].join(" ").slice(0, 200)} is not declared in permissions.exec` };
    return this.limited(run, async () => {
      const out = await pluginExec(c, list, {
        patterns,
        resolve: this.d.exec.resolve,
        run: this.transportOf(run).run,
        cwd: await this.d.exec.cwd(),
        env: await this.d.exec.env(),
        signal: run.controller.signal,
      });
      return out.ok ? { ok: true, value: out.result } : { ok: false, refused: out.reason };
    });
  }

  private attentionItem(v: unknown): PluginAttentionInput {
    if (!isPlainObject(v)) fail("An attention item is an object");
    const item = v as Record<string, unknown>;
    onlyKeys(item, ["key", "severity", "title", "body", "target"], "An attention item");
    const out: PluginAttentionInput = {
      key: attentionKey(item.key),
      severity: severity(item.severity),
      title: visible(item.title, "A title", BROKER_LIMITS.titleChars),
    };
    if (item.body !== undefined) {
      const body = visible(item.body, "A body", BROKER_LIMITS.bodyChars, { newlines: true, optional: true });
      if (body !== "") out.body = body;
    }
    if (item.target !== undefined) out.target = this.target(item.target);
    return out;
  }

  private target(v: unknown): NonNullable<PluginAttentionInput["target"]> {
    if (!isPlainObject(v)) fail("A target is an object");
    const t = v as Record<string, unknown>;
    if (t.panel !== undefined) {
      onlyKeys(t, ["panel", "focus"], "A target");
      if (typeof t.panel !== "string" || !this.d.manifest.panels.some((p) => p.id === t.panel)) fail("The panel is not declared in plugin.json panels");
      const focus = t.focus === undefined ? undefined : str(t.focus, "A focus", BROKER_LIMITS.focusChars);
      return focus === undefined ? { panel: t.panel as string } : { panel: t.panel as string, focus };
    }
    onlyKeys(t, ["action", "vars"], "A target");
    if (typeof t.action !== "string" || !this.d.manifest.actions.some((a) => a.id === t.action)) fail("The action is not declared in plugin.json actions");
    if (t.vars === undefined) return { action: t.action as string };
    const vars = record(t.vars, "An action's vars");
    if (Buffer.byteLength(JSON.stringify(vars), "utf8") > BROKER_LIMITS.varsBytes) fail("An action's vars are at most 4 KB");
    return { action: t.action as string, vars };
  }

  private chipId(v: unknown): string {
    if (typeof v !== "string" || !this.d.manifest.chips.some((c) => c.id === v)) fail("The chip is not declared in plugin.json chips");
    return v as string;
  }
}

const ok = (_: unknown): BrokerAnswer => ({ ok: true, value: null });

function withKey<T extends object>(op: T, key: string | number | undefined): T & { key?: string | number } {
  return key === undefined ? op : { ...op, key };
}

function query(v: unknown): { where?: Record<string, unknown>; fields?: string[]; limit?: number } {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) fail("A query is an object");
  const q = v as Record<string, unknown>;
  onlyKeys(q, ["where", "fields", "limit"], "A query");
  const out: { where?: Record<string, unknown>; fields?: string[]; limit?: number } = {};
  if (q.where !== undefined) out.where = record(q.where, "A query's where");
  if (q.fields !== undefined) {
    if (!Array.isArray(q.fields) || q.fields.length > 100 || !q.fields.every((f) => typeof f === "string" && f.length <= 100)) fail("A query's fields are a list of names");
    out.fields = [...(q.fields as string[])];
  }
  if (q.limit !== undefined) {
    if (typeof q.limit !== "number" || !Number.isFinite(q.limit)) fail("A query's limit is a number");
    out.limit = Math.min(Math.max(Math.trunc(q.limit as number), 1), BROKER_LIMITS.queryLimit);
  }
  return out;
}

function records(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length > BROKER_LIMITS.records) fail(`Records are a list of at most ${BROKER_LIMITS.records}`);
  return (v as unknown[]).map((r) => record(r));
}

function fetchRequest(url: unknown, init: unknown): FetchRequest {
  const u = str(url, "A URL", 8192);
  if (init === undefined || init === null) return { url: u };
  if (!isPlainObject(init)) fail("fetch's options are an object");
  const i = init as Record<string, unknown>;
  onlyKeys(i, ["method", "headers", "body"], "fetch's options");
  const out: NonNullable<FetchRequest["init"]> = {};
  if (i.method !== undefined) out.method = str(i.method, "A method", 16);
  if (i.body !== undefined) out.body = str(i.body, "A body", 1024 * 1024);
  if (i.headers !== undefined) {
    if (!isPlainObject(i.headers)) fail("Headers are an object of text");
    const entries = Object.entries(i.headers as Record<string, unknown>);
    if (entries.length > 50 || !entries.every(([k, val]) => k.length <= 256 && typeof val === "string" && val.length <= 8192)) fail("Headers are at most 50 names with text values");
    // fromEntries: a header named __proto__ stays a plain property.
    out.headers = Object.fromEntries(entries as [string, string][]);
  }
  return { url: u, init: out };
}

function attentionKey(v: unknown): string {
  if (typeof v !== "string" || !ATTENTION_KEY.test(v)) fail("An attention key is 1–80 letters, digits or : . _ -");
  return v as string;
}

function severity(v: unknown): PluginSeverity {
  if (typeof v !== "string" || !(SEVERITIES as readonly string[]).includes(v)) fail("A severity is info, warn or action");
  return v as PluginSeverity;
}

function chipValue(v: unknown): { text: string; severity: PluginSeverity } {
  if (!isPlainObject(v)) fail("A chip is an object");
  const c = v as Record<string, unknown>;
  onlyKeys(c, ["text", "severity"], "A chip");
  return { text: visible(c.text, "A chip's text", BROKER_LIMITS.chipChars), severity: c.severity === undefined ? "info" : severity(c.severity) };
}

function logLevel(v: unknown): (typeof LEVELS)[number] {
  if (typeof v !== "string" || !(LEVELS as readonly string[]).includes(v)) fail("A log level is info, warn or error");
  return v as (typeof LEVELS)[number];
}

/** One log line: controls become spaces. Not cut: the log dep hides keys first (see BrokerDeps.log). */
function oneLine(v: unknown): string {
  if (typeof v !== "string") fail("A log message is text");
  return (v as string).replace(CONTROLS, " ").replace(/ {2,}/g, " ").trim();
}
