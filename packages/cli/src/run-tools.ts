import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import { type FixtureExchange, hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import type { BrokerDataOp, runFile } from "@humanharness/shell/plugins";
import { PREPARE_FAILED, type TaskDeps, type UsageLog, dataWriteQueue, preRecord, toolDataRequests } from "@humanharness/shell/tasks";
import { ToolTrace, type TraceEntry, prepareTask, readToolsJson } from "@humanharness/shell/tools";
import { APP_SCOPE, type DataStore, MAIN_SCOPE, type ScopeStore } from "@humanharness/workspace";
import { CliError } from "./cli";
import type { ToolExchange } from "./record";
import { buildTools } from "./tool-build";
import { TOOL_P12_NOTE, cliTools } from "./tool-host-node";
import type { ToolRunDeps } from "./tool-run";

/**
 * Tools in `humanharness run` (tools spec §6, §12; slice 5 Decision 12), only for a harness that declares them (D0):
 * the tools built in memory as `check` builds them, an action's pre-steps before the first message (TaskDeps.prepare,
 * as the app's tools host builds it) and the agent's `tools` MCP server, all through the app's own registry and broker
 * (cliTools). Each call prints one line; the trace and the `pre` usage row are written in the run's folder as the app
 * writes them. Keys come only from the hidden prompt, as `tool run` asks them (A5); fetches reach public hosts only.
 */

/** As the app's tools host: the only texts an agent call fails with outside the registry's own answers. */
const TOOL_BROKE = "Something went wrong running the tool";
const INVALID = "Invalid request";
const NO_TASK = "No task is running in this session";

/** One line for the terminal: no control characters, no line break (as tool-run.ts). */
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

/** A refused start's reason is cut here: it goes to stderr as one short line. */
const FAILED_CHARS = 300;

/** The broker's cap on a response body (FETCH_LIMITS.maxBytes), as `plugin record` reads it. */
const MAX_BODY = 10 * 1024 * 1024;

/** The body as text, read up to the broker's own cap (10 MB): past it the read stops and the request fails. */
async function cappedText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The response is larger than 10 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * `run --record`'s transport for one tool (tools Decision 8), as `plugin record`'s recordingTransport: each completed
 * fetch and exec is kept as the broker made it (keys already filled in) and as the service answered, for
 * `writeToolRecordings` to strip and write. The broker's checks run before it is called.
 */
function recordingTransport(tool: string, t: { fetch: typeof fetch; run: typeof runFile }, kept: ToolExchange[]): { fetch: typeof fetch; run: typeof runFile } {
  return {
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init.method ?? "GET").toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers));
      const body = typeof init.body === "string" ? init.body : undefined;
      const res = await t.fetch(url, init);
      const text = await cappedText(res);
      // A session cookie isn't one of the tool's keys, but it is a credential: it never goes into a recording.
      const outHeaders = Object.fromEntries([...res.headers].filter(([k, v]) => k !== "set-cookie" && k.length <= 200 && v.length <= 8192));
      const exchange: FixtureExchange = {
        kind: "fetch",
        request: { method, url, ...(Object.keys(headers).length > 0 ? { headers } : {}), ...(body !== undefined ? { body } : {}) },
        response: { status: res.status, headers: outHeaders, text },
      };
      kept.push({ tool, exchange });
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(nullBody ? null : text, { status: res.status, headers: res.headers });
    }) as typeof fetch,
    run: (async (file, args, o) => {
      const out = await t.run(file, args, o);
      kept.push({ tool, exchange: { kind: "exec", request: { cmd: path.basename(file), args: [...args] }, response: { code: out.code, stdout: out.stdout, stderr: out.stderr } } });
      return out;
    }) as typeof runFile,
  };
}

/** The broker's data op as the person path's request (`query` flat), as the app's tools host does. */
function dataRequest(op: BrokerDataOp): unknown {
  if (op.op === "query") return { op: "query", collection: op.collection, ...op.query };
  if (op.op === "replaceAll") throw new Error("Unknown call");
  return op;
}

/**
 * The args `run --record` keeps for an agent call: none is `{}` (the registry runs it as `{}`), an object as is; anything
 * else is null and the call is left out, since replay would send something else (end follow-up M23).
 */
export function recordedArgs(args: unknown): Record<string, unknown> | null {
  if (args === undefined) return {};
  return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
}

/** A call's line ("tool echo · 3 ms · ok"), or a trace note's (a pre-step's cut). */
function callLine(e: TraceEntry): string {
  if (typeof e.note === "string") return `tool ${e.tool} · ${e.note}`;
  return `tool ${e.tool} · ${e.ms} ms · ${e.ok ? "ok" : `failed${e.error !== undefined ? `: ${e.error}` : ""}`}`;
}

/** The tools built and the keys typed: everything `run` does before the engine starts or the folder is made. */
export interface ReadyTools {
  files: Map<string, Uint8Array | string>;
  keys: Map<string, string>;
}

