import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { type HarnessSecret, SECRETS_MAX, type ToolMeta, redact } from "@humanharness/harness-sdk";
import { Broker, type BrokerAnswer, type BrokerDataOp, type BrokerHandler, type BrokerRun, type CoreBrokerDeps } from "../broker/broker";
import { CONTROLS, oneLine, str } from "../broker/broker-checks";
import type { runFile } from "../plugin-exec";
import type { SecretStore } from "../secrets/secret-store";
import { missingSecretMessage } from "../secrets/connections";
import { ToolFileRefused, type ToolFiles } from "./tool-files";

/**
 * A tool's `ctx` in main (tools spec §4.2, D7; threat rows T3, T4, T8): one core Broker per tool, its grant built from
 * the tool's `uses` and nothing else. Each call of the tool is one run (`startCall`) that carries the caller's scope;
 * the host's `ctx` calls name that run's id, which main made, so a tool can't reach another call's scope or another
 * tool's grant. Every allowed and refused access of a run is kept for its trace entry: a kind and a target (a URL, a
 * command line, "<op> <collection>", a path), never a header, a body or a key.
 */

/** The calls a tool's ctx makes (tools spec §4.2, slice 2: no inputs, requestAi or summary yet). */
export const TOOL_CALLS: readonly string[] = ["fetch", "exec", "data.get", "data.query", "data.put", "data.patch", "data.delete", "files.read", "files.list", "scope", "log"];

export interface TraceAccess {
  kind: "fetch" | "exec" | "data" | "files";
  target: string;
  allowed: boolean;
}

/** A `ctx.log` line as a call's trace entry keeps it (spec §4.2); the registry hides the stored keys, then cuts. */
export interface TraceLog {
  level: "info" | "warn" | "error";
  message: string;
}

/**
 * `logs`: the `ctx.log` lines kept per call (the first ones); `logLook`: how much of each line is kept for the
 * registry, which hides the keys in it before its own cut.
 */
export const TOOL_BROKER_LIMITS = { targetChars: 200, accesses: 200, logs: 20, logLook: 16_384 } as const;

export interface ToolBrokerDeps {
  harnessId: string;
  tool: string;
  meta: ToolMeta;
  /** The manifest's secrets: their labels for the missing-key message. */
  secrets: readonly HarnessSecret[];
  /** Read at every fetch that names a key: a connect step marked done is never taken as the key being there. */
  store: Pick<SecretStore, "harnessValues">;
  /** The person-side data path, as the tool (`who: "tool"`, `tool`), in the call's scope. */
  data(op: BrokerDataOp, ctx: { who: "tool"; tool: string; scope: string | null }): Promise<unknown>;
  /** The person's folder and its references as the call's scope sees them. */
  files(scope: string | null): Promise<ToolFiles>;
  fetch: typeof fetch;
  /**
   * Each fetch hop's host name may be reached (public addresses only: `isPublicHost`). Required: a tool never reaches
   * this computer or its network. localhost and IP literals are refused before it is asked.
   */
  allowHost(hostname: string): Promise<boolean>;
  /** `<userData>/tool-exec/<harness-id>/` is the empty folder commands run in (Decision 6). */
  userData: string;
  exec: Omit<CoreBrokerDeps["exec"], "cwd">;
  /** The tool's log line (`ctx.log`); the receiver hides the keys, then cuts (as plugins: BrokerDeps.log). */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  /** Mock mode (slice 5): the tool's fetch and runner, after every check. */
  transport?(tool: string): { fetch: typeof fetch; run: typeof runFile };
}

const ENDED = "This tool call has ended";
const NO_FILES = "This tool doesn't declare uses.files";
/** Refusals of the grant (ours, and the fetch's for a hop): what the trace shows as "access denied". */
const DENIED = / is not declared in uses\.(hosts|secrets|exec|data)( \([a-z.]+\))?$| resolves to a private address$| is not a public host name$|^Refused a redirect to an undeclared host$/;
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

interface CallState {
  key: string;
  scope: string | null;
  accesses: TraceAccess[];
  logs: TraceLog[];
}

/** localhost, *.localhost or an IP literal (bracketed or not; one final dot as the name's root). */
export function localOrIp(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  return isIP(h) !== 0 || h === "localhost" || h.endsWith(".localhost");
}

/** Each fetch hop's host check for a tool: never this computer or an address by number, then the resolver's say. */
export function toolAllowHost(allowHost: (hostname: string) => Promise<boolean>): (hostname: string) => Promise<boolean> {
  return async (hostname) => !localOrIp(hostname) && (await allowHost(hostname));
}

