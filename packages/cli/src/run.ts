import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type EngineDef, availableEngines } from "@humanharness/engines";
import type { MockNote } from "@humanharness/fake-agent";
import {
  type BlockAnswer,
  LANGUAGES,
  type Language,
  TIERS,
  type Tier,
  actionScope,
  allBlocks,
  blockToolName,
  inputBlocks,
  inputSpecs,
  loadHarness,
  resolveInHarness,
} from "@humanharness/harness-sdk";
import { type ErrorCode, createRuntime } from "@humanharness/runtime";
import {
  ChatLog,
  type CommandDeps,
  agentDataRequest,
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
  saveAnswerRecords,
  sharedConfigDir,
  usageRecord,
} from "@humanharness/shell/tasks";
import { DataStore, MAIN_SCOPE, buildDataContext, ScopeStore, generatedFiles, migrateToScopes, notesPrefix, readNotes, writeNote } from "@humanharness/workspace";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { promptAnswer } from "./input-prompt";
import { MANIFEST } from "./paths";
import { clashMessage, matchClashes } from "./mock-match";
import { Recorder, briefMatch } from "./record";
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
  /** Save the run as mock/<action>.json for `dev --mock` (spec 3e §3). */
  record?: boolean;
  /** With record: overwrite an existing recording. */
  force?: boolean;
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

const promptFor = (options: number, answerable = false) =>
  options > 0
    ? `\nPick 1–${options}, ${answerable ? "a to answer, " : ""}type a follow-up, or q to close the task: `
    : `\n${answerable ? "a to answer, or t" : "T"}ype a follow-up, or q to close the task: `;

/** The scope `humanharness run` opens for a `required` action when none is open. */
export const RUN_SCOPE = "run";

/**
 * A harness with scopes (spec §3.2–3.3): earlier work in the folder moves into `main`, which opens, like the
 * app does. A `required` action with no open scope runs in `run` (registered when missing). Undefined: keep the
 * open scope.
 */
