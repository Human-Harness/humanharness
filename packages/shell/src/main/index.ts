import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, app, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, type ModelProfile, type ModelSpec, NOTICE_VERSION, availableEngines, defaultTier, getEngine } from "@humanharness/engines";
import { type Language, type LoadedHarness, TIERS, type Tier, allBlocks, choiceOptionSchema, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, createRuntime } from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type ChatLoad,
  type ConfiguredApp,
  type FolderPick,
  type ModelsView,
  type MoveResult,
  type RunningSetup as SetupInfo,
  type SendOptions,
  type SetupOutput,
  type SetupStep,
  type TestResult,
  type UsageSummary,
  RESTORE_POINT,
  RESTORE_TASK,
  isConfigured,
} from "@humanharness/ui/client";
import { History, NOTES_PREFIX, readNotes, syncLocations, syncStatus, writeNote } from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { ChatLog } from "./chat-log";
import { ConfigStore, historyDir } from "./config";
import { testPrompt } from "./engine-check";
import { createCommandDeps } from "./command-deps";
import { cliCommand, engineCommand, loginShellPath } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { installCommandOf, terminalCommand } from "./install-help";
import { detectEngine, hasAcceptedNotice } from "./engine-status";
import { QUESTIONS, cleanModels, engineOffer, firstOffered, fitEffort, nextFallback, resolveProfile } from "./models";
import { requireNoticeForChoice, requireNoticeForTurn } from "./notice-policy";
import { archiveStaleChat, startNewChatIfEngineChanged } from "./engine-switch";
import { type RunningSetup, runSetupProcess, setupCommand, stopSetupProcess } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import { type SharedEngineRecord, SharedConfigStore, sharedConfigDir } from "./shared-config";
import { EngineUnavailable, TurnController, memoise } from "./turn-controller";
import { UsageLog, compactionRecord, profileMeta, summarizeUsage, usageRecord } from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import { saveWithFolderChange } from "./folder-change";
import { type MoveDeps, guardedMove, moveFolder, moveJournal, precheckMove, recoverMove } from "./move-folder";
import { type ResolvedReference, displayPath, resolveReferences, usableReferences } from "./references";
import { TaskManager } from "./task-manager";
import { historyView, isSha } from "./history-view";
import { RestoreGuard, lastOpened } from "./restore-guard";
import { TaskStore, emptyTasks } from "./task-store";
import {
  MOCK_MODEL,
  devEngine,
  fakeSetupResult,
  isMockEngine,
  mockEngineText,
  mockLanguage,
  mockModels,
  offeredEngines,
  readTestHooks,
  testEngineStatus,
} from "./test-hooks";

declare const __HARNESS_DIR__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };
const SETUP_STEPS: SetupStep[] = ["install", "update", "login", "logout"];
/** How long each setup step may run before it is stopped (a sign-in left open in the browser, a stuck download). */
const SETUP_TIMEOUT_MS: Record<SetupStep, number> = { install: 20 * 60_000, update: 20 * 60_000, login: 10 * 60_000, logout: 60_000 };

const requireFromHere = createRequire(import.meta.url);
// The build's folder. Not `__dirname`: electron-vite's ESM shim for it is put after the bundle's last
// `import … from` it finds, and a bundled JSDoc example (isomorphic-git's walkers) once fooled it into a comment.
const here = import.meta.dirname;
const commandDeps = createCommandDeps(process.execPath);

let harness: LoadedHarness;
let config: ConfigStore;
let shared: SharedConfigStore;
let window: BrowserWindow | null = null;
/** Set on the first before-quit: from then on, no new turns or restores. */
let quitting = false;
/** The install, update, login or logout process running now, if any. */
let setupRun: RunningSetup | null = null;
/** The first web address the running step printed, for a screen that reopens while it runs. */
let setupUrl: string | undefined;
/** How long quitting waits for the test prompt to clean up (its temporary folder, the CLI it started). */
const QUIT_TEST_WAIT_MS = 5_000;
/** Engine changes, setup steps and test prompts against turns (see EngineGuards). */
const guards = new EngineGuards();
/** Logos as data: URLs, read once. */
const logos = new Map<string, Promise<string | null>>();
/** End-to-end test settings (development builds only; see test-hooks.ts). */
const hooks = readTestHooks(process.env, app.isPackaged);
/** The folder move running now (hh:moveFolder): quitting waits for it. */
let moving: Promise<unknown> | null = null;
/** The move's folder change has begun (after its checkpoint turn): no history is opened until it ends. */
let historyHeld = false;
/** The manifest's reference folders on this machine, resolved once the app is ready. */
let references: Promise<ResolvedReference[]> = Promise.resolve([]);