/** A target as the trace keeps it: one line, at most TOOL_BROKER_LIMITS.targetChars code points. */
function cut(text: string): string {
  return [...text.replace(CONTROLS, " ")].slice(0, TOOL_BROKER_LIMITS.targetChars).join("");
}

/** The kind and target of a refused call, read from its arguments (only the URL, the command line, the collection). */
function targetOf(name: string, args: unknown): Omit<TraceAccess, "allowed"> | null {
  if (!Array.isArray(args)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 8192) : "");
  if (name === "fetch") return { kind: "fetch", target: text(args[0]) };
  if (name === "exec") {
    const list = Array.isArray(args[1]) ? (args[1] as unknown[]).slice(0, 256).map(text) : [];
    return { kind: "exec", target: [text(args[0]), ...list].join(" ") };
  }
  if (name.startsWith("data.")) return { kind: "data", target: `${name.slice(5)} ${text(args[0])}` };
  return null;
}

/** One tool's broker: a core Broker whose grant is the tool's `uses` (D7). One run per call (`startCall`). */
export class ToolBroker {
  readonly core: Broker;
  /** By run key (what the core's deps see) and by run id (what the host's calls name). */
  private readonly byKey = new Map<string, CallState>();
  private readonly byId = new Map<string, CallState>();
  /** The key values this tool's fetches were filled with: hidden in every target (a redirect may echo one back). */
  private readonly filled = new Set<string>();

