import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessSecret, ToolsManifest } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import type { Event, ToolCallView } from "@humanharness/runtime";
import type { ToolsInfo } from "@humanharness/ui/client";
import type { HistoryTrailer } from "@humanharness/workspace";
import type { BrokerDataOp } from "../broker/broker";
import { BROKER_LIMITS } from "../broker/broker-checks";
import type { ToolDataCall } from "../data-requests";
import { isJobSlot } from "../jobs/jobs-host";
import type { runFile } from "../plugin-exec";
import type { SecretStore } from "../secrets/secret-store";
import { ToolBroker } from "./tool-broker";
import { toolFiles } from "./tool-files";
import type { ToolHost } from "./tool-host";
import { TRACE_CUT, type ToolAnswer, type ToolCall, ToolRegistry } from "./tool-registry";
import { ToolTrace, type TraceEntry } from "./tool-trace";
import { type ToolsState, readToolsJson } from "./tools-json";

/**
 * The harness's tools in the app (tools spec §4, §5; Decisions 3, 7, 9, 14): built in index.ts only when the harness
 * declares `tools` (D0). It reads `dist/tools.json` once at start, starts the host window, and builds the registry with
 * one broker per tool, the trace of the base in use, and the person-side data path as the tool. Three ways in:
 * - the agent, through the core `tools` MCP server (`workspaceOptions().request`): the caller comes from the asking
 *   slot, never from the request (a task's slot: that task, its scope and phase; a job's slot: the job and its run,
 *   whatever the job runs), and an `agent: "none"` tool is unknown to it (T7);
 * - the harness UI (`uiCall`): caller "ui", the open scope, no task (T9, Decision 14);
 * - `trace(id)`: a task's or a job run's calls, as the chat's folded lines show them.
 * A tool's data write carries the calling task's history trailer plus `Tool: <id>`.
 */

/** The only text a failure outside the registry's own answers reaches the agent or the UI with. */
export const TOOL_BROKE = "Something went wrong running the tool";
const INVALID = "Invalid request";
const NO_TASK = "No task is running in this session";
/** `ToolCallView.args` and `.result` are cut here (the trace keeps 2 KB already). */
const VIEW_CUT = TRACE_CUT;

/** The harness as the tools need it. */
export interface ToolsHarness extends ToolsManifest {
  id: string;
  root: string;
  secrets?: readonly HarnessSecret[];
}

/** The task a slot runs now, with its history trailer (the scope and phase of its commits). */
export interface SlotTask {
  id: string;
  scope: string;
  trailer?: HistoryTrailer;
}

export interface ToolsHostDeps {
  harness: ToolsHarness;
  /** The base the app works in now (null before setup): the trace and `ctx.files` follow it. */
  base(): Promise<string | null>;
  /** The base's reference folders, for `ctx.files` (`refs/<id>/…`). */
  references(): Promise<{ id: string; path: string }[]>;
  /** The app's data folder: the catalogue file and the tools' exec folder go under it. */
  userData: string;
  /** Read at every fetch that names a key, and to hide the keys in errors, results and the trace. */
  store: Pick<SecretStore, "harnessValues">;
  /** `toolDataRequests` (the person's path as the tool, in the person's write queue). */
  data(request: unknown, call: ToolDataCall): Promise<unknown>;
  /** As plugins: the login PATH's binaries and runner; only PATH, HOME and LANG of `env` are kept (B7, Decision 6). */
  exec: { resolve(cmd: string): Promise<string | null>; run: typeof runFile; env(): Promise<Record<string, string>> };
  fetch: typeof fetch;
  /** Public addresses only (`isPublicHost`). */
  allowHost(hostname: string): Promise<boolean>;
  /** The sandbox host (`ToolHost`), built by index.ts with Electron. */
  host: Pick<ToolHost, "start" | "stop" | "call" | "off">;
  /** The scope the window has open (null: none): the UI's calls run there. */
  openScope(): Promise<string | null>;
  /** The task the slot `key` runs now (null: none). */
  slotTask(key: string): Promise<SlotTask | null>;
  /** The job run whose slot is `key` (null: none), with its history trailer. */
  jobRun(key: string): { id: string; job?: string; scope: string; trailer?: HistoryTrailer } | null;
  /** A runtime event for task `task`'s chat (the folded line, Task 11). */
  emitToTask(task: string, event: Event): void;
  /** The built `tools-server.js` (app); absent: the TS source (dev). */
  serverEntry?: string;
  /** `info()` changed: once started, and when the host goes off after repeated crashes (the window's top line, Task 11). */
  changed?(): void;
  log(message: string, err?: unknown): void;
}