/**
 * The reference folders usable with the working folder: one that is or contains it is left out (its
 * read-only rules would block the person's own files), with `log` saying why.
 */
async function referencesFor(folder: string | undefined, log = false): Promise<ResolvedReference[]> {
  const refs = await references;
  if (!folder) return refs;
  return usableReferences(refs, folder, log ? (message) => console.error(message) : undefined);
}

const mode = () => (app.isPackaged ? "distribution" : "development");
/** The engines this app offers (spec 3e: mock mode offers only the faked ones). */
const offered = () => offeredEngines(availableEngines(harness.engines, mode()), hooks);
/** Mock mode: the language the test engine and its model are named in. */
const mockLang = (saved: Language | undefined) => mockLanguage(saved, app.getLocale(), harness.languages);
const stateBlocks = () => new Set(Object.entries(allBlocks(harness)).filter(([, b]) => !b.visible).map(([n]) => n));
const rendererFile = path.join(here, "../renderer/index.html");
// The dev server is only trusted in development: a packaged app always loads its own file.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const appUrl = (url: string) => isAppUrl(url, { devUrl, rendererFile });
const validation = (): ValidationContext => ({
  engineIds: offered().map((e) => e.id),
  languages: harness.languages,
  home: os.homedir(),
});

/** An engine this harness offers in this build. The id comes from the window, so anything else throws. */
function engineFor(id: unknown): EngineDef {
  const engine = offered().find((e) => e.id === id);
  if (!engine) throw new Error("This engine is not available");
  return engine;
}

function logo(key: string, file: () => string): Promise<string | null> {
  if (!logos.has(key)) {
    logos.set(
      key,
      (async () => {
        try {
          return await imageDataUrl(file());
        } catch {
          return null;
        }
      })(),
    );
  }
  return logos.get(key)!;
}

const harnessLogo = () => (harness.logo ? logo("harness", () => resolveInHarness(harness, harness.logo!)) : Promise.resolve(null));
// Engine logos ship in the engines package (exported as "./assets/*").
const engineLogo = (e: EngineDef) => (e.logo ? logo(e.id, () => requireFromHere.resolve(`@humanharness/engines/${e.logo}`)) : Promise.resolve(null));

/** What the engine was saved offering (engines.json); empty when the file can't be read. */
const savedOffer = (engineId: string) => shared.engine(engineId).catch((): SharedEngineRecord => ({}));

/** Settings › Modelos: the harness's recommendations, the core's tables and what each engine offers. */
async function modelsView(language: Language | undefined): Promise<ModelsView> {
  const engines = offered();
  const saved = await shared.load().catch(() => ({ version: 1 as const, engines: {} as Record<string, SharedEngineRecord> }));
  // Mock mode: a faked engine offers only the test model, and every tier uses it (effort and cap kept).
  const tierSpec = (engineId: string, tier: Tier): ModelSpec =>
    isMockEngine(hooks, engineId) ? { ...defaultTier(engineId, tier), model: MOCK_MODEL } : defaultTier(engineId, tier);
  const offer = (e: EngineDef) => {
    const real = engineOffer(e, saved.engines[e.id] ?? {});
    return isMockEngine(hooks, e.id) ? { ...real, models: mockModels(mockLang(language)) } : real;
  };
  return {
    recommended: {
      ...Object.fromEntries(Object.entries(harness.actions).map(([id, a]) => [id, a.tier ?? "standard"])),
      [QUESTIONS]: harness.questions?.tier ?? "standard",
    },
    defaults: Object.fromEntries(
      engines.map((e) => [e.id, Object.fromEntries(TIERS.map((t) => [t, tierSpec(e.id, t)])) as Record<Tier, ModelSpec>]),
    ),
    offered: Object.fromEntries(engines.map((e) => [e.id, offer(e)])),
  };
}

/**
 * `p` with an effort its engine offers, so an unsupported one never reaches argv or CODEX_CONFIG. An engine
 * this build doesn't offer leaves `p` as it is (its turn fails on the engine check anyway).
 */
async function supportedEffort(p: ModelProfile, saved?: SharedEngineRecord): Promise<ModelProfile> {
  const engine = offered().find((e) => e.id === p.engine);
  return engine ? fitEffort(p, engineOffer(engine, saved ?? (await savedOffer(p.engine))).efforts) : p;
}

