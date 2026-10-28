import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PLUGIN_API, type PluginManifest, checkPluginModels, parsePluginManifest, pluginCollections, pluginSettings, settingsValues } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import { type BrokerAnswer, type BrokerDataOp, PluginBroker, PluginData, type runFile } from "@humanharness/shell/plugins";
import { CliError } from "./cli";

/**
 * One source of a built plugin, run in this Node process against part 1's very broker (plugins Decisions 20–21), for
 * `humanharness plugin test` and `record`. The backend runs in a fresh `vm` context that holds only the globals below:
 * the same view of the world it gets in the app (no `fetch`, `process`, `require` or `Buffer`; everything goes through
 * `ctx`). It is not a sandbox (P12): run only plugins you trust.
 */

export interface RunOptions {
  /** The plugin root (dist/ inside). */
  dir: string;
  source: string;
  transport: { fetch: typeof fetch; run: typeof runFile };
  secrets(ids: string[]): Promise<Record<string, string>>;
  /** A command's absolute path; fixtures (the default) look up nothing and answer /fixture/<name>. */
  resolve?(cmd: string): Promise<string | null>;
  /** A live run's check that a host resolves only to public addresses (`record`); fixtures need none. */
  allowHost?(hostname: string): Promise<boolean>;
  /** The backend's clock, fixed for the run (`new Date()` and `Date.now()`); the real clock when absent. */
  now?: Date;
  /** Default 120_000, like the app. */
  runLimitMs?: number;
}

export interface RunReport {
  source: string;
  ok: boolean;
  error?: string;
  writes: Record<string, { count: number; keys: string[] }>;
  attention: { key: string; severity: string; title: string }[];
  chips: Record<string, string>;
  log: string[];
}

const DIST = "dist";
const ERROR_CHARS = 500;
const LOG_CHARS = 2000;
/** A run's raw error or console line is kept up to this many characters, then cut to size once its keys are hidden. */
const RAW_CHARS = 64 * 1024;
const SHOWN_KEYS = 3;
const WRITE_OPS = new Set(["put", "patch", "delete", "replaceAll"]);

/** dist/plugin.json, checked as the app's loader checks it; a CliError when it can't run. */
export async function readBuiltManifest(dir: string): Promise<PluginManifest> {
  const file = path.join(dir, DIST, "plugin.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new CliError(missing ? `${path.join(DIST, "plugin.json")} is missing: run humanharness plugin build.` : `${path.join(DIST, "plugin.json")} is not valid JSON.`);
  }
  let m: PluginManifest;
  try {
    m = parsePluginManifest(raw);
    checkPluginModels(m);
  } catch (err) {
    throw new CliError(`${path.join(DIST, "plugin.json")} is not valid: ${errorText(err)} (run humanharness plugin check).`);
  }
  if (m.api !== PLUGIN_API) throw new CliError(`plugin.json's api is ${m.api}; this core runs plugins of api ${PLUGIN_API}.`);
  return m;
}

/** An error's message from any realm (the backend's errors aren't this realm's Error). */
function errorText(e: unknown, max: number = ERROR_CHARS): string {
  const message = e !== null && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : String(e);
  return message.slice(0, max);
}

function pluginRefused(answer: unknown): Error {
  const refused = (answer as { refused?: unknown } | null)?.refused;
  const err = new Error(typeof refused === "string" ? refused : "Refused");
  err.name = "PluginRefused";
  return err;
}

/**
 * The backend's `ctx`: the host script's `contextOf` (packages/shell/resources/plugin-host.mjs), kept as a second
 * copy because that file runs in the sandbox and can't import the CLI. A test compares the two. Arguments cross into
 * this realm as IPC carries them (structured clone), so the broker's plain-object checks see this realm's objects.
 */