/** What `createWorkspace` takes for the `tools` server. */
export interface ToolsWorkspaceOptions {
  catalogue: string;
  request: (request: unknown, slot: { key: string }) => Promise<unknown>;
  entry?: string;
}

export interface ToolsHost {
  /** Reads tools.json, writes the catalogue, prunes the trace, starts the host. Once; later calls wait for the first. */
  start(): Promise<void>;
  stop(): void;
  registry: ToolRegistry;
  /** The `tools` server's options: only with an `agent: "call"` tool and tools on (else none: no server). */
  workspaceOptions(): Promise<ToolsWorkspaceOptions | undefined>;
  /** One call from the harness UI. */
  uiCall(id: string, args: unknown): Promise<ToolAnswer>;
  /** A task's or job run's calls, oldest first. */
  trace(id: string): Promise<ToolCallView[]>;
  info(): ToolsInfo;
  /** Runs whose call trailer is kept (tests: each is dropped when its call ends). */
  openRuns(): number;
}

/** B7 for tools (Decision 6): a command sees PATH, HOME and LANG of `env` and TERM=dumb, nothing else. */
export function toolExecEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { TERM: "dumb" };
  for (const k of ["PATH", "HOME", "LANG"]) if (Object.hasOwn(env, k) && typeof env[k] === "string") out[k] = env[k];
  return out;
}

/**
 * The task `manager` runs now with its trailer (index.ts's `slotTask`). The two are read a moment apart: a trailer of
 * another task (the open task changed in between) is never taken as this one's.
 */
export async function slotTaskOf(
  manager: { runningTask(): Promise<{ id: string; scope: string } | null>; trailerNow(): Promise<HistoryTrailer | undefined> } | undefined,
): Promise<SlotTask | null> {
  if (!manager) return null;
  const [task, trailer] = await Promise.all([manager.runningTask(), manager.trailerNow()]);
  return task ? { id: task.id, scope: task.scope, ...(trailer && trailer.task === task.id ? { trailer } : {}) } : null;
}

/** The first `n` code points of `s`. */
const upTo = (s: string, n: number) => [...s].slice(0, n).join("");

/** A traced value as the folded line shows it: its text when it was cut, else its JSON, at most 2 KB. */
function shown(v: unknown): string {
  if (typeof v === "object" && v !== null && (v as { cut?: unknown }).cut === true && typeof (v as { text?: unknown }).text === "string") {
    return upTo((v as { text: string }).text, VIEW_CUT);
  }
  let text: string;
  try {
    text = JSON.stringify(v) ?? "null";
  } catch {
    text = "(not JSON)";
  }
  return upTo(text, VIEW_CUT);
}

/** A trace entry as the chat's folded line shows it (tools spec §8.2). */
export function toolCallView(e: TraceEntry): ToolCallView {
  return {
    tool: e.tool,
    caller: e.caller,
    ok: e.ok,
    ms: e.ms,
    summary: e.resultSummary,
    ...(e.error !== undefined ? { error: e.error } : {}),
    args: shown(e.args),
    ...(e.ok && e.result !== undefined ? { result: shown(e.result) } : {}),
    accesses: e.accesses.map((a) => ({ kind: a.kind, target: a.target, allowed: a.allowed })),
    at: e.at,
  };
}

/** The broker's data op as the person path's request (`query` flat). */
function dataRequest(op: BrokerDataOp): unknown {
  if (op.op === "query") return { op: "query", collection: op.collection, ...op.query };
  if (op.op === "replaceAll") throw new Error("Unknown call");
  return op;
}

