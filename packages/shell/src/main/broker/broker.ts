import { randomUUID } from "node:crypto";
import { type PluginPermissions, execAllowed, secretRefs } from "@humanharness/harness-sdk";
import { pluginExec, type runFile } from "../plugin-exec";
import { pluginFetch } from "../plugin-fetch";
import { BROKER_LIMITS, Malformed, Slots, checkBudget, dataKey, fail, fetchRequest, oneLine, query, record, records, str, withKey } from "./broker-checks";

/**
 * The core broker (tools spec §4.2, D7): every `ctx` call of sandboxed code (a plugin's backend; a tool from slice 2)
 * lands here, from code assumed hostile. One Broker per caller identity, built by its owner with what that caller may
 * reach (`BrokerGrant`): the broker never takes an identity or a permission from the call. A call needs a live run; its
 * name must be one of the caller's `calls` (nothing reaches the engine or the task manager: B9); every argument's shape
 * is checked here before any dependency sees it, and only what the grant names goes through. A refusal is an answer,
 * never a throw.
 */

type ExecPattern = PluginPermissions["exec"][number];

/** The generic calls. An owner passes the subset its callers get, plus its own handlers (`extra`). */
export const CORE_CALLS: ReadonlySet<string> = new Set(["fetch", "exec", "data.get", "data.query", "data.put", "data.patch", "data.delete", "data.replaceAll", "log"]);

export type BrokerAnswer = { ok: true; value: unknown } | { ok: false; refused: string };

export type BrokerDataOp =
  | { op: "get" | "delete"; collection: string; key?: string | number }
  | { op: "query"; collection: string; query: { where?: Record<string, unknown>; fields?: string[]; limit?: number } }
  | { op: "put"; collection: string; record: Record<string, unknown> }
  | { op: "patch"; collection: string; key?: string | number; patch: Record<string, unknown> }
  | { op: "replaceAll"; collection: string; records: Record<string, unknown>[] };

/** What one caller may reach, and how a refusal names where it would have to be declared. */
export interface BrokerGrant {
  hosts: readonly string[];
  /** Secret ids the caller may name as `{{secret:<id>}}`. Only these are ever asked of `secrets`. */
  secrets: readonly string[];
  exec: readonly ExecPattern[];
  /** May the caller name `collection` (for a write when `write`)? Must be own-property safe (`Object.hasOwn`). */
  collection(name: string, write: boolean): boolean;
  refusals: { collection: string; secret(id: string): string; exec(line: string): string };
}

/** One live run of a caller: what its calls carry. `key` is the owner's (a plugin's source; a tool call's id). */
export interface BrokerRun {
  key: string;
  controller: AbortController;
  writes: number;
}

export type BrokerHandler = (run: BrokerRun, args: unknown[]) => Promise<BrokerAnswer>;

export interface CoreBrokerDeps {
  grant: BrokerGrant;
  /** The calls this caller gets: core ones from CORE_CALLS and the owner's `extra` names. */
  calls: readonly string[];
  extra?: ReadonlyMap<string, { max: number; fn: BrokerHandler }>;
  /** The caller's own data (for a plugin: one PluginData per plugin and base). */
  data: { run(op: BrokerDataOp): Promise<unknown> };
  /** The stored values of `ids`, which are always granted ones. */
  secrets(ids: string[]): Promise<Record<string, string>>;
  /**
   * The caller's error log; may reject (a refused write), which the broker swallows. `message` is one line but uncut
   * (bounded by the call's `chars`): the receiver hides the keys, then cuts to `BROKER_LIMITS.logChars` — cutting
   * first could keep the start of a key, which then no longer reads as one (B6).
   */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  fetch: typeof fetch;
  /** An extra check of each fetch hop's host name (e.g. public addresses only). */
  allowHost?: (hostname: string) => Promise<boolean>;
  exec: { resolve(cmd: string): Promise<string | null>; run: typeof runFile; cwd(): Promise<string>; env(): Promise<Record<string, string>> };
  /**
   * Fixture or mock mode (P10): the fetch and command runner of a run's key, in place of `fetch` and `exec.run`. Every
   * check still applies first: hosts, https, exec patterns, key references and redaction.
   */
  transport?(key: string): { fetch: typeof fetch; run: typeof runFile };
  /** What a dead run's call answers ("This sync run has ended" for plugins). */
  ended: string;
}

const LEVELS = ["info", "warn", "error"] as const;

export class Broker {
  private readonly runs = new Map<string, BrokerRun>();
  private inFlight = 0;
  private readonly slots = new Slots(BROKER_LIMITS.concurrent);
  private readonly handlers: ReadonlyMap<string, { max: number; fn: BrokerHandler }>;

