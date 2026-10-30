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
import { plainLine } from "./one-line";
import { ToolFileRefused, type ToolFiles } from "./tool-files";

/**
 * A tool's `ctx` in main (tools spec §4.2, D7; threat rows T3, T4, T8): one core Broker per tool, its grant built from
 * the tool's `uses` and nothing else. Each call of the tool is one run (`startCall`) that carries the caller's scope;
 * the host's `ctx` calls name that run's id, which main made, so a tool can't reach another call's scope or another
 * tool's grant. Every allowed and refused access of a run is kept for its trace entry: a kind and a target (a URL, a
 * command line, "<op> <collection>", a path), never a header, a body or a key.
 */

/** The calls a tool's ctx makes (tools spec §4.2; `summary` and `requestAi` since slice 4, §7.3, §7.4). */
export const TOOL_CALLS: readonly string[] = [
  "fetch",
  "exec",
  "data.get",
  "data.query",
  "data.put",
  "data.patch",
  "data.delete",
  "files.read",
  "files.list",
  "scope",
  "log",
  "summary",
  "requestAi",
];

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
 * What a job run's slot may reach (its `permissions` narrowed from the harness's, jobs J2): a tool it calls never
 * fetches with `web: false` or runs a command with `exec: false`, whatever the job runs. A task's or the UI's call has
 * none (the harness's permissions, which `uses` already sits inside).
 */
export interface JobLimits {
  job: string;
  web: boolean;
  exec: boolean;
}

/**
 * `logs`: the `ctx.log` lines kept per call (the first ones); `logLook`: how much of each line is kept for the
 * registry, which hides the keys in it before its own cut.
 */
export const TOOL_BROKER_LIMITS = { targetChars: 200, accesses: 200, logs: 20, logLook: 16_384 } as const;

/**
 * `ctx.summary`'s line as the broker keeps it for the registry, which hides the stored keys in it and only then cuts it
 * to a job summary's 300 characters (part 3's limit).
 */
export const SUMMARY_LOOK = 16_384;
/** The largest `ctx.requestAi` input, as JSON in UTF-8 bytes (R5). */
export const REQUEST_MAX_BYTES = 1024 * 1024;
export const POST_ONLY = "ctx.requestAi is only for the step right after a job's AI step";

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
  limits?: JobLimits;
  /** A job's post-step call: only then may the tool call ctx.requestAi (tools spec §7.3). */
  post: boolean;
  /** The last `ctx.summary` line (one line, filled keys hidden, at most SUMMARY_LOOK units). */
  summary?: string;
  /** The `ctx.requestAi` input, a plain JSON copy; at most one a call. */
  request?: { input: unknown };
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

/** The refusal of `name` under a job run's permissions, or null when they allow it. */
function jobRefusal(l: JobLimits, name: unknown): string | null {
  if (name === "fetch" && l.web !== true) return `The job "${l.job}" runs with web: false: its tools can't fetch`;
  if (name === "exec" && l.exec !== true) return `The job "${l.job}" runs with exec: false: its tools can't run commands`;
  return null;
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
      ["summary", { max: 1, fn: async (run, [text]) => this.summary(run, text) }],
      ["requestAi", { max: 1, fn: async (run, [input]) => this.requestAi(run, input) }],
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

  /**
   * A run for one call of the tool, in the caller's scope; `limits`: the calling job run's permissions; `o.post`: a job's
   * post-step call (the only one that may call ctx.requestAi). Its id is what the host's ctx calls carry.
   */
  startCall(scope: string | null, limits?: JobLimits, o: { post?: boolean } = {}): { id: string; signal: AbortSignal } {
    const key = randomUUID();
    const state: CallState = {
      key,
      scope: typeof scope === "string" ? scope : null,
      accesses: [],
      logs: [],
      ...(limits ? { limits: { ...limits } } : {}),
      post: o.post === true,
    };
    this.byKey.set(key, state);
    const run = this.core.startRun(key);
    this.byId.set(run.id, state);
    return run;
  }

  /**
   * Ends the call's run (its fetches and commands abort) and hands back its accesses and `ctx.log` lines, and its
   * `ctx.summary` line and `ctx.requestAi` input when it gave them.
   */
  endCall(id: string): { accesses: TraceAccess[]; logs: TraceLog[]; summary?: string; requestAi?: { input: unknown } } {
    const state = this.byId.get(id);
    if (!state) return { accesses: [], logs: [] };
    this.byId.delete(id);
    this.byKey.delete(state.key);
    this.core.endRun(id);
    return {
      accesses: state.accesses,
      logs: state.logs,
      ...(state.summary !== undefined ? { summary: state.summary } : {}),
      ...(state.request ? { requestAi: state.request } : {}),
    };
  }

  killAll(): void {
    for (const id of [...this.byId.keys()]) this.endCall(id);
  }

  async call(id: unknown, name: unknown, args: unknown): Promise<BrokerAnswer> {
    const state = typeof id === "string" ? this.byId.get(id) : undefined;
    // A job run's narrowed permissions come before the tool's own grant: refused, and shown as access denied.
    const off = state?.limits ? jobRefusal(state.limits, name) : null;
    if (state && off) {
      const t = targetOf(name as string, args);
      if (t) this.record(state, { ...t, allowed: false });
      return { ok: false, refused: off };
    }
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

  /**
   * `ctx.summary(text)` (tools spec §7.4): accepted from every caller, the last one of the call kept; a job run uses it.
   * One line, every filled key hidden, then cut at SUMMARY_LOOK (the registry hides the stored keys, then cuts at 300).
   * A text with nothing left on its line changes nothing.
   */
  private async summary(run: BrokerRun, text: unknown): Promise<BrokerAnswer> {
    const state = this.byKey.get(run.key);
    if (!state) return { ok: false, refused: ENDED };
    if (typeof text !== "string") return { ok: false, refused: "ctx.summary takes a string" };
    const line = plainLine(text);
    if (line !== "") state.summary = (this.filled.size > 0 ? redact(line, [...this.filled]) : line).slice(0, SUMMARY_LOOK);
    return { ok: true, value: null };
  }

  /**
   * `ctx.requestAi(input)` (tools spec §7.3; R3, R5): only in a job's post-step call, once a call, at most
   * REQUEST_MAX_BYTES of JSON. What is kept is a plain copy parsed back from that JSON: nothing of the tool's object.
   */
  private async requestAi(run: BrokerRun, input: unknown): Promise<BrokerAnswer> {
    const state = this.byKey.get(run.key);
    if (!state) return { ok: false, refused: ENDED };
    if (!state.post) return { ok: false, refused: POST_ONLY };
    if (state.request) return { ok: false, refused: "ctx.requestAi was already called in this call" };
    let json: string | undefined;
    try {
      json = JSON.stringify(input);
    } catch {
      return { ok: false, refused: "ctx.requestAi takes JSON data" };
    }
    if (json === undefined) return { ok: false, refused: "ctx.requestAi takes JSON data" };
    if (json.length > REQUEST_MAX_BYTES || Buffer.byteLength(json, "utf8") > REQUEST_MAX_BYTES) return { ok: false, refused: "The request is too large" };
    state.request = { input: JSON.parse(json) as unknown };
    return { ok: true, value: null };
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