export function pluginContext(call: (name: string, args: unknown[]) => Promise<BrokerAnswer>) {
  const c = async (name: string, ...args: unknown[]) => {
    // JSON turns a trailing undefined into null; the broker counts arguments.
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
    let cloned: unknown[];
    try {
      cloned = structuredClone(args);
    } catch {
      throw pluginRefused({ refused: `Wrong arguments (${name})` });
    }
    const answer = await call(name, cloned);
    if (!answer || answer.ok !== true) throw pluginRefused(answer);
    return answer.value;
  };
  return {
    async fetch(url: unknown, init?: unknown) {
      const r = (await c("fetch", url, init)) as { url?: unknown; status?: unknown; ok?: unknown; headers?: unknown; text?: unknown } | null;
      const text = typeof r?.text === "string" ? r.text : "";
      return { url: r?.url, status: r?.status, ok: r?.ok, headers: r?.headers ?? {}, text: () => text, json: () => JSON.parse(text) };
    },
    exec: (cmd: unknown, args: unknown) => c("exec", cmd, args),
    data: {
      get: (collection: unknown, key?: unknown) => c("data.get", collection, key),
      query: (collection: unknown, q?: unknown) => c("data.query", collection, q),
      put: (collection: unknown, record: unknown) => c("data.put", collection, record),
      patch: (collection: unknown, key: unknown, patch: unknown) => c("data.patch", collection, key, patch),
      delete: (collection: unknown, key?: unknown) => c("data.delete", collection, key),
      replaceAll: (collection: unknown, records: unknown) => c("data.replaceAll", collection, records),
    },
    settings: { get: () => c("settings.get") },
    attention: { raise: (item: unknown) => c("attention.raise", item), resolve: (key: unknown) => c("attention.resolve", key) },
    chip: { set: (id: unknown, chip: unknown) => c("chip.set", id, chip), clear: (id: unknown) => c("chip.clear", id) },
    log: (level: unknown, message: unknown) => c("log", level, message),
  };
}

interface Esbuild {
  transform(code: string, options: Record<string, unknown>): Promise<{ code: string }>;
}
const req = createRequire(import.meta.url);
/** esbuild as tsx carries it, as `build` loads it (spike P-S8). */
const esbuild = () => createRequire(req.resolve("tsx/package.json"))("esbuild") as Esbuild;

/** `new Date()` and `Date.now()` at `ms`, set up inside the backend's context. */
const fixedClock = (ms: number) => `(() => {
  const D = Date;
  class FixedDate extends D {
    constructor(...a) { if (a.length === 0) super(${ms}); else super(...a); }
    static now() { return ${ms}; }
  }
  globalThis.Date = FixedDate;
})();`;

/**
 * dist/backend.js (the bytes the app runs) as the default export's `sources`, loaded the way spike P-S10 settled:
 * esbuild turns the ES module into an IIFE in memory, and `vm.runInContext` runs it in a context of its own.
 */
async function loadSources(dir: string, globals: Record<string, unknown>, now?: Date): Promise<Record<string, unknown>> {
  const file = path.join(dir, DIST, "backend.js");
  const code = await fs.readFile(file, "utf8").catch(() => {
    throw new CliError(`${path.join(DIST, "backend.js")} is missing: run humanharness plugin build.`);
  });
  let iife: string;
  try {
    iife = (await esbuild().transform(code, { format: "iife", globalName: "__hhBackend", target: "node22" })).code;
  } catch (err) {
    throw new CliError(`${path.join(DIST, "backend.js")} can't be loaded: ${errorText(err)}`);
  }
  const context = vm.createContext({ ...globals });
  if (now) vm.runInContext(fixedClock(now.getTime()), context);
  vm.runInContext(iife, context, { filename: "backend.js" });
  const found = (context as { __hhBackend?: { default?: { sources?: unknown } } }).__hhBackend?.default?.sources;
  return found !== null && typeof found === "object" ? (found as Record<string, unknown>) : {};
}