/** The folder's backup status and the synced places, each with the harness's folder name inside. Paths only (backup.ts). */
async function backupView(folder: string | undefined): Promise<NonNullable<AppState["backup"]>> {
  const home = os.homedir();
  const name = path.basename(harness.folder.suggested);
  try {
    const [status, locations] = await Promise.all([folder ? syncStatus(folder, home) : Promise.resolve(null), syncLocations(home)]);
    return { status, locations: locations.map((l) => ({ ...l, suggested: path.join(l.path, name) })) };
  } catch (err) {
    console.error("Could not read the backup status", err);
    return { status: null, locations: [] };
  }
}

async function appState(): Promise<AppState> {
  const harnessImage = await harnessLogo();
  const saved = await config.load();
  return {
    harness: {
      id: harness.id,
      name: harness.name,
      languages: harness.languages,
      ...(harness.tagline ? { tagline: harness.tagline } : {}),
      ...(harnessImage ? { logo: harnessImage } : {}),
      author: harness.author,
      ...(harness.donate ? { donate: harness.donate } : {}),
      version: app.getVersion(),
    },
    config: saved.models !== undefined ? { ...saved, models: cleanModels(saved.models) } : saved,
    suggestedFolder: hooks.suggestedFolder ?? path.join(os.homedir(), harness.folder.suggested),
    ...(hooks.mock ? { mock: true } : {}),
    engines: await Promise.all(
      offered().map(async (e) => {
        // Mock mode: a faked engine is shown as the test engine, with no logo, install command or plan limits.
        if (isMockEngine(hooks, e.id)) {
          return {
            id: e.id,
            ...mockEngineText(mockLang(saved.language)),
            status: e.status as "allowed" | "pending",
            termsUrl: e.termsUrl,
            privacyUrl: e.privacyUrl,
            reportsLimits: false,
            mock: true,
          };
        }
        const image = await engineLogo(e);
        return {
          id: e.id,
          name: e.name,
          status: e.status as "allowed" | "pending",
          provider: e.provider,
          requires: e.requires,
          dataLocation: e.dataLocation,
          trainsOnData: e.trainsOnData,
          termsUrl: e.termsUrl,
          privacyUrl: e.privacyUrl,
          reportsLimits: e.reportsLimits,
          ...(e.plansUrl ? { plansUrl: e.plansUrl } : {}),
          ...(e.setup?.install ? { installCommand: e.setup.install.command, installDocsUrl: e.setup.install.docsUrl } : {}),
          ...(image ? { logo: image } : {}),
        };
      }),
    ),
    // What the screen needs of each action (never the prompt file).
    actions: Object.fromEntries(
      Object.entries(harness.actions).map(([id, a]) => [
        id,
        { label: a.label, cost: a.cost, ...(a.description ? { description: a.description } : {}), ...(a.tier ? { tier: a.tier } : {}) },
      ]),
    ),
    path: harness.path ?? [],
    references: (await referencesFor(saved.folder)).map((r) => ({ id: r.id, label: r.label, path: displayPath(r.path, os.homedir()) })),
    models: await modelsView(saved.language),
    backup: await backupView(saved.folder),
  };
}

/** The saved config, only when it is complete and valid. */
async function validConfig(): Promise<ConfiguredApp | null> {
  const c = await config.load();
  return isConfigured(c) && (await configProblem(c, validation())) === null ? c : null;
}

function applyAppearance(appearance: AppConfig["appearance"]) {
  nativeTheme.themeSource = appearance ?? "system";
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);
}

const runtime = memoise<HarnessRuntime>(async () => {
  const c = await config.load();
  if (!isConfigured(c)) throw new Error("The app is not set up yet");
  const problem = await configProblem(c, validation());
  if (problem) throw new Error(problem);
  await restores.settled();
  const engine = getEngine(c.engineId);
  let cmd: { command: string[]; env: Record<string, string> } | null;
  const fake = hooks.engines?.[engine.id];
  if (fake) cmd = fake;
  else {
    // Spec §9 "every start": enforce detect.minVersion and a signed-in CLI before the first turn.
    const status = await detectEngine(engine, commandDeps, shared);
    if (!status.installed) return null;
    if (status.outdated) throw new EngineUnavailable("outdated-version");
    if (status.loggedIn === false) throw new EngineUnavailable("session-expired");
    cmd = await engineCommand(engine, commandDeps);
  }
  if (!cmd) return null;
  return createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: historyDir(app.getPath("userData"), c.folder),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(here, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
    references: (await referencesFor(c.folder, true)).map((r) => ({ label: r.label[c.language], path: r.path })),
    onSession: (s) => void tasks.sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
    onModels: (offer) =>
      void shared.update(engine.id, { models: offer.models, efforts: offer.efforts }).catch((err: unknown) => console.error("Could not save the engine's models", err)),
  });
});