/**
 * Before the engine and the folder (a stop leaves nothing behind): the P12 note (A1), the in-memory build (a problem is
 * a CliError with its text) and the keys of the tools this run can reach (the agent's and the action's pre-steps'),
 * each asked once, hidden, and only in a terminal.
 */
export async function readyTools(harness: LoadedHarness, action: string, out: Writable, d: ToolRunDeps): Promise<ReadyTools> {
  out.write(`${TOOL_P12_NOTE}\n`);
  const { json, files } = await buildTools(harness.root, { write: false, harness });
  const pre = new Set((Object.hasOwn(harness.actions, action) ? (harness.actions[action]!.pre ?? []) : []).map((s) => s.tool));
  const ids: string[] = [];
  for (const [id, meta] of Object.entries(json.tools).sort(([a], [b]) => a.localeCompare(b))) {
    if (meta.agent !== "call" && !pre.has(id)) continue;
    for (const s of meta.uses.secrets ?? []) if (!ids.includes(s)) ids.push(s);
  }
  if (ids.length > 0 && !d.isTTY) throw new CliError("run asks for the tools' keys in a terminal");
  if (ids.length > 0) out.write("While it runs, the tools can read the keys you type here.\n");
  const keys = new Map<string, string>();
  for (const id of ids) {
    const s = (harness.secrets ?? []).find((x) => x.id === id);
    const label = s?.label ?? id;
    const value = await d.readSecret(`${label}${s?.help ? ` (${s.help})` : ""}: `);
    if (value === "") throw new CliError(`No key was given for ${label}.`);
    keys.set(id, value);
  }
  return { files, keys };
}

export interface RunToolsOptions {
  harness: LoadedHarness;
  ready: ReadyTools;
  deps: ToolRunDeps;
  folder: string;
  references: { id: string; path: string }[];
  dataStore: DataStore;
  scopes: ScopeStore;
  usageLog: UsageLog;
  engine: string;
  /** The open task and its trailer (TaskManager): an agent call runs as that task, in its scope and part. */
  tasks: { runningTask(): Promise<{ id: string; scope: string } | null>; trailerNow(): Promise<{ task?: string; phase?: string } | undefined> };
  /** One line on the terminal (already one plain line, keys hidden). */
  line(text: string): void;
  /** The run's own log (stderr), never stdout: what the app's main would log. Already one plain line, keys hidden. */
  log(text: string): void;
  /**
   * `run --record` (tools Decision 8, 9): each agent call the registry answered goes here, and every fetch and exec
   * (pre-steps' too) is kept in `RunTools.exchanges`. Absent: nothing is kept.
   */
  record?: { call(tool: string, args: Record<string, unknown>): void };
}

export interface RunTools {
  /** TaskDeps.prepare, as the app's tools host's: never throws. */
  prepare: NonNullable<TaskDeps["prepare"]>;
  /** The runtime's `tools` option: only with tools on and an `agent: "call"` tool (else no server). */
  workspace?: { catalogue: string; request(request: unknown): Promise<unknown> };
  /** Why the last start's required pre-step failed (the task didn't start): one plain line, keys hidden, cut. */
  failed?: string;
  /** With `record`: every fetch and exec of the run and its reply, in order, keys still in them. */
  exchanges: ToolExchange[];
  /** Waits for the trace's writes, stops the host and removes the build. */
  close(): Promise<void>;
}