/** The `console` of the backend's context: every line goes to the report's log. */
function consoleInto(log: string[]) {
  const line =
    (level: string) =>
    (...args: unknown[]) =>
      log.push(`console.${level}: ${args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ")}`.slice(0, RAW_CHARS));
  return { log: line("log"), info: line("info"), warn: line("warn"), error: line("error"), debug: line("debug") };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Runs `o.source` of the built plugin in `o.dir` once, with its data in a temp folder removed after. */
export async function runSource(o: RunOptions): Promise<RunReport> {
  const m = await readBuiltManifest(o.dir);
  const report: RunReport = { source: o.source, ok: false, writes: {}, attention: [], chips: {}, log: [] };
  if (!m.sources.some((s) => s.id === o.source)) {
    report.error = `The source ${o.source} is not declared in plugin.json`;
    return report;
  }
  // Every key handed to the broker: no line of the report holds one, in any form we can see.
  const handed = new Set<string>();
  const secrets = async (ids: string[]) => {
    const values = await o.secrets(ids);
    for (const v of Object.values(values)) handed.add(v);
    return values;
  };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-plugin-run-"));
  let clearTimers = () => {};
  try {
    const base = path.join(temp, "base");
    await fs.mkdir(base);
    const data = new PluginData(base, m, { log: (message) => report.log.push(`data: ${message}`) });
    const written = new Set<string>();
    const settings = pluginSettings(m);
    const attention = new Map<string, { key: string; severity: string; title: string }>();
    const chips = new Map<string, string>();
    const cwd = path.join(temp, "exec");
    const broker = new PluginBroker({
      manifest: m,
      data: {
        run: async (op) => {
          const value = await runData(data, op);
          if (WRITE_OPS.has(op.op)) written.add(op.collection);
          return value;
        },
      },
      secrets,
      settings: async () => (settings ? settingsValues(settings, {}) : {}),
      attention: {
        raise: async (item) => void attention.set(item.key, { key: item.key, severity: item.severity, title: item.title }),
        resolve: async (key) => void attention.delete(key),
      },
      chips: (id, chip) => {
        if (chip) chips.set(id, chip.text);
        else chips.delete(id);
      },
      log: async (level, message) => void report.log.push(`${level}: ${message}`),
      fetch: o.transport.fetch,
      ...(o.allowHost ? { allowHost: o.allowHost } : {}),
      exec: {
        // The fixture transport matches by the command's name: nothing on this computer is looked up.
        resolve: o.resolve ?? (async (cmd) => path.resolve(path.sep, "fixture", path.basename(cmd))),
        run: o.transport.run,
        cwd: async () => {
          await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
          return cwd;
        },
        env: async () => minimalEnv(),
      },
    });
    // The backend's timers, cleared when the run ends, so one left behind can't keep the command alive.
    const timers = new Set<NodeJS.Timeout>();
    clearTimers = () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
    const backendSetTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
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
    };
    const backendClearTimeout = (t: NodeJS.Timeout | undefined) => {
      if (t === undefined) return;
      timers.delete(t);
      clearTimeout(t);
    };
    const sources = await loadSources(
      o.dir,
      {
        console: consoleInto(report.log),
        setTimeout: backendSetTimeout,
        clearTimeout: backendClearTimeout,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        structuredClone,
      },
      o.now,
    );
    const fn = Object.hasOwn(sources, o.source) ? sources[o.source] : undefined;
    if (typeof fn !== "function") {
      report.error = `backend.js has no source "${o.source}"`;
      return report;
    }
    const run = broker.startRun(o.source);
    const ctx = pluginContext((name, args) => broker.call(run.id, name, args));
    const limit = o.runLimitMs ?? 120_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => (fn as (c: unknown) => unknown)(ctx)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`The sync took longer than ${limit / 1000} s`)), limit);
        }),
      ]);
      report.ok = true;
    } catch (e) {
      report.error = errorText(e, RAW_CHARS);
    } finally {
      clearTimeout(timer);
      broker.endRun(run.id);
    }
    const collections = pluginCollections(m);
    for (const c of [...written].sort()) {
      const records = await data.readAll(c);
      const key = collections[c]?.key;
      report.writes[c] = { count: records.length, keys: records.slice(0, SHOWN_KEYS).map((r, i) => String(key !== undefined ? r[key] : i)) };
    }
    report.attention = [...attention.values()];
    report.chips = Object.fromEntries(chips);
    return report;
  } finally {
    clearTimers();
    // Cut to size only once the keys are hidden, so no cut-off part of one is left.
    report.log = report.log.map((line) => hideSecrets(line, [...handed]).slice(0, LOG_CHARS));
    if (report.error !== undefined) report.error = hideSecrets(report.error, [...handed]).slice(0, ERROR_CHARS);
    await fs.rm(temp, { recursive: true, force: true });
  }
}

/** The broker's data ops onto the plugin's own PluginData, as the app's controller maps them. */
function runData(data: PluginData, op: BrokerDataOp): Promise<unknown> {
  switch (op.op) {
    case "get":
      return data.get(op.collection, op.key);
    case "query":
      return data.query(op.collection, op.query);
    case "put":
      return data.put(op.collection, op.record as never);
    case "patch":
      return data.patch(op.collection, op.key, op.patch as never);
    case "delete":
      return data.delete(op.collection, op.key);
    case "replaceAll":
      return data.replaceAll(op.collection, op.records as never);
  }
}

/** B7: a plugin's command sees PATH, HOME and LANG and TERM=dumb, nothing else. */
function minimalEnv(): Record<string, string> {
  const out: Record<string, string> = { TERM: "dumb" };
  for (const k of ["PATH", "HOME", "LANG"] as const) {
    const v = process.env[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
