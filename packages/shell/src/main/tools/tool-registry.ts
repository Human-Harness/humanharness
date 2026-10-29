import { TOOL_ID, type ToolMeta, jsonSchemaToZod } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import { TOOL_BROKER_LIMITS, type ToolBroker, type TraceAccess, type TraceLog } from "./tool-broker";
import type { ToolHostAnswer, ToolHostCall } from "./tool-host";
import { TOOL_RPC_LIMITS } from "./tool-protocol";
import type { ToolCaller, ToolTrace, TraceEntry } from "./tool-trace";
import type { ToolsState } from "./tools-json";

export type { ToolCaller } from "./tool-trace";

/**
 * The tool registry (tools spec §4.3; threat rows T4, T5, T7): every call of a tool, from any caller, goes through
 * here. It refuses an unknown id (and an `agent: "none"` tool to the agent), checks the arguments against `params`
 * and hands the tool only the parsed value (unknown keys stripped), runs it in the host under a fresh run of its own
 * broker with the tool's timeout, checks the result against `returns` (a mismatch, an extra key included, is the
 * tool's error: never half-good data), and writes one trace entry. The tool's stored key values are hidden in the
 * answer's error and result and everywhere in the trace, before any cut.
 */

/** One call: who makes it and where (the task, or the job and its run, whatever the job runs). */
export interface ToolCall {
  tool: string;
  args: unknown;
  caller: ToolCaller;
  scope: string | null;
  task?: string;
  job?: string;
  run?: string;
  phase?: string;
}
export type ToolAnswer = { ok: true; result: unknown } | { ok: false; error: string };

/** `args` and results are cut at this many code points in a trace entry (§8.1), never in the answer. */
export const TRACE_CUT = 2048;
const SUMMARY_CHARS = 200;
const ACCESS_CHARS = 200;
const ERROR_CHARS = 4096;
/** Each `ctx.log` line of a trace entry is cut here (the broker keeps at most 20 a call). */
export const LOG_CHARS = 300;
/** A compiled params or returns schema. */
type Schema = ReturnType<typeof jsonSchemaToZod>;

/** At most this much of a value's JSON is looked at for the trace (it keeps 2 KB of it). */
const TRACE_LOOK = 64 * 1024;
const BROKE = "Something went wrong running the tool";

export interface ToolRegistryDeps {
  /** tools.json as read at start (`readToolsJson`). */
  json(): Promise<ToolsState>;
  host: { call(c: ToolHostCall, timeoutMs: number): Promise<ToolHostAnswer>; off(): string | null };
  broker(tool: string): Pick<ToolBroker, "startCall" | "endCall">;
  trace: Pick<ToolTrace, "append">;
  /** The tool's stored secret values, to hide in errors, results and the trace (T4). */
  secretValues(tool: string): Promise<string[]>;
  /** A call ended and was traced: the chat's folded line (Task 11). */
  called?(entry: TraceEntry): void;
  now?(): Date;
  log?(message: string, err?: unknown): void;
}

type Ran = { ok: true; value: unknown; summary?: string } | { ok: false; error: string };

/** The first `n` code points of `s`, or null when it has no more than that. */
function cutAt(s: string, n: number): string | null {
  let i = 0;
  let units = 0;
  for (const ch of s) {
    if (i === n) return s.slice(0, units);
    i++;
    units += ch.length;
  }
  return null;
}
const upTo = (s: string, n: number) => cutAt(s, n) ?? s;

/** The longest form a key can take in a text (raw, %-encoded, base64, hex, JSON `\uXXXX`): ≤ 6 per byte. */
const longestForm = (keys: readonly string[]) => Math.max(0, ...keys.map((k) => Buffer.byteLength(k, "utf8") * 6 + 16));

/**
 * `text` with the keys hidden, looking at no more than `limit` units of it. When it is longer, the hidden head loses
 * its last `longestForm` units too, so a key cut in half at the limit never shows its start.
 */
function hiddenHead(text: string, keys: readonly string[], limit: number): { text: string; cut: boolean } {
  if (text.length <= limit) return { text: keys.length > 0 ? hideSecrets(text, keys) : text, cut: false };
  const head = text.slice(0, limit);
  if (keys.length === 0) return { text: head, cut: true };
  const shown = hideSecrets(head, keys);
  return { text: shown.slice(0, Math.max(0, shown.length - longestForm(keys))), cut: true };
}