/** The run's tools: registry, broker and host over the in-memory build, in the run's folder. */
export async function startRunTools(o: RunToolsOptions): Promise<RunTools> {
  const h = o.harness;
  const keys = [...o.ready.keys.values()];
  const clean = (text: string) => (keys.length > 0 ? hideSecrets(plain(text), keys) : plain(text));
  const say = (text: string) => o.line(clean(text));
  const scoped = h.scopes !== undefined;
  // The registry and host read dist/ from a root of their own: the harness's own dist/ is never read or touched.
  const built = await fs.mkdtemp(path.join(os.tmpdir(), "hh-run-tools-"));
  let tools: ReturnType<typeof cliTools> | null = null;
  const trace = new ToolTrace({ base: o.folder });
  // As the app at start: entries past the trace's age go (prune never throws and creates nothing).
  void trace.prune().catch(() => undefined);
  let writes: Promise<unknown> = Promise.resolve();
  // Log lines the catalogue's read already printed ("Tools are off: …"): the registry's read says them again.
  const said = new Set<string>();
  try {
    await fs.mkdir(path.join(built, "dist", "tools"), { recursive: true });
    for (const [name, content] of o.ready.files) await fs.writeFile(path.join(built, "dist", ...name.split("/")), content);
    const data = toolDataRequests({
      store: async () => o.dataStore,
      history: async () => null,
      blocked: () => null,
      scopeExists: async (id) => (scoped ? (await o.scopes.list()).some((s) => s.id === id && !s.archived) : id === MAIN_SCOPE),
      noScope: () => (scoped ? APP_SCOPE : MAIN_SCOPE),
      serial: dataWriteQueue(),
    });
    // A second guard, as tool run: each request's host is asked again right before it leaves.
    const transport = {
      fetch: (async (input: string, init?: RequestInit) => {
        const host = new URL(String(input)).hostname;
        if (!(await o.deps.allowHost(host))) throw new Error(`Not a public host: ${host}`);
        return o.deps.transport.fetch(input, init);
      }) as typeof fetch,
      run: o.deps.transport.run,
    };
    const exchanges: ToolExchange[] = [];
    const registryTools = cliTools({
      root: built,
      harness: h,
      transport: (tool) => (o.record ? recordingTransport(tool, transport, exchanges) : transport),
      secrets: async (asked) => Object.fromEntries(asked.filter((id) => o.ready.keys.has(id)).map((id) => [id, o.ready.keys.get(id)!])),
      allowHost: o.deps.allowHost,
      resolve: o.deps.resolve,
      data: (op, ctx) => data(dataRequest(op), { scope: ctx.scope, tool: ctx.tool }),
      folder: { base: o.folder, references: o.references },
      onTrace: (e) => {
        say(callLine(e));
        writes = writes.then(() => trace.append(e)).catch(() => say(`tool ${e.tool} · not traced`));
      },
      log: (text) => {
        if (!said.has(text)) say(text);
      },
    });
    tools = registryTools;
    const registry = registryTools.registry;

    // The agent's catalogue, as the app writes it: only with tools on and a tool the agent may call.
    const state = await readToolsJson(built, h, (m) => {
      said.add(m);
      say(m);
    });
    const list = state.on
      ? Object.entries(state.tools)
          .filter(([, m]) => m.agent === "call")
          .map(([name, m]) => ({ name, description: m.description, inputSchema: m.params }))
      : [];
    let catalogue: string | undefined;
    if (list.length > 0) {
      catalogue = path.join(built, "catalogue.json");
      await fs.writeFile(catalogue, `${JSON.stringify(list)}\n`, { mode: 0o600 });
    }

    const run: RunTools = {
      exchanges,
      async prepare(p) {
        try {
          // Shared with the app's tools host (prepare-task.ts): steps, section, cut notes, the `pre` row.
          const answer = await prepareTask(p, {
            registry,
            action: Object.hasOwn(h.actions, p.action) ? h.actions[p.action] : undefined,
            scoped,
            descriptions: async () => (state.on ? Object.fromEntries(Object.entries(state.tools).map(([id, m]) => [id, m.description])) : {}),
            row: (f) => o.usageLog.append(preRecord({ engine: o.engine, ...f })).catch(() => say("Could not record the pre-steps in usage.jsonl")),
          });
          if (answer.failed !== undefined) {
            // The tool's error goes to stderr: one plain line, keys hidden, cut, as every other tool line.
            run.failed = [...clean(answer.failed)].slice(0, FAILED_CHARS).join("");
            return { ...answer, failed: run.failed };
          }
          return answer;
        } catch (err) {
          // Never the thrown text to the person (P5), as the app: it goes to the run's log only.
          o.log(clean(`Could not run the pre-steps: ${err instanceof Error ? err.message : String(err)}`));
          run.failed = PREPARE_FAILED;
          return { text: "", items: [], views: [], failed: run.failed };
        }
      },
      ...(catalogue
        ? {
            workspace: {
              catalogue,
              // As the app's agentCall: the caller is the open task, never the request; only the registry's own answers
              // reach the agent, anything else is a fixed text.
              request: async (request: unknown) => {
                if (typeof request !== "object" || request === null || Array.isArray(request)) throw new Error(INVALID);
                const { tool, args } = request as { tool?: unknown; args?: unknown };
                if (typeof tool !== "string") throw new Error(INVALID);
                const [task, trailer] = await Promise.all([o.tasks.runningTask(), o.tasks.trailerNow()]);
                if (!task) throw new Error(NO_TASK);
                const phase = trailer?.task === task.id && trailer.phase !== undefined ? { phase: trailer.phase } : {};
                let answer;
                try {
                  answer = await registry.call({ tool, args, caller: "agent", scope: task.scope, task: task.id, ...phase });
                } catch {
                  throw new Error(TOOL_BROKE);
                }
                if (!answer.ok) throw new Error(answer.error);
                // Only a call that answered: replay makes the call again, and a refused one would fail the turn.
                if (o.record) {
                  const kept = recordedArgs(args);
                  // Replay sends the recorded args as they are: a call whose args aren't an object can't be replayed the same.
                  if (kept) o.record.call(tool, kept);
                  else say(`Note: a call to ${tool} was left out of the recording: its arguments aren't an object.`);
                }
                return answer.result;
              },
            },
          }
        : {}),
      async close() {
        await writes;
        registryTools.close();
        await fs.rm(built, { recursive: true, force: true });
      },
    };
    return run;
  } catch (err) {
    tools?.close();
    await fs.rm(built, { recursive: true, force: true });
    throw err;
  }
}