/** Closes the running runtime and keeps the open task; the next turn starts a new runtime (and engine session). */
async function closeRuntime() {
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
}

/** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  await tasks.interrupt().catch((err: unknown) => console.error("Could not end the task", err));
  await closeRuntime();
}

/** The history of the folder when no runtime runs: one per folder and ignore list (its queue orders every write). */
const standaloneHistory = lastOpened(async (key) => {
  const { folder, ignore } = JSON.parse(key) as { folder: string; ignore: string[] };
  const history = new History(folder, historyDir(app.getPath("userData"), folder), ignore, [NOTES_PREFIX]);
  await history.init();
  return history;
});

/**
 * The running runtime's history, or the one opened on the configured folder; none while the folder moves
 * (from the end of its checkpoint turn, whose commit still goes in).
 */
async function currentHistory(): Promise<History | null> {
  return historyHeld ? null : openHistory();
}

async function openHistory(): Promise<History | null> {
  const rt = await runtime.peek()?.catch(() => null);
  if (rt) return rt.history;
  const c = await validConfig();
  if (!c) return null;
  const extra = getEngine(c.engineId).instructionsFile?.path;
  // Same ignore list as the runtime's: its files under .harness/ and the generated instructions.
  return standaloneHistory(JSON.stringify({ folder: c.folder, ignore: [".harness/", "AGENTS.md", ...(extra ? [extra] : [])] }));
}

function sendToWindow(channel: string, value: unknown) {
  try {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  } catch (err) {
    console.error("Could not send to the window", err);
  }
}
const emit = (event: Event) => sendToWindow("hh:event", event);
// Mock mode: the test engine has no provider to disclose and nothing leaves the computer, so its notice counts as accepted.
const hasNotice = async (engineId: string) => isMockEngine(hooks, engineId) || hasAcceptedNotice(shared, engineId);

const turns = new TurnController({
  ensureRuntime: async () => {
    const blocked = guards.turnBlocked();
    if (blocked) throw new Error(blocked);
    // Checked on every turn: the notice may have been reset (Start over) while a runtime runs.
    await requireNoticeForTurn((await config.load()).engineId, hasNotice);
    return runtime.get();
  },
  chatLog: async () => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason;
    // nothing is written into a folder that didn't pass validation.
    return (await configProblem(c, validation())) === null ? new ChatLog(c.folder, c.engineId) : { append: async () => {} };
  },
  stateBlocks,
  emit,
  recordUsage: async (entry, meta, firstLimits) => {
    const c = await validConfig();
    const record = c ? usageRecord(entry, c.engineId, meta, firstLimits) : null;
    if (c && record) await new UsageLog(c.folder).append(record);
  },
  engineId: async () => (await config.load()).engineId,
  sessionExpired: async (engineId) => {
    await shared.update(engineId, { verifiedAt: null });
  },
});

