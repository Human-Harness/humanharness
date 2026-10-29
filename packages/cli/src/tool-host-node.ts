import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { type LoadedHarness, TOOL_ID, loadHarness } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import type { BrokerAnswer, runFile } from "@humanharness/shell/plugins";
import { ToolBroker, type ToolBrokerDeps, ToolRegistry, type ToolRegistryDeps, type ToolsState, type TraceEntry, readToolsJson, toolFiles } from "@humanharness/shell/tools";
import { MANIFEST } from "./paths";

/**
 * The terminal's way to run a harness's built tools (tools spec §11; slice 5 threat row A1): `tool test`, `tool run`
 * and `run` call them through the app's own registry and broker, so a tool is checked here as the app checks it. The
 * host is not the app's sandbox (P12): each tool runs in a `vm` context of its own that holds only plugin-run.ts's
 * globals (no `fetch`, `process`, `require` or `Buffer`), so a well-behaved tool goes through `ctx` as in the app, but
 * those globals and `ctx` are this realm's values and any of them hands the tool this realm's `Function`. Run only
 * tools you trust.
 */

/** A1: printed once per command, before any tool code runs. */
export const TOOL_P12_NOTE = "Note: tool code runs in this Node process, not in the app's sandbox. Run only tools you trust.";

type Host = ToolRegistryDeps["host"];
type HostCall = Parameters<Host["call"]>[0];
type HostAnswer = Awaited<ReturnType<Host["call"]>>;

/** As resources/tool-host.mjs: errors and summaries cut at 16,000 characters (the registry hides keys, then cuts again). */
const ERROR_CHARS = 16_000;
const SUMMARY_CHARS = 16_000;
/** A `console` line of a tool is kept up to this many characters. */
const CONSOLE_CHARS = 2000;

export interface NodeToolHostOptions {
  /** Where a tool's `ctx` calls go: the broker of `tool`, under the call id the registry's broker made. */
  ctx(tool: string, callId: string, name: string, args: unknown[]): Promise<BrokerAnswer>;
  /** A tool's `console` line (dropped when absent). */
  console?(line: string): void;
}

/** An error's message from any realm (a tool's errors aren't this realm's Error). */
function errorText(e: unknown, max: number = ERROR_CHARS): string {
  const message = e !== null && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : String(e);
  return message.slice(0, max);
}

function errorName(e: unknown): string {
  const name = e !== null && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
  return typeof name === "string" ? name : "Error";
}

function toolRefused(answer: unknown): Error {
  const refused = (answer as { refused?: unknown } | null)?.refused;
  const err = new Error(typeof refused === "string" ? refused : "Refused");
  err.name = "ToolRefused";
  return err;
}

/** `v` and everything in it frozen; a typed array or DataView can't be frozen and is left as it is. */
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !ArrayBuffer.isView(v) && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

/** `v` holds a function, a symbol or a bigint (at the top or inside), which JSON would drop or turn into null; a cycle too. */
function notJson(v: unknown): boolean {
  let bad = false;
  try {
    JSON.stringify(v, (_k, x: unknown) => {
      const t = typeof x;
      if (t === "function" || t === "symbol" || t === "bigint") bad = true;
      return t === "bigint" ? null : x;
    });
  } catch {
    bad = true;
  }
  return bad;
}

/**
 * The `ctx` of one call: resources/tool-host.mjs's `contextOf`, kept as a second copy because that file runs in the
 * sandbox. Arguments cross into this realm as IPC carries them in the app (structured clone), so the broker's
 * plain-object checks see this realm's objects.
 */
