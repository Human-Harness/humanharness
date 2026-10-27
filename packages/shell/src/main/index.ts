import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, type ModelProfile, type ModelSpec, NOTICE_VERSION, availableEngines, defaultTier, getEngine } from "@humanharness/engines";
import {
  DEFAULT_LANGUAGE,
  type LoadedHarness,
  PROFILE_COLLECTION,
  SETTINGS_COLLECTION,
  TIERS,
  type Tier,
  allBlocks,
  choiceOptionSchema,
  dataCollections,
  hasModes,
  hasPhases,
  hasProfiles,
  inputBlocks,
  inputSpecs,
  interviewCollections,
  loadHarness,
  profileFormSpec,
  resolveInHarness,
  settingsView,
} from "@humanharness/harness-sdk";
import { MaterialStore, materialSection, workerRunner } from "@humanharness/material/light";
import { type Event, type HarnessRuntime, createRuntime } from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type ChatLoad,
  type ConfiguredApp,
  type FolderPick,
  type ModelsView,
  type ModeView,
  type MoveResult,
  type ProfileResult,
  type ProfilesState,
  type RunningSetup as SetupInfo,
  type ScopesView,
  type SendOptions,
  type SetupOutput,
  type SetupStep,
  type SetupStepResult,
  type SetupStepsState,
  type TestResult,
  type UsageSummary,
  RESTORE_POINT,
  RESTORE_TASK,
  TEXT_SIZES,
  type TextSize,
  isConfigured,
  stepTextSize,
} from "@humanharness/ui/client";
import {
  APP_SCOPE,
  DataStore,
  History,
  MAIN_SCOPE,
  ScopeStore,
  buildDataContext,
  dataDiffOf,
  isScopeId,
  migrateToScopes,
  notesPrefix,
  profileDir,
  readNotes,
  syncLocations,
  syncStatus,
  tasksFile,
  writeNote,
} from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { devDockIcon } from "./dock-icon";
import { ChatLog } from "./chat-log";
import { ConfigStore, historyDir } from "./config";
import { agentDataRequest, harnessUiDataRequests, personDataRequests, saveAnswerRecords } from "./data-requests";
import { testPrompt } from "./engine-check";
import { createCommandDeps } from "./command-deps";
import { cliCommand, engineCommand, loginShellPath } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { installCommandOf, terminalCommand } from "./install-help";
import { detectEngine, hasAcceptedNotice } from "./engine-status";
import { QUESTIONS, cleanModels, engineOffer, firstOffered, fitEffort, nearestTier, nextFallback, resolveProfile } from "./models";
import { chooseModeHandler } from "./mode-ipc";
import { setPhaseHandler, timeBoxOffered } from "./phase-ipc";
import { requireNoticeForChoice, requireNoticeForTurn } from "./notice-policy";
import { archiveChatsOnEngineChange, archiveStaleChat, startNewChatIfEngineChanged } from "./engine-switch";
import { type RunningSetup, runSetupProcess, setupCommand, stopSetupProcess } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import { type SharedEngineRecord, SharedConfigStore, sharedConfigDir } from "./shared-config";
import { EngineUnavailable, TurnController, memoise } from "./turn-controller";
import { type UsageRecord, UsageLog, compactionRecord, profileMeta, profilesUsage, summarizeUsage, usageRecord } from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import { saveWithFolderChange } from "./folder-change";
import { type MoveDeps, guardedMove, moveFolder, moveJournal, precheckMove, recoverMove } from "./move-folder";
import { type ResolvedReference, displayPath, resolveReferences, usableReferences } from "./references";
import { respondHandler } from "./respond-ipc";
import { SettingsController } from "./settings";
import { SetupSteps, recordSetup, setupStepViews } from "./setup-steps";
import { TaskManager } from "./task-manager";
import type { MaterialService } from "./material";
import { historyKeep, materialAppState, openMaterial } from "./material-ipc";
import { personMaterialRequest } from "./material-requests";
import { baseFor, isInsideFolder } from "./profile-base";
import { type ProfileOutcome, Profiles, profileResult } from "./profiles";
import { ProfileSwitch } from "./profile-switch";
import { holds } from "./holds";
import { historyView, isSha } from "./history-view";
import { RestoreGuard, lastOpened } from "./restore-guard";
import { TaskStore, emptyTasks } from "./task-store";
import { textSizeShortcut, trafficLightY } from "./text-size";
import {
  MOCK_MODEL,
  devEngine,
  fakeSetupResult,
  isMockEngine,
  mockEngineText,
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
/** The harness's settings (harness-settings spec); null when it declares none (D0). Set once the harness is loaded. */
let settingsCtl: SettingsController | null = null;
/** The harness's setup steps (setup-steps spec); null without any (D0): no `.harness/setup.json` is ever read or written. */
let setupCtl: SetupSteps | null = null;
/** The harness's profiles (profiles spec); null without them (D4): no `profiles.json` is ever read or written. */
let profilesCtl: Profiles | null = null;
const NO_SETUP_STEPS: SetupStepsState = { steps: {}, blocking: [] };
const NO_PROFILES: ProfilesState = { active: null, list: [] };
const NO_SETUP_STEP: SetupStepResult = { ok: false, reason: "unknown" };

/**
 * The reference folders usable with the working folder: one that is or contains it is left out (its
 * read-only rules would block the person's own files), with `log` saying why.
 */
async function referencesFor(folder: string | undefined, log = false): Promise<ResolvedReference[]> {
  const refs = await references;
  if (!folder) return refs;
  return usableReferences(refs, folder, log ? (message) => console.error(message) : undefined);
}

/**
 * The reference folders the agent and `hh:openPath`/`hh:revealPath` use: those usable with the working folder `base`
 * and, with profiles, none inside the app's folder (another profile's folder never reaches them). Without profiles,
 * `referencesFor(base)` as before (D0).
 */
async function workReferences(c: AppConfig, base: string, log = false): Promise<ResolvedReference[]> {
  if (!profilesOn() || !c.folder) return referencesFor(base, log);
  return usableReferences(await references, base, log ? (message) => console.error(message) : undefined, c.folder);
}

const mode = () => (app.isPackaged ? "distribution" : "development");
/** The engines this app offers (spec 3e: mock mode offers only the faked ones). */
const offered = () => offeredEngines(availableEngines(harness.engines, mode()), hooks);
const stateBlocks = () => new Set(Object.entries(allBlocks(harness)).filter(([, b]) => !b.visible).map(([n]) => n));
const rendererFile = path.join(here, "../renderer/index.html");
// The dev server is only trusted in development: a packaged app always loads its own file.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const appUrl = (url: string) => isAppUrl(url, { devUrl, rendererFile });
const validation = (): ValidationContext => ({
  engineIds: offered().map((e) => e.id),
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
async function modelsView(): Promise<ModelsView> {
  const engines = offered();
  const saved = await shared.load().catch(() => ({ version: 1 as const, engines: {} as Record<string, SharedEngineRecord> }));
  // Mock mode: a faked engine offers only the test model, and every tier uses it (effort and cap kept).
  const tierSpec = (engineId: string, tier: Tier): ModelSpec =>
    isMockEngine(hooks, engineId) ? { ...defaultTier(engineId, tier), model: MOCK_MODEL } : defaultTier(engineId, tier);
  const offer = (e: EngineDef) => {
    const real = engineOffer(e, saved.engines[e.id] ?? {});
    return isMockEngine(hooks, e.id) ? { ...real, models: mockModels() } : real;
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

/** The last app state read: it stands in when the state can't be read after a profile change that went through. */
let lastAppState: AppState | null = null;

async function appState(): Promise<AppState> {
  const harnessImage = await harnessLogo();
  const saved = await config.load();
  const inputs = inputSpecs(harness.blocks);
  const interviews = interviewCollections(harness);
  const state: AppState = {
    harness: {
      id: harness.id,
      name: harness.name,
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
            ...mockEngineText(),
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
        {
          label: a.label,
          cost: a.cost,
          ...(a.description ? { description: a.description } : {}),
          ...(a.tier ? { tier: a.tier } : {}),
          ...(a.scope ? { scope: a.scope } : {}),
          ...(a.modes ? { modes: a.modes } : {}),
          ...(a.defaultMode ? { defaultMode: a.defaultMode } : {}),
          // What the stepper shows of each phase (never its brief), and the time box's lengths (task-phases D0).
          ...(a.phases
            ? {
                phases: a.phases.map((p) => ({
                  id: p.id,
                  label: p.label,
                  ...(p.auto ? { auto: true as const } : {}),
                  ...(p.close ? { close: true as const } : {}),
                  ...(p.modes !== undefined ? { modes: p.modes } : {}),
                })),
              }
            : {}),
          ...(a.timeBox ? { timeBox: { options: a.timeBox.options, default: a.timeBox.default } } : {}),
          // An interview step's action is no topic (setup-steps spec §3): the setup screen and Settings start it.
          ...(Object.hasOwn(interviews, id) ? { setup: true as const } : {}),
        },
      ]),
    ),
    path: harness.path ?? [],
    ...(harness.scopes ? { scopes: harness.scopes } : {}),
    // Only a harness with input blocks sends their specs (spec D0).
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    // Only a harness with settings gets its tab (harness-settings D0).
    ...(harness.settings ? { settings: settingsView(harness.settings, harness.modes) } : {}),
    // Only a harness with modes sends them (task-modes D0): what the window shows, never a brief or a hint.
    ...(hasModes(harness)
      ? {
          modes: Object.fromEntries(
            Object.entries(harness.modes).map(([id, m]): [string, ModeView] => [
              id,
              { label: m.label, ...(m.description ? { description: m.description } : {}), ...(m.minTier ? { minTier: m.minTier } : {}) },
            ]),
          ),
        }
      : {}),
    // Only a harness with setup steps sends them (setup-steps D0).
    ...(harness.setup ? { setup: setupStepViews(harness) } : {}),
    // Only a harness with profiles sends them (profiles D4): what to call one, and its form.
    ...(harness.profiles ? { profiles: { label: harness.profiles.label, form: profileFormSpec(harness) } } : {}),
    // Only a harness with material sends what it takes (material D0).
    ...materialAppState(harness),
    references: (await referencesFor(saved.folder)).map((r) => ({ id: r.id, label: r.label, path: displayPath(r.path, os.homedir()) })),
    models: await modelsView(),
    backup: await backupView(saved.folder),
  };
  lastAppState = state;
  return state;
}

/** The saved config, only when it is complete and valid (and, with profiles, names the active profile). */
async function validConfig(): Promise<ConfiguredApp | null> {
  const c = await config.load();
  return isConfigured(c) && (await configProblem(c, validation())) === null && baseFor(c, profilesOn()) !== null ? c : null;
}

/** The harness declares profiles (profiles spec); without them the base is the folder itself (D4). */
const profilesOn = (): boolean => hasProfiles(harness);

/**
 * The folder every path under `.harness/` starts from (packages/workspace/src/layout.ts): the configured folder, or
 * the active profile's folder in a harness with profiles (spec D2). It never answers the root of a profiles app:
 * callers get the config from `validConfig`, which is null until a profile is active.
 */
const baseOf = (c: { folder: string; profile?: string }): string => {
  const base = baseFor(c, profilesOn());
  if (base === null) throw new Error("Choose a profile first");
  return base;
};

/** The harness declares scopes (spec D1); without them everything stays as before (D2). */
const scoped = (): boolean => harness.scopes !== undefined;


/** tasks.json is read knowing the manifest's modes, so a mode it no longer declares is dropped (task-modes spec §6). */
const taskStoreOptions = (): { modes?: string[]; phases?: Record<string, string[]> } => ({
  ...(hasModes(harness) ? { modes: Object.keys(harness.modes) } : {}),
  // Each action's own phase ids: a phase another action has is still unknown to this one.
  ...(hasPhases(harness)
    ? { phases: Object.fromEntries(Object.entries(harness.actions).flatMap(([id, a]) => (a.phases ? [[id, a.phases.map((p) => p.id)]] : []))) }
    : {}),
});

/** One registry per base, so its write queue orders every change. */
/** Whether `id` is in the configured folder's registry and not archived. */
async function activeScope(id: string): Promise<boolean> {
  const c = await validConfig();
  return c ? (await scopeStoreFor(baseOf(c)).list()).some((s) => s.id === id && !s.archived) : false;
}

const scopeStores = new Map<string, ScopeStore>();
function scopeStoreFor(base: string): ScopeStore {
  let store = scopeStores.get(base);
  if (!store) {
    store = new ScopeStore(base);
    scopeStores.set(base, store);
  }
  return store;
}

/**
 * One data store per base, so its write queue orders every write: the person's (hh:data) and the agent's
 * (its data tools). Every caller gets the store from here, never with `new DataStore`.
 */
const dataStores = new Map<string, { store: DataStore; off: () => void }>();
function dataStoreFor(base: string): DataStore {
  let entry = dataStores.get(base);
  if (!entry) {
    // The harness's collections, plus the reserved `settings` one when it declares settings (D0: harness.data itself).
    const store = new DataStore(base, dataCollections(harness));
    // Spec §4.5 `subscribe`: every write, from any writer, reaches the window. A settings write also reaches AGENTS.md
    // once no task is open (harness-settings D4): the controller only marks it stale and queues the rewrite.
    entry = {
      store,
      off: store.onChange((change) => {
        sendToWindow("hh:dataChange", change);
        if (change.collection === SETTINGS_COLLECTION) void settingsCtl?.changed();
        // Profiles: the registry copies the record's name and colour (spec §4), whoever wrote it. Never rejects.
        if (change.collection === PROFILE_COLLECTION) void profilesCtl?.sync(path.resolve(base));
      }),
    };
    dataStores.set(base, entry);
  }
  return entry.store;
}

/** The folder changed or moved: the old base's store goes, with its listener. */
function dropDataStore(base: string): void {
  dataStores.get(base)?.off();
  dataStores.delete(base);
}

/** Every store under `root` (the folder itself, or each profile's): a moved or changed folder drops them all. */
function dropDataStoresUnder(root: string): void {
  for (const base of [...dataStores.keys()]) if (isInsideFolder(base, root)) dropDataStore(base);
}

/** The last migration run (settleScopes). Scope requests wait for it, whether it worked or not. */
let scopesReady: Promise<unknown> = Promise.resolve();
const scopesSettled = (): Promise<void> => scopesReady.then(() => undefined, () => undefined);

async function scopesView(): Promise<ScopesView> {
  await scopesSettled();
  const c = await validConfig();
  if (!c || !scoped()) return { open: null, list: [] };
  return { open: await tasks.currentScope(), list: await scopeStoreFor(baseOf(c)).list() };
}

async function scopesChanged(): Promise<void> {
  try {
    sendToWindow("hh:scopes", await scopesView());
  } catch (err) {
    console.error("Could not send the scopes to the window", err);
  }
}

/**
 * A profile switch arrived (profiles spec §5): a task left open there by a crash ends, the settings and AGENTS.md are
 * read afresh, the scopes migrate and are sent, and the setup steps and tasks of the new folder reach the window.
 */
async function arrivedInProfile(): Promise<void> {
  await tasks.interrupt();
  settingsCtl?.forget();
  await settingsCtl?.changed();
  await settleScopes();
  await scopesChanged();
  if (setupCtl) sendToWindow("hh:setupSteps", await setupCtl.state());
  sendToWindow("hh:tasks", await tasks.view());
}

async function scopeStore(): Promise<ScopeStore> {
  // A scope created before the migration ran would write scopes.json first and leave the earlier notes behind.
  await scopesSettled();
  const c = await validConfig();
  if (!c) throw new Error("The app is not set up yet");
  if (!scoped()) throw new Error("This harness has no scopes");
  return scopeStoreFor(baseOf(c));
}

/**
 * A harness with scopes in a folder used without them (spec §3.2): earlier work moves into `main`, which opens.
 * `main` is registered through the app's own store, so it queues with the person's changes.
 */
function settleScopes(): Promise<void> {
  const run = scopesSettled().then(async () => {
    const c = await validConfig();
    if (!c || !scoped()) return;
    const base = baseOf(c);
    if (await migrateToScopes(base, undefined, scopeStoreFor(base))) await tasks.switchScope(MAIN_SCOPE);
  });
  scopesReady = run;
  return run;
}

function applyAppearance(appearance: AppConfig["appearance"]) {
  nativeTheme.themeSource = appearance ?? "system";
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);
}

let textSizeSteps: Promise<void> = Promise.resolve();

/** Settings › General › Text size zooms the whole page; the traffic lights follow the taller top bar. */
function applyTextSize(size: TextSize | undefined) {
  if (!window || window.isDestroyed()) return;
  const factor = TEXT_SIZES[size ?? "normal"];
  window.webContents.setZoomFactor(factor);
  if (process.platform === "darwin") window.setWindowButtonPosition({ x: 20, y: trafficLightY(factor) });
}

const runtime = memoise<HarnessRuntime>(async () => {
  const c = await config.load();
  if (!isConfigured(c)) throw new Error("The app is not set up yet");
  const problem = await configProblem(c, validation());
  if (problem) throw new Error(problem);
  // With profiles, the runtime works in the active profile's folder, with that folder's history (spec D2, D5).
  const base = baseFor(c, profilesOn());
  if (base === null) throw new Error("Choose a profile first");
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
  const settings = settingsCtl;
  return createRuntime({
    harness,
    engine,
    folder: base,
    gitdir: historyDir(app.getPath("userData"), base),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(here, "ui-server.js"),
    dataServerEntry: path.join(here, "data-server.js"),
    // The person's store (one write queue per base), for the folder this runtime runs in.
    data: (request) => agentDataRequest({ store: async () => dataStoreFor(base), runningTask: () => tasks.runningTask() }, request),
    // The person's material in this folder, for the running task's scope (material spec §9): the base this runtime was
    // built for, so a request never reaches another profile's material. Absent without material (D0).
    ...(harness.material ? { material: { request: (request: unknown) => materialRequest(base, request), entry: path.join(here, "material-server.js") } } : {}),
    command: cmd.command,
    env: cmd.env,
    references: (await workReferences(c, base, true)).map((r) => ({ label: r.label, path: r.path })),
    // The settings' sentences, read now and on every refresh (harness-settings spec §5). Absent without settings (D0).
    ...(settings ? { instructionSettings: () => settings.sentences() } : {}),
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
  // The next runtime writes AGENTS.md afresh: nothing is pending against this one's. Only once close() resolved (a
  // running refresh would set what was applied again), and not when a new runtime has already written its own.
  if (!runtime.peek()) settingsCtl?.forget();
}

/** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  await tasks.interrupt().catch((err: unknown) => console.error("Could not end the task", err));
  await closeRuntime();
}

/** The history of the folder when no runtime runs: one per folder and ignore list (its queue orders every write). */
const standaloneHistory = lastOpened(async (key) => {
  const { folder, ignore } = JSON.parse(key) as { folder: string; ignore: string[] };
  const history = new History(folder, historyDir(app.getPath("userData"), folder), ignore, historyKeep(harness));
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
  return standaloneHistory(JSON.stringify({ folder: baseOf(c), ignore: [".harness/", "AGENTS.md", ...(extra ? [extra] : [])] }));
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
  chatLog: async (chat) => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason; nothing is written into
    // a folder that didn't pass validation, nor into the root of a profiles app.
    const base = baseFor(c, profilesOn());
    return (await configProblem(c, validation())) === null && base !== null ? new ChatLog(base, c.engineId, chat) : { append: async () => {} };
  },
  stateBlocks,
  inputBlocks: () => new Set(Object.keys(inputBlocks(harness.blocks))),
  emit,
  recordUsage: async (entry, meta, firstLimits) => {
    const c = await validConfig();
    const record = c ? usageRecord(entry, c.engineId, meta, firstLimits) : null;
    if (c && record) await new UsageLog(baseOf(c)).append(record);
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
      return c ? new TaskStore(baseOf(c), taskStoreOptions()).load() : emptyTasks();
    },
    save: async (state) => {
      const c = await validConfig();
      if (c) await new TaskStore(baseOf(c), taskStoreOptions()).save(state);
    },
  },
  turns,
  get actions() {
    return harness.actions;
  },
  get scoped() {
    return scoped();
  },
  // An archived scope can't be opened (spec §3.4): it counts as missing here.
  scopeExists: (id) => activeScope(id),
  // A getter, because the harness is loaded after this object is built. Undefined without input blocks (D0).
  get inputBlocks() {
    const blocks = inputBlocks(harness.blocks);
    return Object.keys(blocks).length > 0 ? blocks : undefined;
  },
  markAnswered: async (chat, answer) => {
    const c = await validConfig();
    // `false` means "no such block in the chat"; a missing folder is a different failure.
    if (!c) throw new Error("No valid configuration: the chat log can't be found");
    return new ChatLog(baseOf(c), c.engineId, chat).markAnswered(answer);
  },
  // As the person, through the data store's checks (spec §6); the write goes out with the follow-up's commit.
  saveAnswer: (collection, records, scope) =>
    saveAnswerRecords(
      async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      collection,
      records,
      scope,
    ),
  // Spec §4.4: only a harness with a collection that goes into the context gets the hook (D2).
  // A getter, because the harness is loaded after this object is built.
  get dataContext() {
    if (!Object.values(harness.data).some((c) => c.context !== false)) return undefined;
    return async (scope: string, action: string | undefined) => {
      const c = await validConfig();
      return c ? buildDataContext(dataStoreFor(baseOf(c)), harness.data, scope, action) : "";
    };
  },
  // Material spec §9 Load: only a harness with material gets the hook (D0). A getter: the harness loads later.
  // Only usable sources' fragments make rows (`indexRows`); none: no section.
  get materialContext() {
    const m = harness.material;
    if (!m) return undefined;
    return async (scope: string) => {
      const c = await validConfig();
      if (!c || scope === APP_SCOPE || !isScopeId(scope)) return "";
      const store = materialStore(baseOf(c), scope);
      const rows = await store.indexRows();
      if (rows.length === 0) return "";
      return materialSection({ mode: (await store.grounding()) ?? m.grounding.default, sheet: await store.sheet(), rows, budgetTokens: m.budget.indexTokens });
    };
  },
  get path() {
    return harness.path ?? [];
  },
  // A getter, because the harness is loaded after this object is built. Undefined without settings (D0).
  get betweenTasks() {
    const ctl = settingsCtl;
    return ctl ? () => ctl.betweenTasks() : undefined;
  },
  // Getters, because the harness is loaded after this object is built. Undefined without modes (task-modes D0).
  get modes() {
    return hasModes(harness) ? harness.modes : undefined;
  },
  readModeBrief: (mode) => {
    if (!Object.hasOwn(harness.modes, mode)) return Promise.reject(new Error("Unknown mode"));
    return fs.readFile(resolveInHarness(harness, harness.modes[mode].brief), "utf8");
  },
  readPhaseBrief: (action, phase) => {
    const p = Object.hasOwn(harness.actions, action) ? harness.actions[action].phases?.find((x) => x.id === phase) : undefined;
    if (!p?.brief) return Promise.reject(new Error("Unknown phase"));
    return fs.readFile(resolveInHarness(harness, p.brief), "utf8");
  },
  // Before the turn's events: the window draws the change's separator or the wrap-up line (task-phases spec §4.4, §5).
  taskTurn: (notice) => sendToWindow("hh:taskTurn", notice),
  ...(hooks.minuteMs ? { minuteMs: hooks.minuteMs } : {}),
  // A getter, because the harness is loaded after this object is built. Undefined without interview steps (setup-steps D0).
  get interviews() {
    const map = interviewCollections(harness);
    return Object.keys(map).length > 0 ? map : undefined;
  },
  // Mode settings live in the settings controller (harness-settings spec §6); without settings there are none.
  modeSettings: async (mode) => (settingsCtl ? settingsCtl.modeSentences(mode) : []),
  // Fast on purpose (it runs in the task queue): the saved model table only, never the engine's offer.
  tierOf: async (profile) => nearestTier(profile, cleanModels((await config.load()).models)),
  readPrompt: (action) => fs.readFile(resolveInHarness(harness, harness.actions[action].prompt), "utf8"),
  language: async () => (await config.load()).language ?? DEFAULT_LANGUAGE,
  engine: async () => (await config.load()).engineId ?? "",
  notes: async (scope) => {
    const c = await validConfig();
    return c ? readNotes(baseOf(c), notesPrefix(scoped(), scope)) : [];
  },
  writeNote: async (slug, note, meta, scope) => {
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    await writeNote(baseOf(c), slug, note, meta, notesPrefix(scoped(), scope));
  },
  noteExists: async (slug, scope) => {
    const c = await validConfig();
    return c ? fs.access(path.join(baseOf(c), notesPrefix(scoped(), scope), `${slug}.md`)).then(() => true, () => false) : false;
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
  profileFor: async (action, floor) => {
    const c = await config.load();
    const engine = c.engineId ?? "";
    const models = cleanModels(c.models);
    const manifestTier = action !== undefined ? harness.actions[action]?.tier : harness.questions?.tier;
    // `floor`: the mode's minTier when a task restarts in that mode (task-modes spec §5.3); passed only when there is one.
    const profile = resolveProfile({ engine, action, manifestTier, models, ...(floor ? { floor } : {}) });
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
    await new UsageLog(baseOf(c)).append(
      compactionRecord(c.engineId, {
        ...(task.action ? { action: task.action } : {}),
        task: task.id,
        ...(task.mode ? { mode: task.mode } : {}),
        ...(task.phase ? { taskPhase: task.phase.id } : {}),
        ...(task.profile ? profileMeta(task.profile) : {}),
      }),
    );
  },
});

/** The person's material (material spec); null without `material` (D0). Built once the harness is loaded. */
let materialSvc: MaterialService | null = null;

/** The app's one store of a base and scope (one write queue each); a plain one only before the service exists. */
const materialStore = (base: string, scope: string): MaterialStore => materialSvc?.storeAt(base, scope) ?? new MaterialStore(base, scope);

/** The agent's material tools in `base` (the runtime's), in the running task's scope (material spec §9 Fetch). */
const materialRequest = (base: string, request: unknown) =>
  personMaterialRequest({ base: async () => base, runningTask: () => tasks.runningTask(), store: materialStore }, request);

/** Loaded only for a harness with material: the service and the converters' runner stay out of every other app (D0). */
async function buildMaterial(): Promise<MaterialService | null> {
  const m = harness.material;
  if (!m) return null;
  const [{ MaterialService }, { fetchLink }] = await Promise.all([import("./material"), import("./material-fetch")]);
  return new MaterialService({
    material: m,
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    scopeOk: async (scope) => (scoped() ? activeScope(scope) : scope === MAIN_SCOPE),
    pickFiles: async () => {
      if (!window || window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
      return r.canceled ? null : r.filePaths;
    },
    fetchLink: (url) => fetchLink(url),
    send: sendToWindow,
    provider: async () => {
      const engineId = (await config.load()).engineId;
      return engineId ? getEngine(engineId).provider : "";
    },
    window: async () => {
      const c = await validConfig();
      if (!c) return null;
      const primary = getEngine(c.engineId).limits?.primary;
      const last = (await new UsageLog(baseOf(c)).load(50)).filter((r) => r.limits?.length).at(-1);
      const w = last?.limits?.find((x) => x.kind === primary) ?? last?.limits?.[0];
      return w && Date.parse(w.resetsAt) > Date.now() ? { kind: w.kind, utilization: w.utilization } : null;
    },
    afterChange: async (_scope, what) => {
      const history = await currentHistory();
      await history?.save(`Material: ${what}`, await tasks.trailerNow()).catch((err: unknown) => console.error("Could not record the material change", err));
    },
    // The built converter worker (its own entry beside this file), at most CONVERT_AT_ONCE at a time.
    runner: workerRunner({ entry: path.join(here, "material-worker.js") }),
  });
}

/** Saves a config patch; an engine change ends the task, drops the runtime and archives the chat (see EngineGuards). */
async function saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void> {
  if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
    const engineId = patch.engineId;
    await guards.switchEngine(
      {
        // A profile switch counts too: once its task has closed nothing runs, yet its runtime and profile are pending.
        isBusy: hold.engineBusy,
        idle: async () => {
          await tasks.idle();
          await turns.flush();
        },
        save: () => config.save(patch).then(() => undefined),
        dropRuntime,
        archiveChat: async () => {
          const c = await validConfig();
          if (!c || c.engineId !== engineId) return null;
          // D0: one folder, as before. With profiles, every profile's chat (spec §5).
          if (!profilesCtl) return startNewChatIfEngineChanged(baseOf(c), engineId);
          // With no active profile baseOf throws and nothing is archived here: each profile's chat is archived lazily
          // when it is next loaded (archiveStaleChat in hh:loadChat).
          const active = baseOf(c);
          // An unreadable registry still starts the active chat over; the others are archived lazily the same way.
          const list = await profilesCtl.state().then((s) => s.list, () => []);
          const others = list.map((p) => profileDir(c.folder, p.id)).filter((f) => f !== active);
          return archiveChatsOnEngineChange(active, others, engineId);
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
 * What waits for what (profiles spec §5): turns, restores, profile switches, engine changes, folder moves, archives and
 * deletes. Each source is read only when a guard asks, after all of them exist.
 */
const hold = holds({
  quitting: () => quitting,
  tasksBusy: () => tasks.isBusy(),
  moving: () => moving !== null,
  engine: () => guards.turnBlocked(),
  restore: () => restores.turnBlocked(),
  profileSwitch: () => switches.turnBlocked(),
  profileChange: () => profilesCtl?.changing() ?? false,
});

/**
 * Restores: refused while quitting, while a task operation runs or turns are held (engine change, folder
 * move, a profile switch); one at a time; new turns are refused and a runtime starting waits until it ends.
 */
const restores = new RestoreGuard({ quitting: () => quitting, busy: () => tasks.isBusy(), turnBlocked: hold.restoreHeld });
const restoreWith = (run: (history: History) => Promise<unknown>) => restores.run(currentHistory, run);

/**
 * Profile switches (profiles spec §5): one at a time, refused while a turn, a restore, a move, an engine change, an
 * archive or a delete runs, and holding all of them off.
 */
const switches = new ProfileSwitch({
  quitting: () => quitting,
  busy: hold.switchBusy,
  turnBlocked: hold.switchHeld,
  closeTask: () => tasks.finish(),
  closeRuntime,
  saveActive: async (id) => void (await config.setProfile(id)),
  arrived: () => arrivedInProfile(),
});

/** Why a new turn can't start now (engine change, folder move, engine update, a restore, a profile switch), or null. */
const turnBlocked = hold.turnBlocked;

/** The harness UI's data requests (hh:data): one handler, so the person's writes and their commits run one at a time. */
const personData = personDataRequests({
  store: async () => {
    const c = await validConfig();
    return c ? dataStoreFor(baseOf(c)) : null;
  },
  chatScope: () => tasks.chatScope(),
  trailer: () => tasks.trailerNow(),
  history: () => currentHistory(),
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  // Without scopes the only scope is the implicit `main` (D2); with them, the registry's open (not archived) scopes.
  scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
});
/** The same handler for the harness UI, which only reads `settings` (it changes them through `client.settings`). */
const harnessUiData = harnessUiDataRequests(personData, () => harness.settings !== undefined);

function registerIpc() {
  handle("hh:getState", () => appState());
  handle("hh:pickFolder", async (defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    return { folder, problem: await checkFolder(folder, os.homedir()) } satisfies FolderPick;
  });
  handle("hh:saveConfig", async (raw: unknown) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("A config change must be an object");
    // The active profile changes only through a profile switch (profiles spec §4).
    const { profile: _profile, ...input }: AppConfig = raw as AppConfig;
    const problem = await configProblem(input, validation());
    if (problem) throw new Error(problem);
    // Spec §7: a bad entry under models is dropped, never stored.
    const patch: AppConfig = input.models !== undefined ? { ...input, models: cleanModels(input.models) } : input;
    const before = await config.load();
    // Spec §9: an engine is only used once its notice is accepted.
    await requireNoticeForChoice(patch.engineId, before.engineId, hasNotice);
    // A new folder: refused while a turn or a restore runs, and turns are refused until it is over; the old
    // folder's task ends and its runtime goes.
    await saveWithFolderChange(patch.folder, before.folder, { isBusy: hold.folderBusy, guards, interrupt: () => tasks.interrupt(), dropRuntime }, () =>
      saveConfigPatch(patch, before),
    );
    if (patch.folder !== undefined && patch.folder !== before.folder) {
      if (before.folder) dropDataStoresUnder(before.folder);
      await settleScopes()
        .then(scopesChanged)
        .catch((err: unknown) => console.error("Could not prepare the scopes", err));
    }
    // Set up now (or in a new folder): its setup.json is on file before the window can start a task (the interview's).
    await recordSetup(setupCtl, async () => (await validConfig()) !== null);
    if (patch.appearance) applyAppearance(patch.appearance);
    if (patch.textSize) applyTextSize(patch.textSize);
    return appState();
  });
  handle("hh:loadChat", async (): Promise<ChatLoad> => {
    // After the migration: it opens `main`, whose chat is the one to show.
    await scopesSettled();
    const c = await validConfig();
    if (!c) return { entries: [] };
    // The engine change archives the chat; the check here only catches a change made while the app was closed.
    const switchedFrom =
      guards.takeSwitchedFrom() ?? (hold.engineBusy() || guards.turnBlocked() ? null : await archiveStaleChat(baseOf(c), c.engineId, dropRuntime));
    return { entries: await new ChatLog(baseOf(c), undefined, await tasks.chatScope()).load(), ...(switchedFrom ? { switchedFrom } : {}) };
  });
  handle("hh:send", (message: string, options?: SendOptions) => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    if (typeof message !== "string" || !message.trim() || message.length > 20_000) throw new Error("Invalid message");
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    // The mode the person picked for a new task ("ask"); one the action doesn't list is refused before anything closes.
    const mode = action && typeof options?.mode === "string" && (harness.actions[action].modes ?? []).includes(options.mode) ? options.mode : undefined;
    if (options?.mode !== undefined && mode === undefined) throw new Error("Unknown mode");
    const scope = options?.scope;
    if (scope !== undefined && !isScopeId(scope)) throw new Error("Unknown scope");
    // The time box the person picked (task-phases spec §5): one the action doesn't offer is refused before anything closes.
    const offered = action ? harness.actions[action].timeBox?.options : undefined;
    const timeBox = options?.timeBox;
    if (timeBox !== undefined && !timeBoxOffered(timeBox, offered)) throw new Error("Unknown time box");
    // A message with an action starts that task (the message is what the chat shows); any other follows up or asks.
    const sent = action ? tasks.start(action, message, scope, mode, timeBox !== undefined ? { timeBox } : {}) : tasks.ask(message, undefined, scope);
    return scope === undefined ? sent : sent.finally(() => void scopesChanged());
  });
  handle("hh:getTasks", () => tasks.view());
  handle("hh:scopes", async () => (await scopesView()).list);
  handle("hh:scopeCurrent", async () => {
    await scopesSettled();
    return tasks.currentScope();
  });
  handle("hh:scopeCreate", async (title: unknown) => {
    const created = await (await scopeStore()).create(title);
    await scopesChanged();
    return created;
  });
  handle("hh:scopeRename", async (id: unknown, title: unknown) => {
    if (!isScopeId(id)) throw new Error("Unknown scope");
    const renamed = await (await scopeStore()).rename(id, title);
    await scopesChanged();
    return renamed;
  });
  // A scope is never deleted (spec §3.4). Archiving the open one closes its task and the scope first.
  handle("hh:scopeArchive", async (id: unknown, archived: unknown) => {
    if (quitting) throw new Error("The app is closing");
    if (!isScopeId(id) || typeof archived !== "boolean") throw new Error("Invalid scope change");
    const store = await scopeStore();
    const closeIfOpen = async () => {
      if ((await tasks.currentScope()) !== id) return;
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      if (!(await tasks.switchScope(null))) throw new Error("The open task is still closing");
    };
    if (archived) await closeIfOpen();
    await store.setArchived(id, archived);
    // It may have been opened while the close ran (the scope was not archived yet): close it again.
    if (archived) await closeIfOpen();
    await scopesChanged();
  });
  handle("hh:scopeOpen", async (id: unknown) => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    if (id !== null && !isScopeId(id)) throw new Error("Unknown scope");
    const opened = await tasks.switchScope(id);
    await scopesChanged();
    return opened;
  });
  handle("hh:data", async (request: unknown, options: unknown) => {
    // After the migration: it opens `main`, the scope a request made on mount acts in.
    await scopesSettled();
    return harnessUiData(request, options);
  });
  handle("hh:dataDiff", async (taskId: unknown) => {
    if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > 200) return [];
    const history = await currentHistory();
    return history ? dataDiffOf(history, taskId, dataCollections(harness)) : [];
  });
  // The harness's Settings tab (harness-settings spec §4). Refusals come back as data: Electron flattens thrown errors.
  handle("hh:settingsGet", () => (settingsCtl ? settingsCtl.state() : { values: {}, pending: [] }));
  handle("hh:settingsSet", (field: unknown, value: unknown) =>
    settingsCtl ? settingsCtl.set(field, value) : { ok: false, message: "This harness has no settings" },
  );
  handle("hh:settingsReset", () => (settingsCtl ? settingsCtl.reset() : { ok: false, message: "This harness has no settings" }));
  // The harness's setup steps (setup-steps spec §4, §5). Without any, nothing to read and every change refused (D0).
  // A call that fails (a setup.json that can't be saved, a settings write that throws) is a refusal, or the state as
  // it stands, never a thrown error.
  const stepRefused = (err: unknown): SetupStepResult => {
    console.error("A setup step call failed", err);
    return { ok: false, reason: "not-ready" };
  };
  const stepsAsTheyStand = (err: unknown): Promise<SetupStepsState> => {
    console.error("A setup step call failed", err);
    return setupCtl ? setupCtl.state().catch(() => NO_SETUP_STEPS) : Promise.resolve(NO_SETUP_STEPS);
  };
  handle("hh:setupStepsGet", () => (setupCtl ? setupCtl.state().catch(() => NO_SETUP_STEPS) : NO_SETUP_STEPS));
  handle("hh:setupStepValues", (id: unknown) => (setupCtl ? setupCtl.values(id).catch(() => ({})) : {}));
  handle("hh:setupStepSubmit", (id: unknown, value: unknown) => (setupCtl ? setupCtl.submit(id, value).catch(stepRefused) : NO_SETUP_STEP));
  handle("hh:setupStepComplete", (id: unknown) => (setupCtl ? setupCtl.complete(id).catch(stepRefused) : NO_SETUP_STEP));
  handle("hh:setupStepSkip", (id: unknown) => (setupCtl ? setupCtl.skip(id).catch(stepRefused) : NO_SETUP_STEP));
  handle("hh:setupStepsFinish", () => (setupCtl ? setupCtl.finish().catch(stepsAsTheyStand) : NO_SETUP_STEPS));
  handle("hh:setupStepsAcknowledge", () => (setupCtl ? setupCtl.acknowledge().catch(stepsAsTheyStand) : NO_SETUP_STEPS));
  // Profiles (profiles spec §5). Without them, nothing to read and every change refused (D4). Refusals come back as data.
  const profileAnswer = (outcome: Promise<ProfileOutcome>): Promise<ProfileResult> =>
    profileResult(
      outcome,
      appState,
      () => lastAppState,
      async () => (profilesCtl ? (await profilesCtl.state()).active : null),
    );
  const noProfiles = (): ProfileResult => ({ ok: false, reason: "not-ready" });
  handle("hh:profilesGet", () => (profilesCtl ? profilesCtl.state().catch(() => NO_PROFILES) : NO_PROFILES));
  handle("hh:profileCreate", (values: unknown) => (profilesCtl ? profileAnswer(profilesCtl.create(values)) : noProfiles()));
  handle("hh:profileOpen", (id: unknown) => (profilesCtl ? profileAnswer(profilesCtl.open(id)) : noProfiles()));
  handle("hh:profileArchive", (id: unknown, archived: unknown) =>
    profilesCtl && typeof archived === "boolean" ? profileAnswer(profilesCtl.setArchived(id, archived)) : noProfiles(),
  );
  handle("hh:profileEdit", (values: unknown) => (profilesCtl ? profileAnswer(profilesCtl.edit(values)) : noProfiles()));
  handle("hh:profileDelete", (id: unknown) => (profilesCtl ? profileAnswer(profilesCtl.remove(id)) : noProfiles()));
  // The person's material (material spec §10). Answers are data; without material every call is "not-ready" (D0).
  const noMaterial = { ok: false, reason: "not-ready" } as const;
  handle("hh:materialList", async (scope: unknown) => (materialSvc && typeof scope === "string" ? materialSvc.list(scope) : null));
  handle("hh:materialAdd", (scope: unknown) => materialSvc?.add(scope) ?? noMaterial);
  handle("hh:materialAddLink", (scope: unknown, url: unknown) => materialSvc?.addLink(scope, url) ?? noMaterial);
  handle("hh:materialConfirm", (scope: unknown, id: unknown, choice: unknown) => materialSvc?.confirm(scope, id, choice) ?? noMaterial);
  handle("hh:materialGrounding", (scope: unknown, mode: unknown) => materialSvc?.setGrounding(scope, mode) ?? noMaterial);
  handle("hh:materialOpen", (scope: unknown, id: unknown) => openMaterial(materialSvc, scope, id, (file) => shell.openPath(file)));
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
  handle("hh:respond", respondHandler({ quitting: () => quitting, blocked: turnBlocked, respond: (blockId, value) => tasks.respond(blockId, value) }));
  // The person's pick of a mode (task-modes spec §5): the acceptance comes back as data.
  handle(
    "hh:chooseMode",
    chooseModeHandler({
      quitting: () => quitting,
      blocked: turnBlocked,
      openTask: async () => (await tasks.runningTask())?.id ?? null,
      choose: (mode, choice, task) => tasks.chooseMode(mode, choice, task),
    }),
  );
  // The person's pick of a phase (task-phases spec §4.2): the acceptance comes back as data.
  handle("hh:setPhase", setPhaseHandler({ quitting: () => quitting, blocked: turnBlocked, setPhase: (to, task) => tasks.setPhase(to, task) }));
  // The stepper's Finish and the time box's controls.
  handle("hh:finishTask", () => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    return tasks.finish();
  });
  // Quitting already paused the box (TaskManager.close): nothing may run it again.
  handle("hh:pauseTask", () => {
    if (quitting) return false;
    return tasks.pauseTimeBox();
  });
  handle("hh:resumeTask", () => {
    if (quitting) return false;
    return tasks.resumeTimeBox();
  });
  handle("hh:extendTimeBox", () => {
    if (quitting) return false;
    return tasks.extendTimeBox();
  });
  handle("hh:openPath", async (file: unknown) => {
    const c = await validConfig();
    if (!c) return false;
    const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
    const target = await openableFile(file, roots);
    if (!target) return false;
    // Checked again right before opening: the file or a folder above it may have been swapped for a link meanwhile.
    return openIfStillSafe(target, roots, (p) => shell.openPath(p));
  });
  // Shows a file in Finder (it never opens it): any kind of file, with the same checks as hh:openPath.
  handle("hh:revealPath", async (file: unknown) => {
    const c = await validConfig();
    if (!c) return false;
    const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
    const target = await revealableFile(file, roots);
    if (!target) return false;
    return revealIfStillSafe(target, roots, (p) => shell.showItemInFolder(p));
  });
  // Cancels the turn and stops the task operation (a closing turn never goes on to the next task).
  handle("hh:cancel", () => tasks.cancel());
  // Restore commits carry no task: going back may undo several tasks, so it belongs to none of them.
  handle("hh:restore", (sha: unknown) => {
    if (!isSha(sha)) throw new Error("Invalid point");
    // A restore changes tracked files with no data event: the settings may have changed.
    return restoreWith((history) => history.restore(sha, RESTORE_POINT)).then(() => void settingsCtl?.changed());
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
    }).then(() => void settingsCtl?.changed()),
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
        isBusy: hold.engineBusy,
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
    const engineOnly = (records: UsageRecord[]) => records.filter((r) => r.engine === c.engineId);
    // Profiles: the app's window is shared, so every profile's log counts (spec §4 "Usage").
    const ids = profilesCtl && c.profile ? await profilesCtl.state().then((s) => s.list.map((p) => p.id), () => null) : null;
    // An unreadable registry: the active profile's own log, as without profiles.
    if (ids && c.profile) {
      const logs = await Promise.all(ids.map(async (id) => [id, engineOnly(await new UsageLog(profileDir(c.folder, id)).load())] as const));
      return profilesUsage(Object.fromEntries(logs), c.profile, primary);
    }
    return summarizeUsage(engineOnly(await new UsageLog(baseOf(c)).load()), primary);
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
    // Read without creating a history: a folder that has none yet has no tracked files.
    const hasHistory = (folder: string) => fs.access(historyDir(userData, folder)).then(() => true, () => false);
    // With profiles every profile's history moves with the folder (spec §4); without them, the folder's own (D0).
    const people = profilesCtl;
    const profileIds = async () => (people ? (await people.state()).list.map((p) => p.id) : []);
    const deps: MoveDeps = {
      check: (folder) => checkFolder(folder, os.homedir()),
      tracked: people
        ? async () => {
            // Every profile's tracked files, relative to the app's folder. The runtime is closed by now
            // (`guardedMove` closes it before `move()`), so each history is opened on its own.
            const extra = getEngine(c.engineId).instructionsFile?.path;
            const ignore = [".harness/", "AGENTS.md", ...(extra ? [extra] : [])];
            const out: string[] = [];
            for (const id of await profileIds()) {
              const folder = profileDir(c.folder, id);
              if (!(await hasHistory(folder))) continue;
              const history = await standaloneHistory(JSON.stringify({ folder, ignore }));
              out.push(...(await history.trackedFiles()).map((f) => `${id}/${f}`));
            }
            return out;
          }
        : async () => ((await hasHistory(baseOf(c))) ? ((await (await openHistory())?.trackedFiles()) ?? []) : []),
      ...(people ? { subfolders: profileIds } : {}),
      saveFolder: async (folder) => void (await config.replaceFolder(folder)),
      historyDir: (folder) => historyDir(userData, folder),
      journal: moveJournal(userData),
      ops: { trash: (p) => shell.trashItem(p) },
    };
    // Checked and set with no await in between, so two requests can't both start a move.
    if (moving) return { ok: false, error: "busy" };
    const run = guardedMove({
      guards,
      isBusy: hold.folderBusy,
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
    dropDataStoresUnder(c.folder);
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
    title: harness.name,
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
  // A reload starts at the browser's zoom: put the saved size back.
  win.webContents.on("did-finish-load", () => {
    void config.load().then((c) => applyTextSize(c.textSize), () => applyTextSize(undefined));
  });
  // ⌘+, ⌘− and ⌘0 change the saved size (not the browser's own zoom, which would be forgotten).
  win.webContents.on("before-input-event", (event, input) => {
    const step = textSizeShortcut(input, process.platform);
    if (!step) return;
    event.preventDefault();
    // One after another: a held key or quick presses each step from the size the last one saved.
    textSizeSteps = textSizeSteps
      .then(async () => {
        const c = await config.load();
        const textSize = stepTextSize(c.textSize, step);
        if (textSize === (c.textSize ?? "normal")) return;
        await config.save({ textSize });
        applyTextSize(textSize);
        sendToWindow("hh:textSize", textSize);
      })
      .catch((err: unknown) => console.error("Could not change the text size", err));
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
  app.setName(harness.name);
  app.setPath("userData", hooks.userData ?? path.join(app.getPath("appData"), "Human Harness", harness.id));
  if (harness.settings) {
    settingsCtl = new SettingsController({
      settings: harness.settings,
      modes: harness.modes,
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: settings` commit (open task's trailer).
      write: (request) => personData(request, { scope: APP_SCOPE }),
      taskOpen: async () => (await tasks.runningTask()) !== null,
      whenNoTask: (fn) => tasks.whenNoTask(fn),
      // Only from betweenTasks or a whenNoTask callback (the task queue, which also creates runtimes); peek, never get.
      refresh: async () => {
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      changed: (state) => sendToWindow("hh:settings", state),
    });
  }
  // Only a harness with setup steps gets the controller: its reads may write `.harness/setup.json` (setup-steps D0).
  if (harness.setup) {
    const settings = settingsCtl;
    setupCtl = new SetupSteps({
      steps: harness.setup,
      data: harness.data,
      ...(harness.settings ? { settings: harness.settings } : {}),
      base: async () => {
        const c = await validConfig();
        return c ? baseOf(c) : null;
      },
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: <collection>` commit.
      write: (request) => personData(request, { scope: APP_SCOPE }),
      ...(settings ? { setSetting: (field: string, value: unknown) => settings.set(field, value), settingValues: () => settings.values() } : {}),
      openAction: async () => (await tasks.runningTask())?.action,
      // A folder that ran tasks before these steps existed counts as set up (spec §8 Q3).
      ranBefore: (base) => fs.access(tasksFile(base)).then(() => true, () => false),
      quitting: () => quitting,
      changed: (state) => sendToWindow("hh:setupSteps", state),
    });
  }
  // Only a harness with profiles gets the controller: it reads and writes `<folder>/.harness/profiles.json` (D4).
  if (harness.profiles && Object.hasOwn(harness.data, PROFILE_COLLECTION)) {
    profilesCtl = new Profiles({
      root: async () => (await config.load()).folder ?? null,
      active: async () => (await config.load()).profile,
      collection: harness.data[PROFILE_COLLECTION],
      ...(harness.folder.seed ? { seed: resolveInHarness(harness, harness.folder.seed) } : {}),
      // As the person, app-wide, in the new profile's own store. It has no history yet: its runtime's "Start" records it.
      writeRecord: async (base, record) => void (await dataStoreFor(base).put(PROFILE_COLLECTION, record, { who: "person", scope: APP_SCOPE })),
      readRecord: (base) => dataStoreFor(base).get(PROFILE_COLLECTION, undefined, { who: "person", scope: APP_SCOPE }),
      fields: harness.profiles.fields,
      // As the person, app-wide, in the active profile's store: its checks and its `Data: profile` commit.
      writeActive: async (record) => void (await personData({ op: "put", collection: PROFILE_COLLECTION, record }, { scope: APP_SCOPE })),
      switchTo: (target) => switches.run(target),
      trash: (p) => shell.trashItem(p),
      historyDir: (folder) => historyDir(app.getPath("userData"), folder),
      changed: (state) => sendToWindow("hh:profiles", state),
      blocked: hold.profileChangeBlocked,
    });
  }
  materialSvc = await buildMaterial();
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
    // Development builds: the harness's logo in the Dock, else Human Harness's (`resources/` beside `out/`).
    if (process.platform === "darwin" && !app.isPackaged) {
      const icon = devDockIcon(
        [() => (harness.logo ? resolveInHarness(harness, harness.logo) : undefined), () => path.join(here, "../../resources/hh-logo.png")],
        (file) => nativeImage.createFromPath(file),
      );
      if (icon) app.dock?.setIcon(icon);
    }
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
    // A profile the registry no longer lists (or lists as archived) is not active: Home asks who is using the app.
    // Before setup.json is recorded, so nothing is written into a profile that is gone.
    const saved = await config.load();
    if (profilesCtl && saved.profile && !(await profilesCtl.openable(saved.profile).catch(() => false))) {
      await config.setProfile(undefined).catch((err: unknown) => console.error("Could not clear the active profile", err));
    }
    // Before any task: a configured folder with no setup.json is recorded now, fresh or as set up before (D0: no `setup`, nothing).
    await recordSetup(setupCtl, async () => (await validConfig()) !== null);
    registerIpc();
    // A task left open by an earlier run can't continue: its session is gone.
    void tasks.interrupt().catch((err: unknown) => console.error("Could not settle the last task", err));
    // After the interrupt (queued behind it): a scoped harness's earlier work moves into `main`.
    void settleScopes()
      .then(scopesChanged)
      .catch((err: unknown) => console.error("Could not prepare the scopes", err));
    // Material an earlier run left converting (a quit or crash mid-way) is converted again; other bases (profiles)
    // resume the first time they are used. Without material there is nothing (D0).
    void materialSvc?.settle().catch((err: unknown) => console.error("Could not resume the material", err));
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