const tasks = new TaskManager({
  store: {
    load: async () => {
      const c = await validConfig();
      return c ? new TaskStore(c.folder).load() : emptyTasks();
    },
    save: async (state) => {
      const c = await validConfig();
      if (c) await new TaskStore(c.folder).save(state);
    },
  },
  turns,
  get actions() {
    return harness.actions;
  },
  get path() {
    return harness.path ?? [];
  },
  readPrompt: (action) => fs.readFile(resolveInHarness(harness, harness.actions[action].prompt), "utf8"),
  language: async () => (await config.load()).language ?? harness.languages[0],
  engine: async () => (await config.load()).engineId ?? "",
  notes: async () => {
    const c = await validConfig();
    return c ? readNotes(c.folder) : [];
  },
  writeNote: async (slug, note, meta) => {
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    await writeNote(c.folder, slug, note, meta);
  },
  noteExists: async (slug) => {
    const c = await validConfig();
    return c ? fs.access(path.join(c.folder, NOTES_PREFIX, `${slug}.md`)).then(() => true, () => false) : false;
  },
  endSession: async () => {
    const rt = await runtime.peek()?.catch(() => null);
    await rt?.endSession();
  },
  saveHistory: async (message, trailer) => {
    await (await currentHistory())?.save(message, trailer);
  },
  changed: (view) => sendToWindow("hh:tasks", view),
  emit,
  profileFor: async (action) => {
    const c = await config.load();
    const engine = c.engineId ?? "";
    const models = cleanModels(c.models);
    const manifestTier = action !== undefined ? harness.actions[action]?.tier : harness.questions?.tier;
    const profile = resolveProfile({ engine, action, manifestTier, models });
    // Codex: a model its saved list lacks falls back before the turn (spec §5.3).
    const saved = await savedOffer(engine);
    return supportedEffort(firstOffered(profile, models, saved.models), saved);
  },
  fallbackFor: async (profile, tried) => {
    const next = nextFallback(profile, cleanModels((await config.load()).models), tried);
    return next ? supportedEffort(next) : null;
  },
  fitProfile: (profile) => supportedEffort(profile),
  recordCompaction: async (task) => {
    const c = await validConfig();
    if (!c) return;
    await new UsageLog(c.folder).append(
      compactionRecord(c.engineId, { ...(task.action ? { action: task.action } : {}), task: task.id, ...(task.profile ? profileMeta(task.profile) : {}) }),
    );
  },
});

/** Saves a config patch; an engine change ends the task, drops the runtime and archives the chat (see EngineGuards). */
async function saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void> {
  if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
    const engineId = patch.engineId;
    await guards.switchEngine(
      {
        isBusy: () => tasks.isBusy(),
        idle: async () => {
          await tasks.idle();
          await turns.flush();
        },
        save: () => config.save(patch).then(() => undefined),
        dropRuntime,
        archiveChat: async () => {
          const c = await validConfig();
          return c && c.engineId === engineId ? startNewChatIfEngineChanged(c.folder, engineId) : null;
        },
      },
      // The new engine is saved: the window gets the new state; the next chat load archives the old chat.
      (err) => console.error("Could not finish changing the engine", err),
    );
  } else {
    await config.save(patch);
  }
}

/** Registers an IPC handler that only answers the app's own page. */
function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame || !appUrl(event.senderFrame.url)) throw new Error("Unexpected sender");
    return fn(...(args as never[]));
  });
}

/**
 * Restores: refused while quitting, while a task operation runs or turns are held (engine change, folder
 * move); one at a time; new turns are refused and a runtime starting waits until it ends.
 */
const restores = new RestoreGuard({ quitting: () => quitting, busy: () => tasks.isBusy(), turnBlocked: () => guards.turnBlocked() });
const restoreWith = (run: (history: History) => Promise<unknown>) => restores.run(currentHistory, run);

/** Why a new turn can't start now (engine change, folder move, engine update, a restore), or null. */
const turnBlocked = () => guards.turnBlocked() ?? restores.turnBlocked();