export function toolContext(call: (name: string, args: unknown[]) => Promise<BrokerAnswer>, scope: unknown, inputs: unknown) {
  const c = async (name: string, ...args: unknown[]) => {
    // JSON turns a trailing undefined into null; the broker counts arguments.
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
    let cloned: unknown[];
    try {
      cloned = structuredClone(args);
    } catch {
      throw toolRefused({ refused: `Wrong arguments (${name})` });
    }
    const answer = await call(name, cloned);
    if (!answer || answer.ok !== true) throw toolRefused(answer);
    return answer.value;
  };
  let own: unknown = {};
  if (inputs !== null && typeof inputs === "object" && !Array.isArray(inputs)) {
    try {
      own = structuredClone(inputs);
    } catch {
      own = {};
    }
  }
  return Object.freeze({
    async fetch(url: unknown, init?: unknown) {
      const r = (await c("fetch", url, init)) as { url?: unknown; status?: unknown; ok?: unknown; headers?: unknown; text?: unknown } | null;
      const text = typeof r?.text === "string" ? r.text : "";
      return { url: r?.url, status: r?.status, ok: r?.ok, headers: r?.headers ?? {}, text: () => text, json: () => JSON.parse(text) as unknown };
    },
    exec: (cmd: unknown, args: unknown) => c("exec", cmd, args),
    data: Object.freeze({
      get: (collection: unknown, key?: unknown) => c("data.get", collection, key),
      query: (collection: unknown, q?: unknown) => c("data.query", collection, q),
      put: (collection: unknown, record: unknown) => c("data.put", collection, record),
      patch: (collection: unknown, key: unknown, patch: unknown) => c("data.patch", collection, key, patch),
      delete: (collection: unknown, key?: unknown) => c("data.delete", collection, key),
    }),
    files: Object.freeze({
      read: (p: unknown) => c("files.read", p),
      list: (dir: unknown, glob?: unknown) => c("files.list", dir, glob),
    }),
    scope: typeof scope === "string" ? scope : null,
    inputs: deepFreeze(own),
    // Fire-and-forget (ToolContext.log returns nothing): a refused or failed log line never fails the tool.
    log(level: unknown, message: unknown) {
      c("log", level, message).catch(() => undefined);
    },
    summary: (text: unknown) => c("summary", text).then(() => undefined),
    requestAi: (input: unknown) =>
      notJson(input) ? Promise.reject(toolRefused({ refused: "ctx.requestAi takes JSON data" })) : c("requestAi", input).then(() => undefined),
  });
}

interface Esbuild {
  transform(code: string, options: Record<string, unknown>): Promise<{ code: string }>;
}
const req = createRequire(import.meta.url);
/** esbuild as tsx carries it, as `build` and plugin-run.ts load it. */
const esbuild = () => createRequire(req.resolve("tsx/package.json"))("esbuild") as Esbuild;

interface Loaded {
  def: { run: (args: unknown, ctx: unknown) => unknown; summary?: unknown };
  context: vm.Context;
}