/**
 * A text from the host (an error, a summary) as main shows it: the keys hidden first, and only then cut to `out` code
 * points. A text that arrived at the host's cap (`cap`) was already cut there, maybe through a key: it loses its last
 * `longestForm` units too, so that key never shows its start.
 */
function shownText(text: string, keys: readonly string[], out: number, cap: number): string {
  const shown = hiddenHead(text, keys, TRACE_LOOK);
  let t = shown.text;
  if (!shown.cut && keys.length > 0 && text.length >= cap) t = t.slice(0, Math.max(0, t.length - longestForm(keys)));
  return upTo(t, out);
}

/** A value as a trace entry keeps it: itself when its JSON is short and holds no key, else `{ cut: true, text }`. */
function traced(value: unknown, keys: readonly string[]): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return { cut: true, text: "(not JSON)" };
  }
  const shown = hiddenHead(json, keys, TRACE_LOOK);
  const cut = cutAt(shown.text, TRACE_CUT);
  if (cut !== null) return { cut: true, text: cut };
  if (shown.cut) return { cut: true, text: shown.text };
  if (shown.text === json) return value === undefined ? null : value;
  try {
    return JSON.parse(shown.text) as unknown;
  } catch {
    return { cut: true, text: shown.text };
  }
}

/** Every string of a value (keys of objects too) with the keys hidden; own entries only, built without a prototype path. */
function hideIn(v: unknown, keys: readonly string[]): unknown {
  if (typeof v === "string") return hideSecrets(v, keys);
  if (Array.isArray(v)) return v.map((x) => hideIn(x, keys));
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [hideSecrets(k, keys), hideIn(x, keys)]));
  return v;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "12 items", "object with 4 keys", "text, 40 characters" (tools spec §8.1). */
export function genericSummary(v: unknown): string {
  if (Array.isArray(v)) return plural(v.length, "item");
  if (typeof v === "string") return `text, ${plural([...v].length, "character")}`;
  if (typeof v === "object" && v !== null) return `object with ${plural(Object.keys(v).length, "key")}`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "nothing";
}

/** The first issue of a failed parse as "path: message". */
function firstIssue(err: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const i = err.issues[0];
  if (!i) return "Invalid";
  const at = i.path.map(String).join(".");
  return at ? `${at}: ${i.message}` : i.message;
}

export class ToolRegistry {
  /** Each tools.json entry's compiled schemas (a schema outside the allowlist: its reason). */
  private readonly schemas = new WeakMap<object, Schema | string>();