function registerIpc() {
  handle("hh:getState", () => appState());
  handle("hh:pickFolder", async (defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    return { folder, problem: await checkFolder(folder, os.homedir()) } satisfies FolderPick;
  });
  handle("hh:saveConfig", async (input: AppConfig) => {
    const problem = await configProblem(input, validation());
    if (problem) throw new Error(problem);
    // Spec §7: a bad entry under models is dropped, never stored.
    const patch: AppConfig = input.models !== undefined ? { ...input, models: cleanModels(input.models) } : input;
    const before = await config.load();
    // Spec §9: an engine is only used once its notice is accepted.
    await requireNoticeForChoice(patch.engineId, before.engineId, hasNotice);
    // A new folder: refused while a turn or a restore runs, and turns are refused until it is over; the old
    // folder's task ends and its runtime goes.
    await saveWithFolderChange(patch.folder, before.folder, { isBusy: () => tasks.isBusy() || restores.turnBlocked() !== null, guards, interrupt: () => tasks.interrupt(), dropRuntime }, () =>
      saveConfigPatch(patch, before),
    );
    if (patch.appearance) applyAppearance(patch.appearance);
    return appState();
  });
  handle("hh:loadChat", async (): Promise<ChatLoad> => {
    const c = await validConfig();
    if (!c) return { entries: [] };
    // The engine change archives the chat; the check here only catches a change made while the app was closed.
    const switchedFrom =
      guards.takeSwitchedFrom() ?? (tasks.isBusy() || guards.turnBlocked() ? null : await archiveStaleChat(c.folder, c.engineId, dropRuntime));
    return { entries: await new ChatLog(c.folder).load(), ...(switchedFrom ? { switchedFrom } : {}) };
  });
  handle("hh:send", (message: string, options?: SendOptions) => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    if (typeof message !== "string" || !message.trim() || message.length > 20_000) throw new Error("Invalid message");
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    // A message with an action starts that task (the message is what the chat shows); any other follows up or asks.
    return action ? tasks.start(action, message) : tasks.ask(message);
  });
  handle("hh:getTasks", () => tasks.view());
  handle("hh:choose", (option: unknown, task: unknown) => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    const parsed = choiceOptionSchema.safeParse(option);
    if (!parsed.success) throw new Error("Invalid choice");
    // The task the block was shown for: a block of an earlier task is refused (TaskManager.choose).
    if (typeof task !== "string" || !task || task.length > 100) throw new Error("Invalid choice");
    return tasks.choose(parsed.data, task);
  });
  handle("hh:openPath", async (file: unknown) => {
    const c = await validConfig();
    if (!c) return false;
    const roots = openRoots(c.folder, (await referencesFor(c.folder)).map((r) => r.path));
    const target = await openableFile(file, roots);
    if (!target) return false;
    // Checked again right before opening: the file or a folder above it may have been swapped for a link meanwhile.
    return openIfStillSafe(target, roots, (p) => shell.openPath(p));
  });
  // Shows a file in Finder (it never opens it): any kind of file, with the same checks as hh:openPath.
  handle("hh:revealPath", async (file: unknown) => {
    const c = await validConfig();
    if (!c) return false;
    const roots = openRoots(c.folder, (await referencesFor(c.folder)).map((r) => r.path));
    const target = await revealableFile(file, roots);
    if (!target) return false;
    return revealIfStillSafe(target, roots, (p) => shell.showItemInFolder(p));
  });
  // Cancels the turn and stops the task operation (a closing turn never goes on to the next task).
  handle("hh:cancel", () => tasks.cancel());
  // Restore commits carry no task: going back may undo several tasks, so it belongs to none of them.
  handle("hh:restore", (sha: unknown) => {
    if (!isSha(sha)) throw new Error("Invalid point");
    return restoreWith((history) => history.restore(sha, RESTORE_POINT));
  });
  handle("hh:historyTasks", async () => {
    const history = await currentHistory();
    return history ? historyView(await history.tasks()) : [];
  });
  handle("hh:restoreTask", (taskId: unknown) =>
    restoreWith(async (history) => {
      if (typeof taskId !== "string" || !taskId || taskId.length > 200) throw new Error("Invalid task");
      const group = (await history.tasks()).find((g) => g.taskId === taskId);
      if (!group?.start) throw new Error("Nothing to go back to");
      await history.restore(group.start, RESTORE_TASK);
    }),
  );
  handle("hh:engineStatus", async (engineId: string) => {
    const engine = engineFor(engineId);
    if (hooks.engines?.[engine.id]) return testEngineStatus(engine, await hasNotice(engine.id));
    return detectEngine(engine, commandDeps, shared);
  });
  handle("hh:acceptNotice", async (engineId: string) => {
    engineFor(engineId);
    await shared.update(engineId, { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
  });
  handle("hh:runSetup", async (engineId: string, step: SetupStep) => {
    const engine = engineFor(engineId);
    if (!SETUP_STEPS.includes(step)) throw new Error("Unknown setup step");
    // A fake engine has nothing to install or sign in to, and no real CLI may run.
    const fake = fakeSetupResult(hooks, engineId);
    if (fake) return fake;
    // Start and end are only reported by the call that holds the setup slot, so only it resets these.
    const output = (o: SetupOutput) => {
      if (o.kind === "start") setupUrl = undefined;
      if (o.kind === "url") setupUrl ??= o.url;
      if (o.kind === "end") {
        setupRun = null;
        setupUrl = undefined;
      }
      sendToWindow("hh:setupOutput", o);
    };
    return runSetupStep(
      {
        guards,
        hasNotice,
        currentEngine: async () => (await config.load()).engineId,
        isBusy: () => tasks.isBusy(),
        quitting: () => quitting,
        command: async () => {
          const cli = step === "install" ? null : await cliCommand(engine, commandDeps);
          return setupCommand(engine, step, cli, await loginShellPath(commandDeps));
        },
        dropRuntime,
        spawn: (cmd) => (setupRun = runSetupProcess(cmd, output, { timeoutMs: SETUP_TIMEOUT_MS[step] })),
        output,
      },
      engineId,
      step,
    );
  });
  handle("hh:getSetup", (): SetupInfo | null => {
    const s = guards.setup;
    return s ? { ...s, ...(setupUrl ? { url: setupUrl } : {}) } : null;
  });
  handle("hh:setupInput", (text: string) => {
    if (typeof text === "string") setupRun?.write(text.slice(0, 2000));
  });
  handle("hh:cancelSetup", () => {
    // Remembered too, for a step whose process hasn't started yet.
    guards.cancelSetup();
    setupRun?.cancel();
  });
  handle("hh:testEngine", async (engineId: string) => {
    const engine = engineFor(engineId);
    if (quitting) throw new Error("The app is closing");
    // A second request for the same engine (the screen was reopened) gets the running test's result.
    return guards.runTest(engineId, async (signal): Promise<TestResult> => {
      if (!(await hasNotice(engineId))) return { ok: false, error: { code: "notice-required" } };
      // A fake engine is never tested against a real CLI.
      const cmd = fakeSetupResult(hooks, engineId) ? { command: [], env: {} } : await engineCommand(engine, commandDeps);
      if (!cmd) return { ok: false, error: { code: "engine-not-installed" } };
      // The app may have started quitting while the CLI was being found.
      if (quitting || signal.aborted) return { ok: false, error: { code: "cancelled" } };
      const result = fakeSetupResult(hooks, engineId) ? { ok: true } : await testPrompt(engine, cmd, { signal });
      if (!result.ok) return result;
      try {
        await shared.update(engineId, { verifiedAt: new Date().toISOString() });
      } catch (err) {
        console.error("Could not record the test prompt", err);
        return { ok: true, recorded: false };
      }
      return { ok: true };
    });
  });
  handle("hh:getUsage", async (): Promise<UsageSummary> => {
    const c = await validConfig();
    if (!c) return { limits: null, estimates: {}, tokens: {} };
    // A mock engine reports no limits, so it measures no window.
    const primary = isMockEngine(hooks, c.engineId) ? undefined : getEngine(c.engineId).limits?.primary;
    return summarizeUsage((await new UsageLog(c.folder).load()).filter((r) => r.engine === c.engineId), primary);
  });
  handle("hh:revealSharedConfig", () => shell.showItemInFolder(shared.path));
  // Installing by hand: copy the official command (chosen here by engine id) and open Terminal,
  // where the user pastes it. Nothing is run for them.
  handle("hh:copyInstallCommand", (engineId: string) => clipboard.writeText(installCommandOf(engineFor(engineId))));
  handle("hh:openTerminal", async () => {
    const terminal = terminalCommand(process.platform);
    if (!terminal) throw new Error("No Terminal app to open here");
    await new Promise<void>((resolve, reject) => execFile(terminal.command, terminal.args, (err) => (err ? reject(err) : resolve())));
  });
  handle("hh:resetSharedConfig", async () => {
    await shared.reset();
  });
  handle("hh:revealFolder", async () => {
    const c = await validConfig();
    if (c) await shell.openPath(c.folder);
  });
  // Spec 3d §2: refused while a turn or a restore runs; turns and restores are held off until it is over.
  handle("hh:moveFolder", async (to: unknown): Promise<MoveResult> => {
    if (quitting) throw new Error("The app is closing");
    if (typeof to !== "string" || !path.isAbsolute(to) || to.length > 1000 || to.includes("\0")) return { ok: false, error: "unsuitable" };
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    const userData = app.getPath("userData");
    const deps: MoveDeps = {
      check: (folder) => checkFolder(folder, os.homedir()),
      // Read without creating a history: a folder that has none yet has no tracked files.
      tracked: async () => {
        const has = await fs.access(historyDir(userData, c.folder)).then(() => true, () => false);
        return has ? ((await (await openHistory())?.trackedFiles()) ?? []) : [];
      },
      saveFolder: async (folder) => void (await config.replaceFolder(folder)),
      historyDir: (folder) => historyDir(userData, folder),
      journal: moveJournal(userData),
      ops: { trash: (p) => shell.trashItem(p) },
    };
    // Checked and set with no await in between, so two requests can't both start a move.
    if (moving) return { ok: false, error: "busy" };
    const run = guardedMove({
      guards,
      isBusy: () => tasks.isBusy() || restores.turnBlocked() !== null,
      precheck: () => precheckMove(c.folder, to, deps),
      quitting: () => quitting,
      checkpoint: () => tasks.checkpointBeforeMove(),
      holdHistory: (held) => (historyHeld = held),
      flush: () => turns.flush(),
      closeRuntime,
      restoresSettled: () => restores.settled(),
      resumeFromNotes: () => tasks.resumeFromNotes(),
      move: () => moveFolder(c.folder, to, deps),
    });
    moving = run;
    let result: Awaited<typeof run>;
    try {
      result = await run;
    } finally {
      moving = null;
    }
    // The window always gets the state as it is now, whatever happened.
    const state = await appState().catch((err: unknown) => {
      console.error("Could not read the app state after the move", err);
      return null;
    });
    if (!result.ok) return { ...result, ...(state ? { state } : {}) };
    if (!state) throw new Error("Could not read the app state after the move");
    const { oldRemoved, historyMoved } = result.done;
    return { ok: true, state, ...(oldRemoved ? {} : { leftBehind: c.folder }), ...(historyMoved ? {} : { historyLeftBehind: true }) };
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: harness.name.en,
    // Native look (spec 2026-10-11-app-look-design.md): on macOS the page draws the 52 px top bar.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 20, y: 18 } } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light,
    webPreferences: { preload: path.join(here, "../preload/index.mjs"), contextIsolation: true, sandbox: false },
  });
  window = win;
  win.on("closed", () => {
    if (window === win) window = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (!appUrl(event.url)) event.preventDefault();
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(rendererFile);
}

// Each harness is its own app: keep its config, history and caches apart from other harnesses.
// Set before "ready" (ESM top-level await delays it) so Chromium uses the same folder.
const loaded = await loadHarness(path.join(here, "harness.js"), { root: __HARNESS_DIR__ }).catch((err: unknown) => {
  // showErrorBox is safe before "ready".
  dialog.showErrorBox("This app could not start", err instanceof Error ? err.message : String(err));
  app.exit(1);
  return null;
});

if (loaded) {
  harness = loaded;
  app.setName(harness.name.en);
  app.setPath("userData", hooks.userData ?? path.join(app.getPath("appData"), "Human Harness", harness.id));
}

// One app per data folder (the lock is tied to userData, so it is taken after it is set): a second one would
// share the config, and its start-up recovery could undo a folder move the first one is making.
const primary = loaded !== null && app.requestSingleInstanceLock();
if (loaded && !primary) app.quit();

if (primary) {
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    config = new ConfigStore(app.getPath("userData"));
    // A folder move cut short by a quit or crash: finish or undo it before anything opens the folder or its history.
    const userData = app.getPath("userData");
    const recovered = await recoverMove({
      journal: moveJournal(userData),
      currentFolder: async () => (await config.load()).folder,
      historyDir: (folder) => historyDir(userData, folder),
    }).catch((err: unknown) => {
      console.error("Could not settle an interrupted folder move", err);
      return null;
    });
    if (recovered?.leftBehind) console.error(`An interrupted folder move kept the old folder at ${recovered.leftBehind}`);
    shared = new SharedConfigStore(hooks.sharedDir ?? sharedConfigDir());
    // `humanharness dev --engine <id>`: a fresh app starts with that engine chosen (development builds only).
    const preselect = devEngine(process.env, app.isPackaged, offered().map((e) => e.id));
    if (preselect && !(await config.load()).engineId) await config.save({ engineId: preselect });
    references = resolveReferences(harness.folder.references, { harnessDir: __HARNESS_DIR__, home: os.homedir(), packaged: app.isPackaged });
    nativeTheme.themeSource = (await config.load()).appearance ?? "system";
    nativeTheme.on("updated", () => window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light));
    registerIpc();
    // A task left open by an earlier run can't continue: its session is gone.
    void tasks.interrupt().catch((err: unknown) => console.error("Could not settle the last task", err));
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    tasks.close();
    turns.close();
    // The test prompt cleans up (its CLI, its temporary folder) before the app goes; bounded wait.
    const testStopped = Promise.race([guards.close(), new Promise<void>((r) => setTimeout(r, QUIT_TEST_WAIT_MS))]);
    const setupStopped = setupRun ? stopSetupProcess(setupRun) : Promise.resolve();
    void (async () => {
      // A folder move under way finishes (or undoes itself) first: it is never cut short on purpose.
      await moving?.catch(() => undefined);
      await Promise.all([setupStopped, testStopped]);
      try {
        await dropRuntime();
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await turns.flush();
    })().finally(() => app.quit());
  });
}