/** The `console` of a tool's context: every line goes to `sink`. */
function consoleInto(tool: string, sink: ((line: string) => void) | undefined) {
  const line =
    (level: string) =>
    (...args: unknown[]) => {
      if (!sink) return;
      const text = args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ");
      sink(`${tool}: console.${level}: ${text}`.slice(0, CONSOLE_CHARS));
    };
  return { log: line("log"), info: line("info"), warn: line("warn"), error: line("error"), debug: line("debug") };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Calls `fn(args, ctx)` inside the tool's context with a time limit on its synchronous part, so a tool stuck in an
 * endless loop before its first `await` is stopped. A loop after an `await` can't be stopped in this process; the
 * registry's timer still answers the call.
 */
function callWithLimit(context: vm.Context, fn: unknown, args: unknown, ctx: unknown, limitMs: number, tool: string): unknown {
  (context as { __hhCall?: unknown }).__hhCall = { fn, args, ctx };
  try {
    return vm.runInContext("(() => { const c = globalThis.__hhCall; delete globalThis.__hhCall; return c.fn(c.args, c.ctx); })()", context, { timeout: limitMs });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw new Error(`${tool} took longer than ${limitMs / 1000} s`);
    throw e;
  }
}

/**
 * The registry's host in the terminal: each built tool (`dist/tools/<id>.js`, the bytes the app runs) evaluated once
 * in a fresh `vm` context holding only plugin-run.ts's globals, its `ctx` forwarding every call to the broker with the
 * call id. The ES module becomes an IIFE in memory (esbuild), as plugin-run.ts loads a backend. Not a sandbox (P12).
 */
export function nodeToolHost(root: string, o: NodeToolHostOptions): Host & { close(): void } {
  const loaded = new Map<string, Promise<Loaded>>();
  // Every tool's timers, cleared on close, so one left behind can't keep the command alive.
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;

  const globalsOf = (tool: string) => ({
    console: consoleInto(tool, o.console),
    setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const t = setTimeout(
        (...a: unknown[]) => {
          timers.delete(t);
          fn(...a);
        },
        ms,
        ...args,
      );
      timers.add(t);
      return t;
    },
    clearTimeout: (t: NodeJS.Timeout | undefined) => {
      if (t === undefined) return;
      timers.delete(t);
      clearTimeout(t);
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
  });

  const load = async (tool: string): Promise<Loaded> => {
    // The registry hands only a tools.json id; the bundle is found by that id alone, never by a path it names.
    if (!TOOL_ID.test(tool)) throw new Error(`No tool "${tool.slice(0, 64)}"`);
    const rel = path.posix.join("dist", "tools", `${tool}.js`);
    const file = path.join(root, "dist", "tools", `${tool}.js`);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile()) throw new Error(`${rel} is missing: run humanharness build`);
    const code = await fs.readFile(file, "utf8");
    let iife: string;
    try {
      iife = (await esbuild().transform(code, { format: "iife", globalName: "__hhTool", target: "node22" })).code;
    } catch (err) {
      throw new Error(`${rel} can't be loaded: ${errorText(err, 500)}`);
    }
    const context = vm.createContext({ ...globalsOf(tool) });
    vm.runInContext(iife, context, { filename: `${tool}.js` });
    const def = (context as { __hhTool?: { default?: unknown } }).__hhTool?.default as Loaded["def"] | undefined;
    delete (context as { __hhTool?: unknown }).__hhTool;
    if (def === null || typeof def !== "object" || typeof def.run !== "function") throw new Error("its default export has no run function");
    return { def, context };
  };

  const loadOnce = (tool: string): Promise<Loaded> => {
    let p = loaded.get(tool);
    if (!p) {
      p = load(tool);
      loaded.set(tool, p);
    }
    return p;
  };

  const runOne = async (c: HostCall, timeoutMs: number): Promise<HostAnswer> => {
    let value: unknown;
    let def: Loaded["def"];
    try {
      const l = await loadOnce(c.tool);
      def = l.def;
      const ctx = toolContext((name, args) => o.ctx(c.tool, c.callId, name, args), c.scope, c.inputs);
      // The tool gets its own copy of the args, as the app's IPC gives it.
      value = await callWithLimit(l.context, def.run, structuredClone(c.args), ctx, timeoutMs, c.tool);
    } catch (e) {
      // As the app's host: the message only.
      return { ok: false, error: errorText(e) };
    }
    let out: unknown;
    try {
      // The result crosses back as the app's IPC carries it: a copy, or the call fails.
      out = structuredClone(value === undefined ? null : value);
    } catch (e) {
      return { ok: false, error: `The result can't be sent: ${errorName(e)}: ${errorText(e)}`.slice(0, ERROR_CHARS) };
    }
    const answer: HostAnswer = { ok: true, value: out };
    if (typeof def.summary === "function") {
      try {
        const s = (def.summary as (v: unknown) => unknown)(value);
        if (typeof s === "string") answer.summary = s.slice(0, SUMMARY_CHARS);
      } catch {
        // No summary: the registry writes a generic one.
      }
    }
    return answer;
  };

  return {
    call(c, timeoutMs) {
      if (closed) return Promise.resolve({ ok: false, error: "Tools stopped" });
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<HostAnswer>((settle) => {
        timer = setTimeout(() => settle({ ok: false, error: `${c.tool} took longer than ${timeoutMs / 1000} s` }), timeoutMs);
      });
      return Promise.race([runOne(c, timeoutMs), late]).finally(() => clearTimeout(timer));
    },
    off: () => null,
    close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      loaded.clear();
    },
  };
}

export interface CliToolsOptions {
  /** The harness root (its dist/ holds the built tools). */
  root: string;
  /** The loaded manifest, when the caller has it; else harness.config.ts is loaded at the first call. */
  harness?: LoadedHarness;
  /** fetch and exec of every tool: fixtures, a recording, or the real ones (`tool run`). Used after every check. */
  transport(tool: string): { fetch: typeof fetch; run: typeof runFile };
  /** The keys a tool's `uses.secrets` names, by id; the only place keys come from. */
  secrets(ids: string[]): Promise<Record<string, string>>;
  /**
   * Each fetch hop's host may be reached (after the broker refused localhost and IP literals): `isPublicHost` for a
   * live run; a run on recorded exchanges reaches no network and may allow every name.
   */
  allowHost(hostname: string): Promise<boolean>;
  /** A command's absolute path; absent: nothing on this computer is looked up and a command answers /fixture/<name>. */
  resolve?(cmd: string): Promise<string | null>;
  /** The data path (`ctx.data`): an in-memory store for fixtures, the folder's store for `tool run` and `run`. */
  data: ToolBrokerDeps["data"];
  /** The folder `ctx.files` reaches, and its reference folders. */
  folder: { base: string; references: { id: string; path: string }[] };
  /** Trace entries: kept in memory for printing; `run` may also write them where the app does. */
  onTrace?(e: TraceEntry): void;
  /** A tool's `ctx.log` and `console` lines and the host's own, every key handed out hidden. */
  log?(line: string): void;
  now?: () => Date;
}