export function createToolsHost(d: ToolsHostDeps): ToolsHost {
  const h = d.harness;
  const tools = h.tools ?? {};
  let state: ToolsState = { on: false, reason: "Tools are starting" };
  let started: Promise<void> | null = null;
  let catalogue: string | null = null;
  const brokers = new Map<string, ToolBroker>();
  const traces = new Map<string, ToolTrace>();
  /**
   * The calling task's trailer for the call in progress: set around each registry call and each `ctx` call, so the
   * tool's data write (reached through the host page, out of the registry's own chain) is committed under it.
   */
  const callTrailer = new AsyncLocalStorage<{ trailer?: HistoryTrailer }>();
  const trailers = new Map<string, HistoryTrailer | undefined>();

  const traceFor = async (): Promise<ToolTrace> => {
    const base = await d.base();
    if (!base) throw new Error("The app is not set up yet");
    let t = traces.get(base);
    if (!t) {
      t = new ToolTrace({ base, log: d.log });
      traces.set(base, t);
    }
    return t;
  };

  const secretValues = async (tool: string): Promise<string[]> => {
    if (!state.on || !Object.hasOwn(state.tools, tool)) return [];
    const ids = state.tools[tool]!.uses.secrets ?? [];
    return ids.length > 0 ? Object.values(await d.store.harnessValues(ids)) : [];
  };

  const brokerOf = (tool: string): ToolBroker => {
    let b = brokers.get(tool);
    if (b) return b;
    if (!state.on || !Object.hasOwn(state.tools, tool)) throw new Error(`Unknown tool "${tool}"`);
    b = new ToolBroker({
      harnessId: h.id,
      tool,
      meta: state.tools[tool]!,
      secrets: h.secrets ?? [],
      store: d.store,
      data: (op, ctx) => d.data(dataRequest(op), { scope: ctx.scope, tool: ctx.tool, ...withTrailer(callTrailer.getStore()?.trailer) }),
      files: async () => {
        const base = await d.base();
        if (!base) throw new Error("The app is not set up yet");
        return toolFiles({ base, references: await d.references() });
      },
      fetch: d.fetch,
      allowHost: d.allowHost,
      userData: d.userData,
      exec: { resolve: d.exec.resolve, run: d.exec.run, env: async () => toolExecEnv(await d.exec.env()) },
      // As plugins (B6): the stored keys hidden first, then cut.
      log: async (level, message) => {
        const keys = await secretValues(tool).catch(() => []);
        d.log(`[tools] ${tool}: ${level}: ${upTo(keys.length > 0 ? hideSecrets(message, keys) : message, BROKER_LIMITS.logChars)}`);
      },
    });
    brokers.set(tool, b);
    return b;
  };

  const registry = new ToolRegistry({
    json: async () => {
      await start();
      return state;
    },
    host: d.host,
    // The run's id is the host's call id: the trailer of the call that starts it is kept for its ctx calls.
    broker: (tool) => {
      const b = brokerOf(tool);
      return {
        startCall: (scope) => {
          const run = b.startCall(scope);
          trailers.set(run.id, callTrailer.getStore()?.trailer);
          return run;
        },
        endCall: (id) => {
          trailers.delete(id);
          return b.endCall(id);
        },
      };
    },
    trace: { append: async (e) => (await traceFor()).append(e) },
    secretValues,
    called: (e) => {
      if (e.task !== undefined) d.emitToTask(e.task, { type: "tool-call", call: toolCallView(e) });
    },
    log: d.log,
  });

  async function writeCatalogue(): Promise<void> {
    const dir = path.join(d.userData, "tools-catalogue");
    const file = path.join(dir, `${h.id}.json`);
    const list = state.on
      ? Object.entries(state.tools)
          .filter(([, m]) => m.agent === "call")
          .map(([name, m]) => ({ name, description: m.description, inputSchema: m.params }))
      : [];
    // Off, or no tool for the agent: no server, and no list an earlier start left behind.
    if (list.length === 0) return fs.rm(file, { force: true });
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${h.id}.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, `${JSON.stringify(list)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    catalogue = file;
  }

  function start(): Promise<void> {
    started ??= (async () => {
      state = await readToolsJson(h.root, h, (m) => d.log(m));
      if (state.on) {
        const on = state;
        try {
          d.host.start({
            harnessId: h.id,
            dist: path.join(h.root, "dist"),
            ids: Object.keys(on.tools),
            // A ctx call goes to the broker of the tool main handed this call id to, under that call's trailer.
            channel: { ctx: (tool, callId, name, args) => callTrailer.run({ ...withTrailer(trailers.get(callId)) }, () => brokerOf(tool).call(callId, name, args)) },
            onCrash: (reason) => d.log(`The tools host crashed (${reason})`),
            onOff: (reason) => {
              d.log(`Tools are off: ${reason}`);
              changed();
            },
          });
        } catch (err) {
          // The host refuses a harness id it can't use as its URL's host (over 63 characters): tools are off.
          d.log("Tools are off: the tools host could not start", err);
          state = { on: false, reason: `Tools are off: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      await writeCatalogue().catch((err: unknown) => d.log("Could not write the tools catalogue", err));
      const t = await traceFor().catch(() => null);
      await t?.prune();
      changed();
    })();
    return started;
  }

  /** Tells main the info changed; a throwing listener never breaks the start or the host. */
  function changed(): void {
    try {
      d.changed?.();
    } catch (err) {
      d.log("Could not tell the window the tools changed", err);
    }
  }

  /** The agent's request on slot `key`: the tool's result, or a throw whose message the agent reads as is. */
  async function agentCall(request: unknown, key: string): Promise<unknown> {
    if (typeof request !== "object" || request === null || Array.isArray(request)) throw new Safe(INVALID);
    const { tool, args } = request as { tool?: unknown; args?: unknown };
    if (typeof tool !== "string") throw new Safe(INVALID);
    let call: ToolCall;
    let trailer: HistoryTrailer | undefined;
    if (isJobSlot(key)) {
      const run = d.jobRun(key);
      if (!run) throw new Safe(NO_TASK);
      trailer = run.trailer;
      call = { tool, args, caller: "agent", scope: run.scope, run: run.id, ...(run.job !== undefined ? { job: run.job } : {}) };
    } else {
      const task = await d.slotTask(key);
      if (!task) throw new Safe(NO_TASK);
      trailer = task.trailer;
      call = { tool, args, caller: "agent", scope: task.scope, task: task.id, ...(trailer?.phase !== undefined ? { phase: trailer.phase } : {}) };
    }
    const answer = await callTrailer.run({ ...withTrailer(trailer) }, () => registry.call(call));
    // The registry's answer: its own texts, or the tool's error with the stored keys hidden.
    if (!answer.ok) throw new Safe(answer.error);
    return answer.result;
  }

  return {
    start,
    stop: () => {
      for (const b of brokers.values()) b.killAll();
      d.host.stop();
    },
    registry,
    async workspaceOptions() {
      await start();
      if (!catalogue) return undefined;
      return {
        catalogue,
        // Only the registry's own answers reach the agent; anything else is the fixed text (no path, stack or key).
        request: async (request, slot) => {
          try {
            return await agentCall(request, slot.key);
          } catch (err) {
            if (err instanceof Safe) throw new Error(err.message);
            d.log("A tool call from the agent failed", err);
            throw new Error(TOOL_BROKE);
          }
        },
        ...(d.serverEntry ? { entry: d.serverEntry } : {}),
      };
    },
    async uiCall(id, args) {
      try {
        return await registry.call({ tool: id, args, caller: "ui", scope: await d.openScope() });
      } catch (err) {
        d.log("A tool call from the UI failed", err);
        return { ok: false, error: TOOL_BROKE };
      }
    },
    async trace(id) {
      try {
        return (await (await traceFor()).read(id)).map(toolCallView);
      } catch (err) {
        d.log("Could not read a tool trace", err);
        return [];
      }
    },
    openRuns: () => trailers.size,
    info() {
      const off = state.on ? d.host.off() : state.reason;
      return { ids: Object.keys(tools).sort(), ...(started && off !== null ? { off } : {}) };
    },
  };
}

const withTrailer = (t: HistoryTrailer | undefined) => (t ? { trailer: t } : {});

/** A message the agent may read as is: a fixed text, or the registry's (already hidden) answer. */
class Safe extends Error {}