  constructor(private readonly d: ToolRegistryDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  private schema(node: Record<string, unknown>): Schema | string {
    let s = this.schemas.get(node);
    if (s === undefined) {
      try {
        s = jsonSchemaToZod(node);
      } catch (err) {
        s = err instanceof Error ? err.message : String(err);
      }
      this.schemas.set(node, s);
    }
    return s;
  }

  async call(c: ToolCall): Promise<ToolAnswer> {
    const state = await this.d.json();
    if (!state.on) return { ok: false, error: state.reason };
    const off = this.d.host.off();
    if (off !== null) return { ok: false, error: off };
    const id = c.tool;
    const known = typeof id === "string" && TOOL_ID.test(id);
    const meta = known && Object.hasOwn(state.tools, id) ? state.tools[id] : undefined;
    // T7: an agent: "none" tool is as unknown to the agent as a tool that isn't there.
    if (!meta || (c.caller === "agent" && meta.agent === "none")) return { ok: false, error: known ? `Unknown tool "${id}"` : "Unknown tool" };

    const started = this.now();
    const keys = await this.d.secretValues(id).catch((err: unknown) => {
      this.d.log?.(`The keys of tool ${id} could not be read to hide them`, err);
      return [] as string[];
    });
    const given = c.args === undefined ? {} : c.args;
    let args: unknown = given;
    let accesses: TraceAccess[] = [];
    let logs: TraceLog[] = [];
    let ran: Ran;
    const params = this.schema(meta.params);
    const checked = typeof params === "string" ? null : params.safeParse(given);
    if (typeof params === "string") ran = { ok: false, error: `${id}: params can't be checked: ${params}` };
    else if (!checked!.success) ran = { ok: false, error: firstIssue(checked!.error) };
    else {
      // Only the parsed value reaches the tool: keys params doesn't name are gone.
      args = checked!.data;
      const out = await this.run(id, meta, args, c.scope);
      accesses = out.accesses;
      logs = out.logs;
      ran = out.ran.ok ? this.checkReturns(meta, out.ran) : out.ran;
    }

    const ms = Math.max(0, this.now().getTime() - started.getTime());
    const result = ran.ok && keys.length > 0 ? hideIn(ran.value, keys) : ran.ok ? ran.value : undefined;
    const error = ran.ok ? undefined : shownText(ran.error, keys, ERROR_CHARS, TOOL_RPC_LIMITS.errorChars) || "The tool failed; its error can't be shown";
    const summary = !ran.ok ? "failed" : (ran.summary && shownText(ran.summary, keys, SUMMARY_CHARS, TOOL_RPC_LIMITS.summaryChars)) || genericSummary(result);
    const entry: TraceEntry = {
      at: started.toISOString(),
      tool: id,
      caller: c.caller,
      ...(c.task !== undefined ? { task: c.task } : {}),
      ...(c.job !== undefined ? { job: c.job } : {}),
      ...(c.run !== undefined ? { run: c.run } : {}),
      ...(c.phase !== undefined ? { phase: c.phase } : {}),
      args: traced(args, keys),
      ...(ran.ok ? { result: traced(result, keys) } : {}),
      resultSummary: summary,
      ms,
      ok: ran.ok,
      ...(error !== undefined ? { error } : {}),
      // The broker already hid the keys its fetches were filled with; the stored ones are hidden again here.
      accesses: keys.length > 0 ? accesses.map((a) => ({ ...a, target: upTo(hideSecrets(a.target, keys), ACCESS_CHARS) })) : accesses,
      // Spec §4.2: the tool's log lines, the stored keys hidden before each line's cut (a line the broker cut loses its tail).
      ...(logs.length > 0 ? { logs: logs.map((l) => ({ level: l.level, message: shownText(l.message, keys, LOG_CHARS, TOOL_BROKER_LIMITS.logLook) })) } : {}),
    };
    try {
      await this.d.trace.append(entry);
    } catch (err) {
      this.d.log?.(`A call of tool ${id} was not traced`, err);
    }
    try {
      this.d.called?.(entry);
    } catch (err) {
      this.d.log?.(`A call of tool ${id} was not shown`, err);
    }
    return ran.ok ? { ok: true, result } : { ok: false, error: error! };
  }

  /** One run in the host under a fresh run of the tool's broker; the registry's own timer backs the host's. */
  private async run(id: string, meta: ToolMeta, args: unknown, scope: string | null): Promise<{ ran: Ran; accesses: TraceAccess[]; logs: TraceLog[] }> {
    let broker: Pick<ToolBroker, "startCall" | "endCall">;
    let callId: string;
    try {
      broker = this.d.broker(id);
      callId = broker.startCall(scope).id;
    } catch (err) {
      this.d.log?.(`Tool ${id} could not start`, err);
      return { ran: { ok: false, error: BROKE }, accesses: [], logs: [] };
    }
    const timeoutMs = meta.timeout * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Ran>((settle) => {
      timer = setTimeout(() => settle({ ok: false, error: `${id} took longer than ${meta.timeout} s` }), timeoutMs);
    });
    let ran: Ran;
    let accesses: TraceAccess[] = [];
    let logs: TraceLog[] = [];
    try {
      ran = await Promise.race([
        // A host that throws, even before it returns a promise, is this call's failure.
        Promise.resolve()
          .then(() => this.d.host.call({ callId, tool: id, args, scope }, timeoutMs))
          .catch((err: unknown): Ran => {
            this.d.log?.(`Tool ${id} failed in the host`, err);
            return { ok: false, error: BROKE };
          }),
        late,
      ]);
    } finally {
      clearTimeout(timer);
      // Ends the run (its fetches and commands abort) and takes its accesses, whatever happened.
      try {
        ({ accesses, logs } = broker.endCall(callId));
      } catch (err) {
        this.d.log?.(`A run of tool ${id} did not end cleanly`, err);
      }
    }
    return { ran, accesses, logs };
  }

  /** The result against `returns` when the tool declares it: a mismatch is the tool's error. */
  private checkReturns(meta: ToolMeta, ran: Extract<Ran, { ok: true }>): Ran {
    if (!meta.returns) return ran;
    const returns = this.schema(meta.returns);
    if (typeof returns === "string") return { ok: false, error: `returns can't be checked: ${returns}` };
    const r = returns.safeParse(ran.value);
    if (!r.success) return { ok: false, error: `The result doesn't match returns: ${firstIssue(r.error)}` };
    return { ...ran, value: r.data };
  }
}