/** B7 as the app's tools: a command sees PATH, HOME and LANG and TERM=dumb, nothing else. */
function minimalEnv(): Record<string, string> {
  const out: Record<string, string> = { TERM: "dumb" };
  for (const k of ["PATH", "HOME", "LANG"] as const) {
    const v = process.env[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** A registry over the terminal's host: the app's registry, broker and trace (A1), with the caller's transport and keys. */
export function cliTools(o: CliToolsOptions): { registry: ToolRegistry; entries: TraceEntry[]; close(): void } {
  const entries: TraceEntry[] = [];
  // Every key handed to a broker: no log line shows one.
  const handed = new Set<string>();
  const say = (line: string) => o.log?.(handed.size > 0 ? hideSecrets(line, [...handed]) : line);
  const secrets = async (ids: readonly string[]) => {
    const values = await o.secrets([...ids]);
    for (const v of Object.values(values)) if (typeof v === "string" && v !== "") handed.add(v);
    return values;
  };
  // Commands run in an empty folder of this command's own, removed on close.
  const work = mkdtempSync(path.join(os.tmpdir(), "hh-tools-"));
  let reading: Promise<ToolsState> | null = null;
  /** tools.json as read, once read: the registry asks a broker only after json() answered. */
  let state: ToolsState | null = null;
  let harness: LoadedHarness | null = o.harness ?? null;
  const json = (): Promise<ToolsState> => {
    reading ??= (async () => {
      harness ??= await loadHarness(path.join(o.root, MANIFEST));
      state = await readToolsJson(o.root, harness, (m) => say(m));
      return state;
    })();
    return reading;
  };
  const brokers = new Map<string, ToolBroker>();
  const brokerOf = (tool: string): ToolBroker => {
    let b = brokers.get(tool);
    if (b) return b;
    if (!state?.on || !harness || !Object.hasOwn(state.tools, tool)) throw new Error(`Unknown tool "${tool}"`);
    b = new ToolBroker({
      harnessId: harness.id,
      tool,
      meta: state.tools[tool]!,
      secrets: harness.secrets ?? [],
      // Keys come from the caller only: never the app's store, never a file.
      store: { harnessValues: (ids) => secrets(ids) },
      data: o.data,
      files: async () => toolFiles(o.folder),
      // The broker reaches both through `transport`, after every check; these are its fallbacks only.
      fetch: ((input: string, init?: RequestInit) => o.transport(tool).fetch(input, init)) as typeof fetch,
      allowHost: o.allowHost,
      userData: work,
      exec: {
        resolve: o.resolve ?? (async (cmd) => path.resolve(path.sep, "fixture", path.basename(cmd))),
        run: (file, args, opts) => o.transport(tool).run(file, args, opts),
        env: async () => minimalEnv(),
      },
      log: async (level, message) => say(`${tool}: ${level}: ${message}`),
      transport: (t) => o.transport(t),
    });
    brokers.set(tool, b);
    return b;
  };
  const host = nodeToolHost(o.root, {
    ctx: async (tool, callId, name, args) => brokerOf(tool).call(callId, name, args),
    console: say,
  });
  const registry = new ToolRegistry({
    json,
    host,
    broker: brokerOf,
    trace: {
      append: async (e) => {
        entries.push(e);
        o.onTrace?.(e);
      },
    },
    secretValues: async (tool) => {
      const s = await json();
      const ids = s.on && Object.hasOwn(s.tools, tool) ? (s.tools[tool]!.uses.secrets ?? []) : [];
      return ids.length > 0 ? Object.values(await secrets(ids)) : [];
    },
    ...(o.now ? { now: o.now } : {}),
    log: (message, err) => say(err === undefined ? message : `${message}: ${errorText(err, 500)}`),
  });
  return {
    registry,
    entries,
    close() {
      host.close();
      for (const b of brokers.values()) b.killAll();
      rmSync(work, { recursive: true, force: true });
    },
  };
}
