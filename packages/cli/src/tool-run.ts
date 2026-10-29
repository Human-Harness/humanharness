import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { type LoadedHarness, dataCollections, hasTools, loadHarness } from "@humanharness/harness-sdk";
import { hideSecrets } from "@humanharness/harness-sdk/plugin-fixtures";
import { type BrokerDataOp, isPublicHost, runFile } from "@humanharness/shell/plugins";
import { dataWriteQueue, toolDataRequests } from "@humanharness/shell/tasks";
import type { TraceEntry } from "@humanharness/shell/tools";
import { APP_SCOPE, DataStore, MAIN_SCOPE, ScopeStore, isScopeDir } from "@humanharness/workspace";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { MANIFEST } from "./paths";
import { hiddenReader, resolveOnPath } from "./plugin-record";
import { buildTools } from "./tool-build";
import { TOOL_P12_NOTE, cliTools } from "./tool-host-node";
import { NO_TOOLS } from "./tool-test";

export const TOOL_RUN_USAGE = [
  "Usage: humanharness tool run <id> [--args '<json>'] [--folder <dir>] [--scope <id>] [--yes] [--harness <dir>]",
  "",
  "Builds the harness's tools in memory and runs <id> once, for real, through the app's registry: its fetches reach",
  "public hosts only, its commands run on this computer, and it reads and writes the folder (--folder, or a new one",
  "under the system's temp folder) and the folder's data. Each key the tool declares is asked here, hidden: the",
  "terminal can't read the app's keys. A tool that writes runs only with --yes. Prints the result and the trace;",
  "a failed call exits with 1.",
  "",
].join("\n");

export interface ToolRunDeps {
  /** Real fetch and runFile (the defaults); tests inject their own. */
  transport: { fetch: typeof fetch; run: typeof runFile };
  /** Asks a key with the typed characters hidden (plugin-record's `hiddenReader`). */
  readSecret(label: string): Promise<string>;
  /** A host resolves only to public addresses (`isPublicHost`). */
  allowHost(hostname: string): Promise<boolean>;
  /** A command's absolute path on this computer (plugin-record's `resolveOnPath`). */
  resolve(cmd: string): Promise<string | null>;
  isTTY: boolean;
}

export interface ToolRunOptions {
  tool: string;
  args: Record<string, unknown>;
  /** The folder `ctx.files` and the data reach; absent: a new folder under `temp`, printed and kept (as `run`). */
  folder?: string;
  /** `ctx.scope` and the data's scope; absent: none. */
  scope?: string;
  /** A tool that writes (data or files) runs only with it (A6). */
  yes?: boolean;
  out: Writable;
  /** Where the build and a default folder go (the system's temp folder by default). */
  temp?: string;
}

/** The live deps, over this process's terminal (Decision 6). */
export function liveToolRunDeps(stdin: Readable, stdout: Writable): ToolRunDeps {
  return {
    transport: { fetch: globalThis.fetch, run: runFile },
    readSecret: hiddenReader(stdin, stdout),
    allowHost: isPublicHost,
    resolve: resolveOnPath,
    isTTY: (stdin as { isTTY?: boolean }).isTTY === true,
  };
}

/** A line for the terminal: no control characters a tool could use to redraw it. */
const plain = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");

/** The broker's data op as the person path's request (`query` flat), as the app's tools host does. */
function dataRequest(op: BrokerDataOp): unknown {
  if (op.op === "query") return { op: "query", collection: op.collection, ...op.query };
  if (op.op === "replaceAll") throw new Error("Unknown call");
  return op;
}

/** One trace entry as lines: the call, then each access. */
function traceLines(e: TraceEntry): string[] {
  const lines = [`${e.tool} · ${e.ms} ms · ${e.ok ? "ok" : `failed${e.error !== undefined ? `: ${e.error.split("\n")[0]}` : ""}`}`];
  for (const a of e.accesses) lines.push(`  ${a.kind} ${a.target} ${a.allowed ? "allowed" : "denied"}`);
  return lines;
}

/**
 * `humanharness tool run <id>` (tools spec §11, Decisions 5–6): the harness's tools built in memory, then one real call
 * of `tool` through the app's registry and broker (cliTools). Keys only from the hidden prompt (A5), never the app's
 * store or a file; every fetch hop's host must be public (`allowHost`, checked by the broker and again here before the
 * request); commands through the real runner. `ctx.files` is the folder and `ctx.data` the folder's own store, as the
 * tool (`who: "tool"`), in `scope`. A tool whose `uses` writes needs `yes` (A6). The P12 note goes first; then the
 * result or the error and the trace, every key typed hidden. Nothing is saved but what the tool itself writes.
 */