  constructor(private readonly d: CoreBrokerDeps) {
    const collection = (v: unknown, write: boolean): string => {
      if (typeof v !== "string" || !d.grant.collection(v, write)) fail(d.grant.refusals.collection);
      return v as string;
    };
    const data = (op: BrokerDataOp, run: BrokerRun, write: boolean) => this.data(op, run, write);
    const core: [string, { max: number; fn: BrokerHandler }][] = [
      ["fetch", { max: 2, fn: (run, [url, init]) => this.fetch(run, url, init) }],
      ["exec", { max: 2, fn: (run, [cmd, args]) => this.exec(run, cmd, args) }],
      ["data.get", { max: 2, fn: (run, [c, key]) => data(withKey({ op: "get", collection: collection(c, false) }, dataKey(key)), run, false) }],
      ["data.query", { max: 2, fn: (run, [c, q]) => data({ op: "query", collection: collection(c, false), query: query(q) }, run, false) }],
      ["data.put", { max: 2, fn: (run, [c, r]) => data({ op: "put", collection: collection(c, true), record: record(r) }, run, true) }],
      [
        "data.patch",
        {
          max: 3,
          fn: (run, [c, key, p]) => data(withKey({ op: "patch", collection: collection(c, true), patch: record(p, "A patch") }, dataKey(key)), run, true),
        },
      ],
      ["data.delete", { max: 2, fn: (run, [c, key]) => data(withKey({ op: "delete", collection: collection(c, true) }, dataKey(key)), run, true) }],
      ["data.replaceAll", { max: 2, fn: (run, [c, rs]) => data({ op: "replaceAll", collection: collection(c, true), records: records(rs) }, run, true) }],
      ["log", { max: 2, fn: async (_run, [level, message]) => ok(await this.log(logLevel(level), oneLine(message))) }],
    ];
    this.handlers = new Map([...core, ...(d.extra ?? [])].filter(([name]) => d.calls.includes(name)));
  }

  /** A run of the caller: its id is what every `ctx` call must carry. The owner checks `key` before calling. */
  startRun(key: string): { id: string; signal: AbortSignal } {
    const id = randomUUID();
    const controller = new AbortController();
    this.runs.set(id, { key, controller, writes: 0 });
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
    if (!run) return { ok: false, refused: this.d.ended };
    if (this.inFlight >= BROKER_LIMITS.inFlight) return { ok: false, refused: `Too many calls at once (at most ${BROKER_LIMITS.inFlight})` };
    this.inFlight += 1;
    try {
      const handler = typeof name === "string" ? this.handlers.get(name) : undefined;
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

  private async data(op: BrokerDataOp, run: BrokerRun, write: boolean): Promise<BrokerAnswer> {
    const value = await this.d.data.run(op);
    if (write) run.writes += 1;
    return { ok: true, value: value ?? null };
  }

  /** Waits for one of the caller's fetch/exec slots, then runs `fn` only if the run is still live. */
  private async limited<T>(run: BrokerRun, fn: () => Promise<T>): Promise<T | BrokerAnswer> {
    const release = await this.slots.acquire();
    try {
      if (run.controller.signal.aborted) return { ok: false, refused: this.d.ended };
      return await fn();
    } finally {
      release();
    }
  }

  private async fetch(run: BrokerRun, url: unknown, init: unknown): Promise<BrokerAnswer> {
    const req = fetchRequest(url, init);
    // Only granted keys are ever asked for; a reference to any other is refused before the store is read (B6).
    const texts = [...Object.values(req.init?.headers ?? {}), req.init?.body ?? ""];
    const ids = [...new Set(texts.flatMap(secretRefs))];
    const declared = new Set(this.d.grant.secrets);
    const undeclared = ids.find((id) => !declared.has(id));
    if (undeclared !== undefined) return { ok: false, refused: this.d.grant.refusals.secret(undeclared) };
    return this.limited(run, async () => {
      const stored = ids.length > 0 ? await this.d.secrets(ids) : {};
      // Only the asked ids, whatever the store gave back.
      const secrets = Object.fromEntries(ids.filter((id) => Object.hasOwn(stored, id) && typeof stored[id] === "string").map((id) => [id, stored[id]]));
      const out = await pluginFetch(req, {
        hosts: this.d.grant.hosts,
        secrets,
        fetch: this.transportOf(run).fetch,
        signal: run.controller.signal,
        ...(this.d.allowHost ? { allowHost: this.d.allowHost } : {}),
      });
      return out.ok ? { ok: true, value: out.response } : { ok: false, refused: out.reason };
    });
  }

  /** The live fetch and runner, or the run's key's transport in fixture mode. */
  private transportOf(run: BrokerRun): { fetch: typeof fetch; run: typeof runFile } {
    return this.d.transport?.(run.key) ?? { fetch: this.d.fetch, run: this.d.exec.run };
  }

  private async exec(run: BrokerRun, cmd: unknown, args: unknown): Promise<BrokerAnswer> {
    const c = str(cmd, "A command", 64);
    if (!Array.isArray(args) || args.length > 256 || !args.every((a) => typeof a === "string" && a.length <= 4096)) fail("A command's arguments are a list of text");
    const list = [...(args as string[])];
    const patterns = [...this.d.grant.exec];
    // Checked before the folder and the env are made, so a refused command costs nothing.
    if (!execAllowed(c, list, patterns)) return { ok: false, refused: this.d.grant.refusals.exec([c, ...list].join(" ").slice(0, 200)) };
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
}

const ok = (_: unknown): BrokerAnswer => ({ ok: true, value: null });

function logLevel(v: unknown): (typeof LEVELS)[number] {
  if (typeof v !== "string" || !(LEVELS as readonly string[]).includes(v)) fail("A log level is info, warn or error");
  return v as (typeof LEVELS)[number];
}
