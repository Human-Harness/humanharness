import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type EngineDef, availableEngines } from "@humanharness/engines";
import { LANGUAGES, type Language, TIERS, type Tier, allBlocks, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { type ErrorCode, createRuntime } from "@humanharness/runtime";
import {
  ChatLog,
  type CommandDeps,
  SharedConfigStore,
  TaskManager,
  TaskStore,
  TurnController,
  UsageLog,
  createCommandDeps,
  detectEngine,
  engineCommand,
  memoise,
  nextFallback,
  resolveProfile,
  resolveReferences,
  sharedConfigDir,
  usageRecord,
} from "@humanharness/shell/tasks";
import { readNotes, writeNote } from "@humanharness/workspace";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { MANIFEST } from "./paths";
import { type RunReport, UsageTally, formatReport } from "./report";
import { TerminalView, errorMessage } from "./terminal";

export interface RunOptions {
  harnessDir: string;
  action: string;
  /** Default: the harness's first available engine. */
  engine?: string;
  /** Overrides the action's tier for this run. */
  tier?: Tier;
  /** Default: a new folder under the OS temp dir, printed and kept. */
  folder?: string;
  /** Default: English when the harness offers it, else its first language. */
  language?: Language;
  input: Readable;
  output: Writable;
  /** Aborting cancels the running turn (Ctrl-C). */
  signal?: AbortSignal;
  /** Tests: run this command instead of the engine's CLI, with no readiness check. Never credentials. */
  engineCommand?: { command: string[]; env: Record<string, string> };
}

/**
 * The engine's command when its official CLI is installed, current and signed in (as the app checks before a
 * first turn); otherwise a stop with the app's own message. Reads nothing from the CLI's own files.
 */
export async function readyEngine(engine: EngineDef, deps: CommandDeps, shared: SharedConfigStore): Promise<{ command: string[]; env: Record<string, string> }> {
  const stop = (code: ErrorCode): never => {
    throw new CliError(errorMessage(code, engine.name));
  };
  const status = await detectEngine(engine, deps, shared);
  if (!status.installed) stop("engine-not-installed");
  if (status.outdated) stop("outdated-version");
  if (status.loggedIn === false) stop("session-expired");
  return (await engineCommand(engine, deps)) ?? stop("engine-not-installed");
}

const promptFor = (options: number) =>
  options > 0 ? `\nPick 1–${options}, type a follow-up, or q to close the task: ` : "\nType a follow-up, or q to close the task: ";

/** Drives one task with the app's TaskManager (spec §8): brief, notes index, profile, checkpoint and closing turn. */
export async function runTask(o: RunOptions): Promise<RunReport> {
  const harness = await loadHarness(path.join(path.resolve(o.harnessDir), MANIFEST));
  const action = harness.actions[o.action];
  if (!Object.hasOwn(harness.actions, o.action) || !action) {
    throw new UsageError(`Unknown action "${o.action}". Actions: ${Object.keys(harness.actions).join(", ") || "(none)"}.`);
  }
  const offered = availableEngines(harness.engines, "development");
  const engine = o.engine ? offered.find((e) => e.id === o.engine) : offered[0];
  if (!engine) {
    throw new UsageError(`Engine "${o.engine ?? "(none)"}" is not available for ${harness.id}. Available: ${offered.map((e) => e.id).join(", ") || "none"}.`);
  }
  const language: Language = o.language ?? (harness.languages.includes("en") ? "en" : harness.languages[0]);
  if (!harness.languages.includes(language)) throw new UsageError(`${harness.id} does not offer the language "${language}".`);

  const folder = o.folder ? path.resolve(o.folder) : await fs.mkdtemp(path.join(os.tmpdir(), `hh-run-${harness.id}-`));
  await fs.mkdir(folder, { recursive: true });
  const out = o.output;
  out.write(`Folder: ${folder}\n`);
  const command = o.engineCommand ?? (await readyEngine(engine, createCommandDeps(process.execPath), new SharedConfigStore(sharedConfigDir())));

  const view = new TerminalView(out, engine.name, (out as { isTTY?: boolean }).isTTY === true);
  const tally = new UsageTally();
  const store = new TaskStore(folder);
  const usageLog = new UsageLog(folder);
  const references = await resolveReferences(harness.folder.references, { harnessDir: harness.root, home: os.homedir(), packaged: false });
  const gitdir = path.join(os.tmpdir(), "humanharness-run-history", `${harness.id}-${createHash("sha256").update(folder).digest("hex").slice(0, 12)}`);
  const stateBlocks = new Set(Object.entries(allBlocks(harness)).filter(([, b]) => !b.visible).map(([name]) => name));
  let lastNote: string | undefined;

  // Same wiring as the app's main process (packages/shell/src/main/index.ts), with the terminal as the window.
  const runtime = memoise(() =>
    createRuntime({
      harness,
      engine,
      folder,
      gitdir,
      language,
      command: command.command,
      env: command.env,
      references: references.map((r) => ({ label: r.label[language], path: r.path })),
      onSession: (s) => void tasks.sessionStarted(s).catch(() => undefined),
    }),
  );
  const turns = new TurnController({
    ensureRuntime: () => runtime.get(),
    chatLog: async () => new ChatLog(folder, engine.id),
    stateBlocks: () => stateBlocks,
    emit: (e) => view.event(e),
    recordUsage: async (entry, meta, firstLimits) => {
      tally.add(meta, entry.usage, !entry.error);
      const record = usageRecord(entry, engine.id, meta, firstLimits);
      if (record) await usageLog.append(record);
    },
  });
  const tasks: TaskManager = new TaskManager({
    store,
    turns,
    actions: harness.actions,
    path: harness.path ?? [],
    readPrompt: (id) => fs.readFile(resolveInHarness(harness, harness.actions[id].prompt), "utf8"),
    language: async () => language,
    engine: async () => engine.id,
    notes: () => readNotes(folder),
    writeNote: async (slug, note, meta) => {
      lastNote = path.join(folder, await writeNote(folder, slug, note, meta));
    },
    endSession: async () => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.endSession();
    },
    saveHistory: async (message) => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.history.save(message);
    },
    changed: (v) => {
      if (v.current?.context) tally.context(v.current.context.used);
    },
    emit: (e) => view.event(e),
    profileFor: async (id) =>
      resolveProfile({
        engine: engine.id,
        action: id,
        manifestTier: id === undefined ? harness.questions?.tier : id === o.action && o.tier ? o.tier : harness.actions[id]?.tier,
        models: {},
      }),
    fallbackFor: async (profile, tried) => nextFallback(profile, {}, tried),
  });
  o.signal?.addEventListener("abort", () => tasks.cancel(), { once: true });

  const reader = createInterface({ input: o.input, terminal: false });
  const typed = reader[Symbol.asyncIterator]();
  try {
    // A task an earlier run left open in this folder can't continue: its session is gone.
    await tasks.interrupt();
    await tasks.start(o.action);
    for (;;) {
      const current = (await store.load()).current;
      if (!current) break;
      const options = view.choices;
      out.write(promptFor(options.length));
      const next = await typed.next();
      const line = next.done ? "q" : next.value.trim();
      if (line === "") continue;
      view.choices = [];
      if (line === "q") {
        const before = lastNote;
        if (!(await tasks.finish())) {
          out.write("\nStopped before the closing turn; the task is still open.\n");
          continue;
        }
        out.write(lastNote && lastNote !== before ? `\nNote: ${lastNote}\n` : "\nNo note was saved.\n");
        break;
      }
      const pick = Number(line);
      if (Number.isInteger(pick) && pick >= 1 && pick <= options.length) await tasks.choose(options[pick - 1], current.id);
      else await tasks.ask(line);
    }
  } finally {
    reader.close();
    await turns.flush();
    const rt = await runtime.peek()?.catch(() => null);
    await rt?.close();
  }
  const report = tally.report({ folder, action: o.action, cost: action.cost, ...(lastNote ? { notePath: lastNote } : {}) });
  out.write(formatReport(report));
  return report;
}

