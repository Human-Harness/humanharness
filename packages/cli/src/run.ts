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
  hasAcceptedNotice,
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
  /** Ctrl-C presses: the command line passes SIGINT, tests an emitter. */
  interrupts?: Interrupts;
  /** Tests: run this command instead of the engine's CLI, with no readiness check. Never credentials. */
  engineCommand?: { command: string[]; env: Record<string, string> };
  /** Tests: where the readiness check looks (default: the official CLIs and `~/.humanharness/engines.json`). */
  readiness?: { deps: CommandDeps; shared: SharedConfigStore };
}

/** A source of Ctrl-C presses; `on` returns the function that removes the listener. */
export interface Interrupts {
  on(listener: () => void): () => void;
}

/** Ctrl-C as SIGINT, for as long as a listener is on. */
export const sigint: Interrupts = {
  on(listener) {
    process.on("SIGINT", listener);
    return () => process.off("SIGINT", listener);
  },
};

/** Why `run` stops when the engine's legal notice was never accepted in the app on this computer. */
export const noticeMessage = (engine: string) =>
  `${engine}'s notice hasn't been accepted on this computer. Open the app once (corepack pnpm dev, or humanharness dev), accept the notice and set up ${engine} there, then run again.`;

/**
 * The engine's command when its legal notice was accepted in the app (the shared engines.json every app on this
 * computer reads) and its official CLI is installed, current and signed in, as the app checks before a first
 * turn; otherwise a stop with the app's own message. The notice comes first: nothing runs the CLI before it.
 * Reads nothing from the CLI's own files.
 */
export async function readyEngine(engine: EngineDef, deps: CommandDeps, shared: SharedConfigStore): Promise<{ command: string[]; env: Record<string, string> }> {
  const stop = (code: ErrorCode): never => {
    throw new CliError(errorMessage(code, engine.name));
  };
  if (!(await hasAcceptedNotice(shared, engine.id))) throw new CliError(noticeMessage(engine.name));
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

  const command =
    o.engineCommand ??
    (await readyEngine(engine, o.readiness?.deps ?? createCommandDeps(process.execPath), o.readiness?.shared ?? new SharedConfigStore(sharedConfigDir())));
  // Only once the engine is ready: a stop leaves no folder behind.
  const folder = o.folder ? path.resolve(o.folder) : await fs.mkdtemp(path.join(os.tmpdir(), `hh-run-${harness.id}-`));
  await fs.mkdir(folder, { recursive: true });
  const out = o.output;
  out.write(`Folder: ${folder}\n`);

  const view = new TerminalView(out, engine.name, (out as { isTTY?: boolean }).isTTY === true);
  const tally = new UsageTally();
  const store = new TaskStore(folder);
  const usageLog = new UsageLog(folder);
  const references = await resolveReferences(harness.folder.references, { harnessDir: harness.root, home: os.homedir(), packaged: false });
  const gitdir = path.join(os.tmpdir(), "humanharness-run-history", `${harness.id}-${createHash("sha256").update(folder).digest("hex").slice(0, 12)}`);
  const stateBlocks = new Set(Object.entries(allBlocks(harness)).filter(([, b]) => !b.visible).map(([name]) => name));
  let lastNote: string | undefined;
  // Counted, not compared by path: a checkpoint's note and the closing one go to the same file.
  let notesWritten = 0;

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
      notesWritten++;
    },
    endSession: async () => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.endSession();
    },
    saveHistory: async (message, trailer) => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.history.save(message, trailer);
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

  // Ctrl-C during an operation cancels its turn; at the prompt it closes the task like q, and once a close was
  // stopped, Ctrl-C at the prompt leaves without closing (the next run in this folder ends the task as unfinished).
  let promptInterrupted: (() => void) | undefined;
  const removeInterrupts = o.interrupts?.on(() => {
    if (promptInterrupted) promptInterrupted();
    else tasks.cancel();
  });
  try {
    const reader = createInterface({ input: o.input, terminal: false });
    const typed = reader[Symbol.asyncIterator]();
    // A line read that lost the race with a Ctrl-C: the next prompt waits for it instead of reading again.
    let pending: Promise<IteratorResult<string>> | undefined;
    let closeStopped = false;
    try {
      // A task an earlier run left open in this folder can't continue: its session is gone.
      await tasks.interrupt();
      await tasks.start(o.action);
      for (;;) {
        const current = (await store.load()).current;
        if (!current) break;
        const options = view.choices;
        const interrupted = new Promise<"interrupt">((resolve) => {
          promptInterrupted = () => resolve("interrupt");
        });
        out.write(promptFor(options.length));
        pending ??= typed.next();
        const next = await Promise.race([pending, interrupted]);
        promptInterrupted = undefined;
        let line: string;
        if (next === "interrupt") {
          out.write("\n");
          if (closeStopped) {
            out.write("Left without closing the task.\n");
            break;
          }
          line = "q";
        } else {
          pending = undefined;
          line = next.done ? "q" : next.value.trim();
        }
        if (line === "") continue;
        view.choices = [];
        if (line === "q") {
          const before = notesWritten;
          if (!(await tasks.finish())) {
            closeStopped = true;
            out.write("\nStopped before the closing turn; the task is still open.\n");
            continue;
          }
          if (notesWritten > before) out.write(`\nNote: ${lastNote}\n`);
          else if (lastNote) out.write(`\nThe closing turn saved no note; the checkpoint's stands: ${lastNote}\n`);
          else out.write("\nNo note was saved.\n");
          break;
        }
        closeStopped = false;
        const pick = Number(line);
        if (Number.isInteger(pick) && pick >= 1 && pick <= options.length) await tasks.choose(options[pick - 1], current.id);
        else await tasks.ask(line);
      }
    } finally {
      promptInterrupted = undefined;
      reader.close();
      await turns.flush();
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.close();
    }
    const report = tally.report({ folder, action: o.action, cost: action.cost, ...(lastNote ? { notePath: lastNote } : {}) });
    out.write(formatReport(report));
    return report;
  } finally {
    removeInterrupts?.();
  }
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
  await runTask({
    harnessDir: path.resolve(io.cwd, values.harness ?? "."),
    action: positionals[0],
    ...(values.engine ? { engine: values.engine } : {}),
    ...(values.tier ? { tier: values.tier as Tier } : {}),
    ...(values.folder ? { folder: path.resolve(io.cwd, values.folder.replace(/^~(?=$|\/)/, os.homedir())) } : {}),
    ...(values.language ? { language: values.language as Language } : {}),
    input: io.stdin,
    output: io.stdout,
    interrupts: sigint,
  });
  return 0;
}