  constructor(private readonly d: ToolBrokerDeps) {
    if (!SAFE_ID.test(d.harnessId)) throw new Error("A harness id names one folder");
    const uses = d.meta.uses;
    const reads = [...(uses.data?.read ?? []), ...(uses.data?.write ?? [])];
    const writes = uses.data?.write ?? [];
    const granted = uses.secrets ?? [];
    const extra = new Map<string, { max: number; fn: BrokerHandler }>([
      [
        "files.read",
        {
          max: 1,
          fn: (run, [rel]) => {
            const r = str(rel, "A path", 4096);
            return this.files(run, r, (f) => f.read(r));
          },
        },
      ],
      [
        "files.list",
        {
          max: 2,
          fn: (run, [dir, glob]) => {
            const r = str(dir, "A path", 4096);
            const g = glob === undefined ? undefined : str(glob, "A glob", 256);
            return this.files(run, r, (f) => f.list(r, g));
          },
        },
      ],
      ["scope", { max: 0, fn: async (run) => ({ ok: true, value: this.byKey.get(run.key)?.scope ?? null }) }],
    ]);
    this.core = new Broker({
      grant: {
        hosts: uses.hosts ?? [],
        secrets: granted,
        exec: uses.exec ?? [],
        // Own names only (no prototype key), each one read when it is read or written, written only when written.
        collection: (name, write) => (write ? writes : reads).includes(name),
        refusals: {
          collection: "The collection is not declared in uses.data",
          secret: (id) => `The key "${id}" is not declared in uses.secrets`,
          exec: (line) => `${line} is not declared in uses.exec`,
          host: (host) => {
            const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? host);
            return localOrIp(name) ? `${name} is not a public host name` : `${host} is not declared in uses.hosts`;
          },
        },
      },
      calls: TOOL_CALLS,
      extra,
      data: {
        run: async (op, run) => {
          const c = this.byKey.get(run.key);
          if (!c) throw new Error(ENDED);
          const target = `${op.op} ${op.collection}`;
          try {
            const value = await d.data(op, { who: "tool", tool: d.tool, scope: c.scope });
            this.record(c, { kind: "data", target, allowed: true });
            return value;
          } catch (err) {
            // The data path's own refusal (a rule, a scope): this access was not let through.
            this.record(c, { kind: "data", target, allowed: false });
            throw err;
          }
        },
      },
      // Only granted ids reach here (the core refuses any other first); at most SECRETS_MAX, each one asked of the store
      // now, at the call.
      secrets: async (ids) => {
        const asked = [...new Set(ids)].filter((id) => granted.includes(id));
        if (asked.length > SECRETS_MAX) throw new Error(`A request names at most ${SECRETS_MAX} keys`);
        const stored = await d.store.harnessValues(asked);
        const missing = asked.find((id) => !Object.hasOwn(stored, id) || typeof stored[id] !== "string");
        if (missing !== undefined) throw new Error(missingSecretMessage(d.secrets.find((s) => s.id === missing)?.label ?? missing));
        if (this.filled.size > 4 * SECRETS_MAX) this.filled.clear();
        for (const id of asked) this.filled.add(stored[id]!);
        return Object.fromEntries(asked.map((id) => [id, stored[id]!]));
      },
      log: d.log,
      fetch: d.fetch,
      allowHost: toolAllowHost(d.allowHost),
      exec: {
        resolve: d.exec.resolve,
        run: d.exec.run,
        env: d.exec.env,
        cwd: async () => {
          const dir = path.join(d.userData, "tool-exec", d.harnessId);
          await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          return dir;
        },
      },
      // Every fetch hop and command goes through here, so each one reached is recorded under its call.
      transport: (key) => {
        const base = d.transport?.(d.tool) ?? { fetch: d.fetch, run: d.exec.run };
        const c = this.byKey.get(key);
        const fetchHop = ((input: string, init?: RequestInit) => {
          if (c) this.record(c, { kind: "fetch", target: String(input), allowed: true });
          return base.fetch(input, init);
        }) as typeof fetch;
        const run: typeof runFile = (file, args, o) => {
          if (c) this.record(c, { kind: "exec", target: [path.basename(file), ...args].join(" "), allowed: true });
          return base.run(file, args, o);
        };
        return { fetch: fetchHop, run };
      },
      ended: ENDED,
    });
  }

  /** A run for one call of the tool, in the caller's scope. Its id is what the host's ctx calls carry. */
  startCall(scope: string | null): { id: string; signal: AbortSignal } {
    const key = randomUUID();
    const state: CallState = { key, scope: typeof scope === "string" ? scope : null, accesses: [], logs: [] };
    this.byKey.set(key, state);
    const run = this.core.startRun(key);
    this.byId.set(run.id, state);
    return run;
  }

  /** Ends the call's run (its fetches and commands abort) and hands back its accesses and `ctx.log` lines. */
  endCall(id: string): { accesses: TraceAccess[]; logs: TraceLog[] } {
    const state = this.byId.get(id);
    if (!state) return { accesses: [], logs: [] };
    this.byId.delete(id);
    this.byKey.delete(state.key);
    this.core.endRun(id);
    return { accesses: state.accesses, logs: state.logs };
  }

  killAll(): void {
    for (const id of [...this.byId.keys()]) this.endCall(id);
  }

  async call(id: unknown, name: unknown, args: unknown): Promise<BrokerAnswer> {
    const state = typeof id === "string" ? this.byId.get(id) : undefined;
    const answer = await this.core.call(id, name, args);
    // A log line the core took (and sent to main's log) goes into the call's trace entry too (spec §4.2).
    if (state && answer.ok && name === "log" && Array.isArray(args)) this.keepLog(state, args[0], args[1]);
    if (state && !answer.ok && typeof name === "string" && DENIED.test(answer.refused)) {
      const t = targetOf(name, args);
      if (t) this.record(state, { ...t, allowed: false });
    }
    return answer;
  }

  /** Keeps an access, its target with every filled key hidden first and only then cut (a cut could keep a key's start). */
  private record(state: CallState, access: TraceAccess): void {
    if (state.accesses.length >= TOOL_BROKER_LIMITS.accesses) return;
    const target = cut(this.filled.size > 0 ? redact(access.target.slice(0, 16_384), [...this.filled]) : access.target.slice(0, 16_384));
    state.accesses.push({ ...access, target });
  }

  /** Keeps a `ctx.log` line as the core sent it (one line), every filled key hidden, then cut; the first `logs` only. */
  private keepLog(state: CallState, level: unknown, message: unknown): void {
    if (state.logs.length >= TOOL_BROKER_LIMITS.logs || (level !== "info" && level !== "warn" && level !== "error") || typeof message !== "string") return;
    // Hidden first, then cut: a line cut at logLook ends exactly there, so the registry knows to drop its tail too.
    const line = oneLine(message);
    state.logs.push({ level, message: (this.filled.size > 0 ? redact(line, [...this.filled]) : line).slice(0, TOOL_BROKER_LIMITS.logLook) });
  }

  /** `ctx.files` (arguments already checked): only with `uses.files`; a path refused by the folder rules is "access denied", any other end is an access. */
  private async files(run: BrokerRun, rel: string, fn: (f: ToolFiles) => Promise<unknown>): Promise<BrokerAnswer> {
    const state = this.byKey.get(run.key);
    if (!state) return { ok: false, refused: ENDED };
    const target = rel;
    if (!this.d.meta.uses.files) {
      this.record(state, { kind: "files", target, allowed: false });
      return { ok: false, refused: NO_FILES };
    }
    const files = await this.d.files(state.scope);
    try {
      const value = await fn(files);
      this.record(state, { kind: "files", target, allowed: true });
      return { ok: true, value };
    } catch (err) {
      if (err instanceof ToolFileRefused) this.record(state, { kind: "files", target, allowed: false });
      else this.record(state, { kind: "files", target, allowed: true });
      throw err;
    }
  }
}