const RUN_USAGE = "Usage: humanharness run <action> [--engine claude|codex] [--tier light|standard|deep] [--folder <dir>] [--language es|en] [--harness <dir>]";

export async function runCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, {
    engine: { type: "string" },
    tier: { type: "string" },
    folder: { type: "string" },
    language: { type: "string" },
    harness: { type: "string" },
  });
  if (positionals.length !== 1) throw new UsageError(RUN_USAGE);
  if (values.tier !== undefined && !(TIERS as readonly string[]).includes(values.tier)) throw new UsageError(`Unknown tier "${values.tier}": use light, standard or deep.`);
  if (values.language !== undefined && !(LANGUAGES as readonly string[]).includes(values.language)) throw new UsageError(`Unknown language "${values.language}": use es or en.`);
  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once("SIGINT", onInterrupt);
  try {
    await runTask({
      harnessDir: path.resolve(io.cwd, values.harness ?? "."),
      action: positionals[0],
      ...(values.engine ? { engine: values.engine } : {}),
      ...(values.tier ? { tier: values.tier as Tier } : {}),
      ...(values.folder ? { folder: path.resolve(io.cwd, values.folder.replace(/^~(?=$|\/)/, os.homedir())) } : {}),
      ...(values.language ? { language: values.language as Language } : {}),
      input: io.stdin,
      output: io.stdout,
      signal: controller.signal,
    });
    return 0;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}