export async function runToolOnce(dir: string, o: ToolRunOptions, d: ToolRunDeps): Promise<number> {
  const root = path.resolve(dir);
  const harness: LoadedHarness = await loadHarness(path.join(root, MANIFEST));
  if (!hasTools(harness)) throw new CliError(NO_TOOLS);
  const ids = Object.keys(harness.tools ?? {}).sort();
  if (!ids.includes(o.tool)) throw new UsageError(`"${o.tool.slice(0, 64)}" is not a tool of ${harness.id}: ${ids.join(", ")}.`);
  if (o.scope !== undefined && !isScopeDir(o.scope)) throw new UsageError(`"${String(o.scope).slice(0, 64)}" is not a scope id.`);
  let folder: string | undefined;
  if (o.folder !== undefined) {
    folder = path.resolve(o.folder);
    const st = await fs.stat(folder).catch(() => null);
    if (!st?.isDirectory()) throw new CliError(`No folder at ${folder}`);
  }
  o.out.write(`${TOOL_P12_NOTE}\n`);
  // A build problem is a CliError (ToolBuildError) with its text.
  const { json, files } = await buildTools(root, { write: false, harness });
  const uses = json.tools[o.tool]!.uses;
  // Before any key is typed or any folder made (A6).
  if (o.yes !== true && ((uses.data?.write?.length ?? 0) > 0 || uses.files === "write")) {
    throw new CliError(`This tool writes to ${folder ?? "a new folder"}. Add --yes to run it for real.`);
  }
  const declared = uses.secrets ?? [];
  if (declared.length > 0 && !d.isTTY) throw new CliError("tool run asks for keys in a terminal");

  const keys = new Map<string, string>();
  if (declared.length > 0) o.out.write("While it runs, the tool can read the keys you type here.\n");
  for (const id of declared) {
    const s = (harness.secrets ?? []).find((x) => x.id === id);
    const label = s?.label ?? id;
    const value = await d.readSecret(`${label}${s?.help ? ` (${s.help})` : ""}: `);
    if (value === "") throw new CliError(`No key was given for ${label}.`);
    keys.set(id, value);
  }
  const hide = (text: string) => hideSecrets(plain(text), [...keys.values()]);
  const say = (text: string) => o.out.write(`${hide(text)}\n`);

  const base = o.temp ?? os.tmpdir();
  if (folder === undefined) {
    folder = await fs.mkdtemp(path.join(base, `hh-run-${harness.id}-`));
    say(`Folder: ${folder}`);
  }
  const scoped = harness.scopes !== undefined;
  const store = new DataStore(folder, dataCollections(harness));
  const scopes = new ScopeStore(folder);
  const data = toolDataRequests({
    store: async () => store,
    history: async () => null,
    blocked: () => null,
    scopeExists: async (id) => (scoped ? (await scopes.list()).some((s) => s.id === id && !s.archived) : id === MAIN_SCOPE),
    noScope: () => (scoped ? APP_SCOPE : MAIN_SCOPE),
    serial: dataWriteQueue(),
  });
  // A second guard: each request's host is asked again right before it leaves (the broker asked at every hop).
  const transport = {
    fetch: (async (input: string, init?: RequestInit) => {
      const host = new URL(String(input)).hostname;
      if (!(await d.allowHost(host))) throw new Error(`Not a public host: ${host}`);
      return d.transport.fetch(input, init);
    }) as typeof fetch,
    run: d.transport.run,
  };

  // The registry and host read dist/ from a root of their own: the harness's own dist/ is never touched.
  const built = await fs.mkdtemp(path.join(base, "hh-tool-run-"));
  let tools: ReturnType<typeof cliTools> | null = null;
  try {
    await fs.mkdir(path.join(built, "dist", "tools"), { recursive: true });
    for (const [name, content] of files) await fs.writeFile(path.join(built, "dist", ...name.split("/")), content);
    tools = cliTools({
      root: built,
      harness,
      transport: () => transport,
      secrets: async (asked) => Object.fromEntries(asked.filter((id) => keys.has(id)).map((id) => [id, keys.get(id)!])),
      allowHost: d.allowHost,
      resolve: d.resolve,
      data: (op, ctx) => data(dataRequest(op), { scope: ctx.scope, tool: ctx.tool }),
      folder: { base: folder, references: [] },
      log: (line) => say(line),
    });
    const answer = await tools.registry.call({ tool: o.tool, args: o.args, caller: "ui", scope: o.scope ?? null });
    if (answer.ok) say(JSON.stringify(answer.result ?? null, null, 2));
    else say(`Error: ${answer.error}`);
    for (const e of tools.entries) for (const line of traceLines(e)) say(line);
    return answer.ok ? 0 : 1;
  } finally {
    tools?.close();
    await fs.rm(built, { recursive: true, force: true });
  }
}

/** `--args`: a JSON object, else a usage error. Absent: `{}`. */
function parseToolArgs(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new UsageError(`--args takes a JSON object, as '{"a":1}'.\n\n${TOOL_RUN_USAGE.trim()}`);
  return value as Record<string, unknown>;
}

/** The `tool run` command over `io`, with `deps` (the live ones from tool-command.ts; tests inject theirs). */
export async function toolRunCommand(args: string[], io: Io, deps: ToolRunDeps): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(TOOL_RUN_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, {
    args: { type: "string" },
    folder: { type: "string" },
    scope: { type: "string" },
    yes: { type: "boolean" },
    harness: { type: "string" },
  });
  if (positionals.length !== 1) throw new UsageError(TOOL_RUN_USAGE.trim());
  const toolArgs = parseToolArgs(values.args);
  return runToolOnce(
    path.resolve(io.cwd, values.harness ?? "."),
    {
      tool: positionals[0]!,
      args: toolArgs,
      ...(values.folder !== undefined ? { folder: path.resolve(io.cwd, values.folder.replace(/^~(?=$|\/)/, os.homedir())) } : {}),
      ...(values.scope !== undefined ? { scope: values.scope } : {}),
      ...(values.yes === true ? { yes: true } : {}),
      out: io.stdout,
    },
    deps,
  );
}