async function runScope(folder: string, required: boolean, open: string | undefined): Promise<string | undefined> {
  if (await migrateToScopes(folder)) return MAIN_SCOPE;
  if (!required || open) return undefined;
  const entry = await new ScopeStore(folder).add({ id: RUN_SCOPE, title: "Run", createdAt: new Date().toISOString(), archived: false });
  return entry.id;
}

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
  // The harness's input blocks (input-blocks spec §8). Without any, the run is exactly as before (D0).
  const inputs = inputBlocks(harness.blocks);
  const hasInputs = Object.keys(inputs).length > 0;
  const specs = inputSpecs(harness.blocks);

  const mockFile = (id: string) => path.join(harness.root, "mock", `${id}.json`);
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  if (o.record && !o.force && (await exists(mockFile(o.action)))) {
    throw new CliError(`${path.relative(process.cwd(), mockFile(o.action)) || mockFile(o.action)} already exists. Delete it, or pass --force to overwrite it.`);
  }

  const command =
    o.engineCommand ??
    (await readyEngine(engine, o.readiness?.deps ?? createCommandDeps(process.execPath), o.readiness?.shared ?? new SharedConfigStore(sharedConfigDir())));
  // Only once the engine is ready: a stop leaves no folder behind.
  const folder = o.folder ? path.resolve(o.folder) : await fs.mkdtemp(path.join(os.tmpdir(), `hh-run-${harness.id}-`));
  await fs.mkdir(folder, { recursive: true });
  const out = o.output;
  out.write(`Folder: ${folder}\n`);

  const view = new TerminalView(out, engine.name, (out as { isTTY?: boolean }).isTTY === true, specs, language);
  const tally = new UsageTally();
  const store = new TaskStore(folder);
  const scoped = harness.scopes !== undefined;
  const scopes = new ScopeStore(folder);
  const usageLog = new UsageLog(folder);
  const references = await resolveReferences(harness.folder.references, { harnessDir: harness.root, home: os.homedir(), packaged: false });
  const gitdir = path.join(os.tmpdir(), "humanharness-run-history", `${harness.id}-${createHash("sha256").update(folder).digest("hex").slice(0, 12)}`);
  const blocks = allBlocks(harness);
  const stateBlocks = new Set(Object.entries(blocks).filter(([, b]) => !b.visible).map(([name]) => name));
  let recorder: Recorder | undefined;
  if (o.record) {
    const briefTexts = new Map<string, string>();
    const matches = new Map<string, string>();
    for (const id of Object.keys(harness.actions)) {
      const text = await fs.readFile(resolveInHarness(harness, harness.actions[id].prompt), "utf8").catch(() => "");
      briefTexts.set(id, text);
      // The brief's first line past any front matter, cut before a placeholder: a task's first message always contains it.
      matches.set(id, briefMatch(text, id));
    }
    // Replay picks a recording by its match inside the task's first message: warn when another brief holds it too.
    for (const other of matchClashes(o.action, matches.get(o.action) ?? o.action, briefTexts, (id) => matches.get(id))) {
      out.write(`Warning: ${clashMessage(matches.get(o.action) ?? o.action, other)} Make the first line of the briefs distinct.\n`);
    }
    recorder = new Recorder({
      folder,
      exclude: generatedFiles(engine),
      toolFor: (name) => (Object.hasOwn(blocks, name) ? blockToolName(name, blocks[name]) : `show_${name}`),
      matchFor: (id) => matches.get(id) ?? id,
      recordedWith: engine.id,
      warn: (m) => out.write(`Note: ${m}\n`),
    });
  }
  await recorder?.begin();
  let lastNote: string | undefined;
  // Counted, not compared by path: a checkpoint's note and the closing one go to the same file.
  let notesWritten = 0;

  // One store for the run: its queue orders the agent's writes.
  const dataStore = new DataStore(folder, harness.data);

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
      data: (request) => agentDataRequest({ store: async () => dataStore, runningTask: () => tasks.runningTask() }, request),
    }),
  );
  const turns = new TurnController({
    ensureRuntime: () => runtime.get(),
    chatLog: async (chat) => new ChatLog(folder, engine.id, chat),
    stateBlocks: () => stateBlocks,
    ...(hasInputs ? { inputBlocks: () => new Set(Object.keys(inputs)) } : {}),
    emit: (e) => {
      recorder?.event(e);
      view.event(e);
    },
    recordUsage: async (entry, meta, firstLimits) => {
      tally.add(meta, entry.usage, !entry.error);
      const record = usageRecord(entry, engine.id, meta, firstLimits);
      if (record) await usageLog.append(record);
      // After the usage is kept: a folder that can't be read must never lose it.
      await recorder?.turnEnded(meta, { failed: !!entry.error }).catch((err) => out.write(`Warning: could not record a turn: ${err instanceof Error ? err.message : String(err)}\n`));
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
    ...(Object.values(harness.data).some((c) => c.context !== false)
      ? { dataContext: (scope: string, action: string | undefined) => buildDataContext(dataStore, harness.data, scope, action) }
      : {}),
    scoped,
    scopeExists: async (id) => (await scopes.list()).some((s) => s.id === id && !s.archived),
    // As the app wires them (packages/shell/src/main/index.ts); undefined without input blocks (D0).
    ...(hasInputs
      ? {
          inputBlocks: inputs,
          markAnswered: (chat: string, answer: BlockAnswer) => new ChatLog(folder, engine.id, chat).markAnswered(answer),
          saveAnswer: (collection: string, records: Record<string, unknown>[], scope: string) => saveAnswerRecords(async () => dataStore, collection, records, scope),
        }
      : {}),
    notes: (scope) => readNotes(folder, notesPrefix(scoped, scope)),
    writeNote: async (slug, note, meta, scope) => {
      recorder?.note(note as MockNote);
      lastNote = path.join(folder, await writeNote(folder, slug, note, meta, notesPrefix(scoped, scope)));
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
    /** One line for a field's prompt: Ctrl-C isn't raced here, and the end of the input reads as null. */
    const ask = async (question: string): Promise<string | null> => {
      out.write(question);
      const next = await (pending ??= typed.next());
      pending = undefined;
      return next.done ? null : next.value;
    };
    try {
      // A task an earlier run left open in this folder can't continue: its session is gone.
      await tasks.interrupt();
      const scope = scoped ? await runScope(folder, actionScope(harness, o.action) === "required", (await store.load()).open) : undefined;
      await tasks.start(o.action, undefined, scope);
      for (;;) {
        const current = (await store.load()).current;
        if (!current) break;
        const options = view.choices;
        const interrupted = new Promise<"interrupt">((resolve) => {
          promptInterrupted = () => resolve("interrupt");
        });
        out.write(promptFor(options.length, current.pendingInput !== undefined));
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
        const asked = current.pendingInput;
        if (line === "a" && asked && Object.hasOwn(specs, asked.block)) {
          const value = await promptAnswer(specs[asked.block], view.shown.get(asked.blockId), ask, out, language);
          if (!value) continue;
          const { accepted, done } = tasks.respond(asked.blockId, value);
          // Awaited below; marked handled here so a refusal before `accepted` leaves no unhandled rejection.
          done.catch(() => undefined);
          const r = await accepted;
          if (!r.ok) {
            const why = r.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ");
            out.write(`\nNot sent (${r.reason})${why ? `: ${why}` : ""}\n`);
            await done;
            continue;
          }
          recorder?.answer(asked.block, r.value);
          out.write(`\n> ${r.display.replaceAll("\n", "\n> ")}\n\n`);
          await done;
          continue;
        }
        const pick = Number(line);
        if (Number.isInteger(pick) && pick >= 1 && pick <= options.length) {
          recorder?.reply(options[pick - 1].label);
          await tasks.choose(options[pick - 1], current.id);
        } else {
          recorder?.reply("*");
          await tasks.ask(line);
        }
      }
    } finally {
      promptInterrupted = undefined;
      reader.close();
      await turns.flush();
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.close();
    }
    if (recorder) {
      let written = 0;
      for (const rec of recorder.recordings()) {
        const file = mockFile(rec.action);
        if (rec.action !== o.action && (await exists(file))) {
          out.write(`Not recorded: ${file} already exists.\n`);
          continue;
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        // Atomic: a recording is never half written.
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(rec, null, 2) + "\n");
        await fs.rename(tmp, file);
        out.write(`Recorded: ${file}\n`);
        written++;
      }
      if (recorder.skipped.size > 0) out.write(`Left out of the recording (binary or over 64 KB, new or changed in this run): ${[...recorder.skipped].join(", ")}\n`);
      if (written > 0) out.write("The recording holds what you typed and what the AI answered: review it before committing it.\n");
    }
    const report = tally.report({ folder, action: o.action, cost: action.cost, ...(lastNote ? { notePath: lastNote } : {}) });
    out.write(formatReport(report));
    return report;
  } finally {
    removeInterrupts?.();
  }
}

const RUN_USAGE = "Usage: humanharness run <action> [--engine claude|codex] [--tier light|standard|deep] [--folder <dir>] [--language es|en] [--harness <dir>] [--record [--force]]";

export async function runCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, {
    engine: { type: "string" },
    tier: { type: "string" },
    folder: { type: "string" },
    language: { type: "string" },
    harness: { type: "string" },
    record: { type: "boolean" },
    force: { type: "boolean" },
  });
  if (positionals.length !== 1) throw new UsageError(RUN_USAGE);
  if (values.force && !values.record) throw new UsageError("--force only works with --record");
  if (values.tier !== undefined && !(TIERS as readonly string[]).includes(values.tier)) throw new UsageError(`Unknown tier "${values.tier}": use light, standard or deep.`);
  if (values.language !== undefined && !(LANGUAGES as readonly string[]).includes(values.language)) throw new UsageError(`Unknown language "${values.language}": use es or en.`);
  await runTask({
    harnessDir: path.resolve(io.cwd, values.harness ?? "."),
    action: positionals[0],
    ...(values.engine ? { engine: values.engine } : {}),
    ...(values.tier ? { tier: values.tier as Tier } : {}),
    ...(values.folder ? { folder: path.resolve(io.cwd, values.folder.replace(/^~(?=$|\/)/, os.homedir())) } : {}),
    ...(values.language ? { language: values.language as Language } : {}),
    ...(values.record ? { record: true } : {}),
    ...(values.force ? { force: true } : {}),
    input: io.stdin,
    output: io.stdout,
    interrupts: sigint,
  });
  return 0;
}
