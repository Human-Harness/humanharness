import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  Notification,
  type WebContents,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
  webContents,
} from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, availableEngines, getEngine } from "@humanharness/engines";
import {
  type LoadedHarness,
  allBlocks,
  hasEnginePresets,
  hasModes,
  hasPhases,
  hasProfiles,
  hasSecrets,
  loadHarness,
  materialStageKey,
  pluginsAccepted,
  resolveInHarness,
  stageTier,
} from "@humanharness/harness-sdk";
import { type Job, MaterialStore } from "@humanharness/material/light";
import {
  type Event,
  type HarnessRuntime,
  type HarnessWorkspace,
  type RuntimeOptions,
  type SessionSlot,
  runSystemTask,
} from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type ConfiguredApp,
  TEXT_SIZES,
  type TextSize,
  isConfigured,
} from "@humanharness/protocol";
import type { InvokeChannel, PushChannel } from "@humanharness/protocol/channels";
import { ChatLog } from "./chat-log";
import { ConfigStore } from "./config";
import { createCommandDeps } from "./command-deps";
import { engineCommand, engineSearchPath } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { hasAcceptedNotice } from "./engine-status";
import { cleanModels } from "./models";
import { registerAppIpc } from "./app-ipc";
import { createEngineChange } from "./engine-change";
import { createAppServices } from "./app-services";
import { requireNoticeForTurn } from "./notice-policy";
import { type RunningSetup } from "./setup-runner";
import { SharedConfigStore, sharedConfigDir } from "./shared-config";
import { harnessDirFor, shellResourcesDir } from "./shell-resources";
import { TurnController, type TurnDeps } from "./turn-controller";
import {
  UsageLog,
} from "./usage-log";
import { type ValidationContext, configProblem, isAppUrl } from "./validate";
import { openRoots } from "./open-path";
import { DocumentSessions } from "./document-sessions";
import { DocumentWatchers } from "./documents";
import { type ResolvedReference } from "./references";
import { PluginBackendHost } from "./plugin-host";
import { PluginPanelsOnDemand, installPluginPanels, safeStorageCrypto } from "./plugin-ipc";
import { SecretStore } from "./plugin-secrets";
import { ConnectionsController, connectTests } from "./secrets/connections";
import { testCrypto } from "./secrets/test-crypto";
import { type ToolsHost } from "./tools/tools-host";
import { type BoardHost } from "./board-host";
import { type AttentionStores } from "./attention-stores";
import { type TaskAttention, keepNotification } from "./task-attention";
import { type JobsHost, coalescedSender } from "./jobs/jobs-host";
import { type JobsWiringDeps } from "./jobs/jobs-wiring";
import type { Turns } from "./gated-turns";
import type { TurnGate } from "./turn-gate";
import { type LinkedIpcDeps, linkedSecret } from "./linked-ipc";
import { EngineHost } from "./engine-config/engine-host";
import { type EngineIpc } from "./engine-config/engine-ipc";
import { EPOCHS_FILE, EngineEpochs } from "./engine-config/epochs";
import { type PruneBase, pruneEngineSnapshots } from "./engine-config/prune";
import { createBackendWiring } from "./backend/backend-wiring";
import type { BackendSupervisor } from "./backend/backend-supervisor";
import { linkedHistoryDir, markRelinked } from "./linked-history";
import { LinkedInstructions, type ScopeAccess, createScopeAccess, refreshUnlessBusy } from "./scope-access";
import {
  type LinkedHistoryRef,
  linkedHistoriesFor,
  openLinkedHistory,
} from "./linked-restore";
import { isGitRepo } from "./linked-folders";
import { PluginsController } from "./plugins";
import { SettingsController } from "./settings";
import { SetupSteps } from "./setup-steps";
import { type TaskDeps, TaskManager } from "./task-manager";
import { createTaskDeps, createTurnDeps } from "./task-deps";
import { createAppState } from "./app-state";
import { createScopeStores } from "./scope-stores";
import { createRuntimeWiring } from "./runtime-wiring";
import { createAppMods } from "./mods/app-mods";
import { createAppViews } from "./app-views";
import { type TranslationService } from "./translation";
import type { MaterialService } from "./material";
import type { MaterialJobs } from "./material-jobs";
import { type MaterialStageDeps } from "./material-stage";
import { personMaterialRequest } from "./material-requests";
import { baseFor } from "./profile-base";
import { Profiles } from "./profiles";
import { trafficLightY } from "./text-size";
import { createWindow as createAppWindow } from "./window";
import { onLoaded, onPrimary } from "./app-lifecycle";
import {
  isMockEngine,
  offeredEngines,
  readTestHooks,
} from "./test-hooks";

declare const __HARNESS_DIR__: string;
declare const __SHELL_RESOURCES__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };

// The build's folder. Not `__dirname`: electron-vite's ESM shim for it once landed inside a bundled JSDoc comment.
const here = import.meta.dirname;
/** The hosts' files and Dock icon, and the harness folder: the build's, or the packaged app's (shell-resources.ts). */
const shellResources = shellResourcesDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, built: __SHELL_RESOURCES__ });
const harnessDir = harnessDirFor({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, built: __HARNESS_DIR__ });
const commandDeps = createCommandDeps(process.execPath);

let harness: LoadedHarness;
let config: ConfigStore;
let shared: SharedConfigStore;
let window: BrowserWindow | null = null;
/** Set on the first before-quit: from then on, no new turns or restores. */
let quitting = false;
/** Codex can't take linked folders (hatches Decision 15): set once its transport says so. */
let linkedUnsupported = false;
/** Linked folders (hatches): the IPC's deps, the turns' access and AGENTS.md's rewrite. Null without them (D0). */
let linkedParts: { access: ScopeAccess; instructions: LinkedInstructions } | null = null;
/** The scopes' engine presets (hatches spec §5), made on first use: only a harness with `enginePresets` (D0: null). */
let engineHost: EngineHost | null = null;
/** The scopes' engine approval epochs (revocation record), shared by the host and the channels: one writer. */
let engineEpochs: EngineEpochs | null = null;
/** The Engine config channels (hatches spec §5.3), registered only under `enginePresets` (D0: null, nothing sent). */
let engineIpc: EngineIpc | null = null;
/** The linked-folder channels' deps, made once when they are registered (hasLinkedFolders only). */
let linkedDeps: LinkedIpcDeps | null = null;
/** The harness's backend (hatches spec §4); null without `backend` (D0: no process, no file, no channel). */
let backend: BackendSupervisor | null = null;
/** The install, update, login or logout process running now, if any. */
let setupRun: RunningSetup | null = null;
/** How long quitting waits for the test prompt to clean up (its temporary folder, the CLI it started). */
const QUIT_TEST_WAIT_MS = 5_000;
/** Engine changes, setup steps and test prompts against turns (see EngineGuards). */
const guards = new EngineGuards();
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
/** The control channel `humanharness status` and `shot` use (0b2); started after the window, stopped on quit. */
let control: { stop(): Promise<void> } | null = null;
/**
 * Plugins (plugins spec); null for a harness that takes none and no dev folders (D0): no `hh-plugin` scheme, no
 * backend window, no IPC handler, no file.
 */
let pluginsCtl: PluginsController | null = null;
/** The plugins' backend windows (Electron), with pluginsCtl. */
let pluginHost: PluginBackendHost | null = null;
/**
 * The harness's tools (tools spec §4, §5); null for a harness without `tools` (D0): no tools scheme, no host
 * window, no IPC handler, no `tools` server, no AppState.tools, no trace.
 */
let toolsHost: ToolsHost | null = null;
let secretStore_: SecretStore | null | undefined;
/**
 * The one key store (tools spec §9, Decision 8), in the app's own per-harness folder (outside every base): for the
 * plugins or the harness's secrets; none otherwise (D0). Built on first use, then shared.
 */
function secretStore(): SecretStore | null {
  if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0 && !hasSecrets(harness)) return null;
  secretStore_ ??= new SecretStore(path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id, "secrets"), secretCrypto());
  return secretStore_;
}
/** How keys are encrypted: the OS's (Electron safeStorage), or a reversible fake for the e2e (HH_TEST_FAKE_SECRETS). */
const secretCrypto = () => (hooks.fakeSecrets ? testCrypto() : safeStorageCrypto(safeStorage));
let connections_: ConnectionsController | undefined;
/** Settings › Connections (tools spec §9): only when the harness declares secrets, so the store exists. Built once. */
function connections(): ConnectionsController {
  const steps = connectTests(harness.setup);
  connections_ ??= new ConnectionsController({
    secrets: harness.secrets!,
    store: secretStore()!,
    changed: (view) => sendToWindow("hh:connectionsChange", view),
    // Test connection (slice 2): only when a connect step names a test, whose tool the manifest declares (D0).
    ...(steps.length > 0
      ? {
          test: {
            steps,
            file: path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id, "connections.json"),
            // Built after this controller: looked up at each test. As the UI, with {}, in no scope.
            run: (tool: string) =>
              toolsHost ? toolsHost.registry.call({ tool, args: {}, caller: "ui", scope: null }) : Promise.resolve({ ok: false as const, error: "Tools are off" }),
          },
        }
      : {}),
  });
  return connections_;
}
/**
 * The panel handler, request filter and frame guards (P1–P3, P7), installed when the first plugin with panels starts
 * (D0: a harness that takes plugins but runs none with panels gets none of them).
 */
const pluginPanels = new PluginPanelsOnDemand<BrowserWindow>(
  (win) => installPluginPanels(win, pluginHost, pluginsCtl),
  () => (window && !window.isDestroyed() ? window : null),
);
/**
 * Board mode's host (parallel spec §6): a harness that declares `parallel` keeps one lane per open task; null for any
 * other (D7), which runs today's single runtime and TaskManager. Built once the config store exists.
 */
let host: BoardHost | null = null;
/** `host`, where a local name shadows it (the plugins' backend host). */
const boardHost = (): BoardHost | null => host;
/** The jobs' wiring (part 3), in `single` or board mode; null without jobs (D0). Built once the app is ready. */
let jobsHost: JobsHost | null = null;
/** Settings › Jobs as last read from the config (the scheduler reads it synchronously); refreshed on every load and save. */
let jobSettings: AppConfig["jobs"];
/** The Jobs section's rows again, to the window (`hh:jobsChange`); one read at a time, the latest change always sent. */
const pushJobs = coalescedSender(
  async () => (jobsHost ? jobsHost.summaries() : null),
  (rows) => {
    if (rows) sendToWindow("hh:jobsChange", rows);
  },
  (err) => console.error("Could not read the jobs", err),
);
function jobsChanged(): void {
  const jobs = jobsHost;
  if (!jobs) return;
  pushJobs();
}
/**
 * `single` mode (jobs without `parallel`, Decision 12): the gate and the task's turns through its `tasks` cap; the
 * runtime is a workspace's `"main"` slot with the job slots beside it. Null in plain and board mode.
 */
let single: { gate: TurnGate; turns: Turns } | null = null;
/** `single` mode: each runtime's workspace and `"main"` slot (the job slots open in it; an engine held at one session sleeps the slot). */
const singleParts = new WeakMap<HarnessRuntime, { workspace: HarnessWorkspace; slot: SessionSlot }>();
/** The note the single task last wrote (folder-relative): while a job runs, its commit holds that file alone. */
let singleNote: string | undefined;
/**
 * App changes commit only their own files (parallel spec §5.3): in board mode, and while a job runs beside the single
 * task (its work is never filed under another trailer). Otherwise the whole folder, as always (D0).
 */
const ownCommits = (): boolean => host !== null || (jobsHost?.running() ?? false);
/**
 * Board and single mode (parallel spec §9.2, Decision 10): one Attention store per base, shared by the plugins, the
 * waiting tasks (board) and the jobs' needs-you results (part 3). Null in plain mode (D0): the plugins build their own
 * store, as before, and no task or job raises anything.
 */
let sharedAttention: AttentionStores | null = null;
/** Board mode only: waiting tasks' items, the Dock badge and the optional notification. */
let taskAttention: TaskAttention | null = null;
/** Waiting-task notifications on screen: held so their click isn't collected with them. */
const notifications = new Set<Notification>();
/** The plugins inbox's badge as last sent: board mode's Dock badge adds it. */
let pluginBadge = 0;
/** The plugins that run, with their versions (`runningPlugins`): search reads their collections again when it changes. */
let pluginsOn = "";
/** The job × scopes whose last run needs the person (part 3): the Dock badge adds them. 0 without jobs (D0). */
let jobBadge = 0;
/**
 * The Dock badge again: board mode's waiting tasks with the plugins' and jobs' counts; `single` mode the plugins' and
 * jobs' counts. Plain mode sets none (D0).
 */
function refreshDockBadge(): void {
  if (taskAttention) return taskAttention.refreshBadge();
  if (!jobsHost || host) return;
  try {
    setDockBadge(pluginBadge + jobBadge);
  } catch (err) {
    console.error("Could not set the Dock badge", err);
  }
}
/** The one place the Dock badge is set: a count only (0 clears it). Board and single mode only (D0). */
const setDockBadge = (n: number): void => app.dock?.setBadge(n > 0 ? String(n) : "");
/** The jobs' count for the current base, then the Dock badge (a run ended, the base changed). */
async function refreshJobBadge(): Promise<void> {
  const jobs = jobsHost;
  if (!jobs) return;
  jobBadge = await jobs.needsYou().catch((err: unknown) => {
    console.error("Could not count the jobs that need you", err);
    return jobBadge;
  });
  refreshDockBadge();
}
/** `<appDir>/plugin-state`, with pluginsCtl: a folder move carries each base's approvals there to the new key. */
let pluginStateRoot: string | null = null;
const pluginLog = (message: string, err?: unknown) => console.error(`[plugins] ${message}`, err ?? "");
const toolsLog = (message: string, err?: unknown) => console.error(`[tools] ${message}`, err ?? "");
/** The base changed (profile switch, folder change or move, set up): the old base's plugins stop, the new base's start. */
const rebasePlugins = (): Promise<void> => pluginsCtl?.rebase().catch((err: unknown) => pluginLog("Could not move the plugins to the new folder", err)) ?? Promise.resolve();
/** The harness's setup steps (setup-steps spec); null without any (D0): no `.harness/setup.json` is ever read or written. */
let setupCtl: SetupSteps | null = null;
/** The harness's profiles (profiles spec); null without them (D4): no `profiles.json` is ever read or written. */
let profilesCtl: Profiles | null = null;

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

/** Settings › Modelos, the profile a turn runs on, the logos and the reference folders (app-views.ts). */
const { referencesFor, workReferences, harnessLogo, engineLogo, modelsView, supportedEffort, pickProfile } = createAppViews({
  harness: () => harness,
  shared: () => shared,
  hooks,
  references: () => references,
  profilesOn: () => profilesOn(),
  offered,
});

/** The last app state read: it stands in when the state can't be read after a profile change that went through. */
let lastAppState: AppState | null = null;

/**
 * The reader's open documents (document-reader spec §5.3), by window: main tells the window that asked for a watch
 * when its document changes, and only that window; and when a watch ends without the window asking, so it watches again.
 */
const documentSessions: DocumentSessions = new DocumentSessions(
  new DocumentWatchers((id) => {
    const owner = documentSessions.ownerOf(id);
    if (owner !== null) sendToContents(owner, "hh:documentChanged", id);
  }),
  (owner, id) => sendToContents(owner, "hh:documentWatchEnded", id),
);

/** Sends to one window by its webContents id, when it is still there. */
function sendToContents(id: number, channel: PushChannel, value: unknown) {
  try {
    const to = webContents.fromId(id);
    if (to && !to.isDestroyed()) to.send(channel, value);
  } catch (err) {
    console.error("Could not send to the window", err);
  }
}

/**
 * Where documents and images may be read, from the config only: the person's folder (checked by `validConfig`), then
 * the reference folders that resolved (protected folders already refused) and are usable with it; null before setup.
 */
async function documentRoots(): Promise<string[] | null> {
  const c = await validConfig();
  if (!c) return null;
  return openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
}

/** The window's app state; it keeps the job settings and the last state read here. */
const appState = createAppState({
  harness: () => harness,
  config: () => config,
  hooks,
  pluginsCtl: () => pluginsCtl,
  toolsHost: () => toolsHost,
  offered,
  harnessLogo,
  engineLogo,
  modelsView,
  referencesFor,
  setJobSettings: (jobs) => {
    jobSettings = jobs;
  },
  setLastAppState: (state) => {
    lastAppState = state;
  },
});

/** The saved config, only when it is complete and valid (and, with profiles, names the active profile). */
async function validConfig(): Promise<ConfiguredApp | null> {
  const c = await config.load();
  return isConfigured(c) && (await configProblem(c, validation())) === null && baseFor(c, profilesOn()) !== null ? c : null;
}

/** The current base, or null before the app is set up. */
async function currentBase(): Promise<string | null> {
  const c = await validConfig().catch(() => null);
  return c ? baseOf(c) : null;
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

/** The per-base scope and data stores, and the scopes' migration and view (scope-stores.ts). */
const {
  activeScope,
  scopeStoreFor,
  dataStoreFor,
  dropDataStoresUnder,
  scopesSettled,
  scopesView,
  scopesChanged,
  arrivedInProfile,
  scopeStore,
  settleScopes,
} = createScopeStores({
  harness: () => harness,
  validConfig,
  baseOf,
  scoped,
  sendToWindow,
  searchSvc: () => searchSvc,
  settingsCtl: () => settingsCtl,
  profilesCtl: () => profilesCtl,
  setupCtl: () => setupCtl,
  materialSvc: () => materialSvc,
  tasks: () => tasks,
  linked_,
  documentSessions,
  jobsChanged,
  jobsReady,
  kickMaterial,
  interruptTasks: () => interruptTasks(),
  rebasePlugins,
  backendScopes: () => backendScopes(),
  backendLeaveBase: () => backendLeaveBase(),
  backendRebase: () => backendRebase(),
});

function applyAppearance(appearance: AppConfig["appearance"]) {
  nativeTheme.themeSource = appearance ?? "system";
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);
}

/** Settings › General › Text size zooms the whole page; the traffic lights follow the taller top bar. */
function applyTextSize(size: TextSize | undefined) {
  if (!window || window.isDestroyed()) return;
  const factor = TEXT_SIZES[size ?? "normal"];
  window.webContents.setZoomFactor(factor);
  if (process.platform === "darwin") window.setWindowButtonPosition({ x: 14, y: trafficLightY(factor) });
}

/** The runtime, its options and close, and the histories opened beside it (runtime-wiring.ts). */
const { prepareEngine, runtimeOptions, runtime, closeRuntime, dropRuntime, undoByPaths, singleMainSlot, standaloneHistory, currentHistory, openHistory } =
  createRuntimeWiring({
    harness: () => harness,
    config: () => config,
    shared: () => shared,
    hooks,
    commandDeps,
    here,
    validation,
    profilesOn,
    validConfig,
    baseOf,
    restores: () => restores,
    pluginsCtl: () => pluginsCtl,
    settingsCtl: () => settingsCtl,
    toolsHost: () => toolsHost,
    reviews: () => reviews,
    host: () => host,
    single: () => single,
    singleParts,
    jobsHost: () => jobsHost,
    materialJobs: () => materialJobs,
    materialSvc: () => materialSvc,
    tasks: () => tasks,
    plainTasks: () => plainTasks,
    historyHeld: () => historyHeld,
    resolvedMods: () => appMods.state.resolvedMods,
    pluginLog,
    dataStoreFor,
    materialRequest: (base, request, runningTask) => materialRequest(base, request, runningTask),
    workReferences,
    linkedRuntimeOptions,
    engineHost: engineHost_,
    kickMaterial,
    announceCommits: (history) => announceCommits(history),
    stopAnnouncing: (history) => commitAnnouncements.stop(history),
  });


function sendToWindow(channel: PushChannel, value: unknown) {
  try {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  } catch (err) {
    console.error("Could not send to the window", err);
  }
}
const emit = (event: Event) => sendToWindow("hh:event", event);

/** A mod's notice (turned off after three strikes, or its own `notify`): the system notification, as task attention uses. */
function showNotice(text: string): void {
  if (!Notification.isSupported()) return void console.error(`Mod notice: ${text}`);
  keepNotification(new Notification({ title: harness.name, body: text.slice(0, 300) }), notifications).show();
}

/** The mod host, the home folder's mods, layouts and history, safe mode and Settings › Mods (mods/app-mods.ts). */
const appMods = createAppMods({
  harness: () => harness,
  config: () => config,
  hooks,
  commandDeps,
  window: () => window,
  tasks: () => tasks,
  validConfig,
  baseOf,
  scoped,
  hasNotice: (engineId) => hasNotice(engineId),
  pickProfile,
  showNotice,
  sendToWindow,
});
const { modsView, startModHost, watchUserMods, watchUserLayouts, safeMode, startHomeHistory } = appMods;
// Mock mode: the test engine has no provider to disclose and nothing leaves the computer, so its notice counts as accepted.
const hasNotice = async (engineId: string) => isMockEngine(hooks, engineId) || hasAcceptedNotice(shared, engineId);

/** Throws why a turn can't start now: an engine change or update, or the engine's notice not accepted. */
async function checkTurn(): Promise<void> {
  const blocked = guards.turnBlocked();
  if (blocked) throw new Error(blocked);
  // Checked on every turn: the notice may have been reset (Start over) while a runtime runs.
  await requireNoticeForTurn((await config.load()).engineId, hasNotice);
}

/** The chat a turn writes: the scope's (`chat`), or in board mode task `task`'s own. Null before the app is set up. */
async function turnChatLog(chat: string | undefined, task?: string) {
  const c = await config.load();
  if (!isConfigured(c)) return null;
  // An invalid saved config still runs the turn, so the runtime start fails with the reason; nothing is written into
  // a folder that didn't pass validation, nor into the root of a profiles app.
  const base = baseFor(c, profilesOn());
  return (await configProblem(c, validation())) === null && base !== null ? new ChatLog(base, c.engineId, chat, task) : { append: async () => {} };
}

/** The TurnController's deps; board mode's lanes reuse them with their own slot, chat and window routing. */
const turnDeps: TurnDeps = createTurnDeps({
  harness: () => harness,
  config: () => config,
  shared: () => shared,
  runtime,
  checkTurn,
  turnChatLog,
  stateBlocks,
  emit,
  validConfig,
  baseOf,
  engineHost: engineHost_,
  linked: linked_,
});
const turns = new TurnController(turnDeps);
/** Every turn ended and its chat writes settled: today's one, or in board mode each lane's. */
const flushTurns = (): Promise<void> => (host ? host.flush() : turns.flush());

/** A phase's brief text: its `brief` is a file inside the harness folder (the task's phase turn and core mods read it). */
const readPhaseBrief = (action: string, phase: string): Promise<string> => {
  const p = Object.hasOwn(harness.actions, action) ? harness.actions[action].phases?.find((x) => x.id === phase) : undefined;
  if (!p?.brief) return Promise.reject(new Error("Unknown phase"));
  return fs.readFile(resolveInHarness(harness, p.brief), "utf8");
};
/** The TaskManager's deps; board mode's lanes reuse them (getters kept), each with its own store, turns and routing. */
const taskDeps: TaskDeps = createTaskDeps({
  harness: () => harness,
  config: () => config,
  runtime,
  hooks,
  turns,
  single: () => single,
  singleNote: () => singleNote,
  setSingleNote: (note) => {
    singleNote = note;
  },
  jobsHost: () => jobsHost,
  modHost: () => appMods.state.modHost,
  pluginsCtl: () => pluginsCtl,
  settingsCtl: () => settingsCtl,
  toolsHost: () => toolsHost,
  host: () => host,
  tasks: () => tasks,
  contextSvc: () => contextSvc,
  engineHost: engineHost_,
  linked: linked_,
  validConfig,
  baseOf,
  taskStoreOptions,
  scoped,
  activeScope,
  dataStoreFor,
  materialStore: (base, scope) => materialStore(base, scope),
  sendContext: (task) => sendContext(task),
  closeRuntime,
  readPhaseBrief,
  sendToWindow,
  currentHistory,
  emit,
  pickProfile,
  supportedEffort: (p) => supportedEffort(p),
});
const plainTasks = new TaskManager(taskDeps);

/** What the window, the controllers and the guards ask of the open task(s): a TaskManager, or board mode's TaskBoard. */
type TaskApi = Pick<
  TaskManager,
  | "currentScope"
  | "switchScope"
  | "interrupt"
  | "view"
  | "start"
  | "ask"
  | "chatScope"
  | "runningTask"
  | "trailerNow"
  | "whenNoTask"
  | "openPhase"
  | "choose"
  | "respond"
  | "chooseMode"
  | "setPhase"
  | "finish"
  | "pauseTimeBox"
  | "resumeTimeBox"
  | "extendTimeBox"
  | "cancel"
  | "resumeFromNotes"
  | "isBusy"
  | "idle"
  | "startPrepared"
  | "whenSettled"
  | "reviewRound"
  | "documentApproved"
  | "contextRecord"
  | "addContext"
>;
/** Today's single TaskManager; in board mode, the board (set once the host is built). */
let tasks: TaskApi = plainTasks;
/** A task an earlier run, a profile or a folder left open ends; board mode first moves the chats to per-task files. */
const interruptTasks = (): Promise<void> => (host ? host.interrupt() : tasks.interrupt());

/** The person's material (material spec); null without `material` (D0). Built once the harness is loaded. */
let materialSvc: MaterialService | null = null;

/** The app's one store of a base and scope (one write queue each); a plain one only before the service exists. */
const materialStore = (base: string, scope: string): MaterialStore => materialSvc?.storeAt(base, scope) ?? new MaterialStore(base, scope);

/** The material queue of AI stages (material spec §10); null without material (D0). */
let materialJobs: MaterialJobs<Job> | null = null;

/** Wakes the material queue; scope stages that failed since the last kick may run again. Without material, nothing. */
function kickMaterial(): void {
  materialSvc?.resetFailures();
  materialJobs?.kick();
}

/**
 * The agent's material tools in `base` (the runtime's), in the running task's scope (material spec §9 Fetch); board
 * mode passes the asking slot's task.
 */
const materialRequest = (base: string, request: unknown, runningTask: () => Promise<{ id: string; scope: string } | null> = () => tasks.runningTask()) =>
  personMaterialRequest({ base: async () => base, runningTask, store: materialStore, flagged: kickMaterial }, request);

/** What one AI stage's session needs from the app (material spec §10; `runMaterialStage`). */
const materialStageDeps: MaterialStageDeps = {
  setup: async () => {
    const c = await validConfig();
    return c && harness.material ? { engineId: c.engineId, base: baseOf(c) } : null;
  },
  hasNotice,
  engine: getEngine,
  command: async (engine) => hooks.engines?.[engine.id] ?? engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }),
  profile: async (engine, job) => {
    const c = await config.load();
    const models = cleanModels(c.models);
    const manifestTier = harness.material ? stageTier(harness.material, job.stage) : undefined;
    return pickProfile(c.policies?.model, { engine: engine.id, action: materialStageKey(job.stage), manifestTier, models });
  },
  run: (o) => runSystemTask({ ...o, launcher: electronLauncher(process.execPath), entry: path.join(here, "material-server.js") }),
  log: (base, record) => new UsageLog(base).append(record),
};

/** Language on demand (plan 5b); built once the harness is loaded. Nothing is written until a run saves (D0). */
let translation: TranslationService | null = null;

/** Asking before a go-back, the translation's engine and a config save that changes the engine (engine-change.ts). */
const engineChange = createEngineChange(() => lifecycle);

/** The jobs' wiring over the app's own (jobs/jobs-wiring.ts): single mode's or the board's. */
const jobsWiring = (): JobsWiringDeps => ({
  harness: () => harness,
  config: () => config,
  validConfig,
  baseOf,
  quitting: () => quitting,
  turnBlocked: () => turnBlocked(),
  checkTurn,
  restoreBlocked: () => restores.turnBlocked(),
  currentBase,
  taskDeps,
  scoped,
  activeScope,
  scopeStoreFor,
  linked: linked_,
  jobSettings: () => jobSettings,
  changed: jobsChanged,
  sharedAttention: () => sharedAttention,
  refreshJobBadge,
  toolsHost: () => toolsHost,
});

/** Jobs (Decision 7): once the app is set up in this process, the `start` runs and the `every` timers; once only. */
async function jobsReady(): Promise<void> {
  const jobs = jobsHost;
  if (!jobs || quitting) return;
  // This base's needs-you results (from an earlier start, or another profile's) on the Dock badge.
  void refreshJobBadge();
  if (!(await validConfig())) return;
  // A scoped harness's earlier work is in `main` first: "each" runs in the scopes as they are.
  await scopesSettled();
  await jobs.appReady();
}

/** The backend's start, rebase, scopes and stop for a profile switch (backend/backend-wiring.ts). */
const { backendReady, backendRebase, backendScopes, backendLeaveBase } = createBackendWiring(() => lifecycle);

/**
 * A tracked linked folder's history (hatches spec §3.4): the open workspace's (board's or the runtime's) once a turn
 * opened it, else one over its gitdir in the app's data folder when that exists. Never makes one.
 */
const openLinked = openLinkedHistory(
  (real) => linkedHistoryDir(app.getPath("userData"), real),
  async (real) => {
    if (host) return host.linkedHistory(real);
    const rt = await runtime.peek()?.catch(() => null);
    return (await rt?.linkedHistory?.(real)) ?? null;
  },
);

/**
 * "Undo this task"'s tracked linked folders, of the task's scope (else the open one), checked as a turn's are: none
 * without linked folders (D0). Git is looked at first: a folder that gained git is never restored (L7).
 */
async function linkedHistoriesOf(scopeId: string | undefined): Promise<LinkedHistoryRef[]> {
  const linked = linked_();
  if (!linked) return [];
  const scope = scopeId ?? (await tasks.currentScope());
  if (scope === null) return [];
  await linked.access.checkGit(scope).catch((err: unknown) => console.error("Could not check the linked folders' git", err));
  // Fails closed on its own: a folder whose git can't be told now is left out (L7).
  return linkedHistoriesFor(await linked.access.entries(scope), scope, harness.linkedFolders ?? {}, openLinked, isGitRepo);
}

/**
 * Which engine preset a task gets (hatches spec §5.2, §5.3): only a harness that declares `enginePresets` makes it
 * (D0: undefined, and `.harness/engine/` is never read). Approvals are checked with the links' key, never created here.
 */
function engineHost_(): EngineHost | undefined {
  if (!hasEnginePresets(harness)) return undefined;
  if (engineHost) return engineHost;
  const userData = app.getPath("userData");
  const epochs = (engineEpochs ??= new EngineEpochs(path.join(userData, EPOCHS_FILE)));
  engineHost = new EngineHost({
    userData,
    context: async () => {
      const c = await validConfig();
      if (!c) return null;
      const base = baseOf(c);
      return { base, profile: profilesOn() ? (c.profile ?? "") : "", scopes: scopeStoreFor(base) };
    },
    // The folders a turn of the scope reaches now: preset path rules outside them are refused (E5).
    linked: async (scope) => ((await linked_()?.access.access(scope))?.linked ?? []).map((l) => l.path),
    secret: () => linkedSecret(userData)(false),
    epoch: (profile, scope) => epochs.get(profile, scope),
    // The engines' login PATH, the one value `engineCommand` gives them: cleaned per scope, a bare interpreter, npx or
    // uvx found first inside a root is refused (E2).
    loginPath: () => engineSearchPath(commandDeps),
    // Read on each use: a harness update changes them.
    get harness() {
      return { permissions: harness.permissions, actions: harness.actions, mcp: harness.mcp };
    },
  });
  return engineHost;
}

/**
 * Decision 13: at start, the engine config snapshots no scope approves and no live task is pinned to, in this base or
 * any other profile's, go to the Trash once older than 30 days. Called only under `enginePresets` (D0).
 */
async function pruneEngineConfig(): Promise<void> {
  try {
    const c = await validConfig();
    if (!c) return;
    const bases = [baseOf(c)];
    if (profilesCtl) {
      for (const p of (await profilesCtl.state()).list) {
        const b = baseFor({ folder: c.folder, profile: p.id }, true);
        if (b !== null && !bases.includes(b)) bases.push(b);
      }
    }
    const known: PruneBase[] = bases.map((base) => ({ base, scopes: scopeStoreFor(base) }));
    await pruneEngineSnapshots(app.getPath("userData"), known, new Date(), (d) => shell.trashItem(d));
  } catch (err) {
    console.error("Could not prune the engine config snapshots", err);
  }
}

/**
 * The linked-folder parts, made on first use once the channels' deps exist: only a harness that declares
 * `linkedFolders` registers them (D0: null, and nothing of it runs). The IPC and the turns share one signing (one
 * writer of the live set).
 */
function linked_(): typeof linkedParts {
  if (linkedParts || !linkedDeps) return linkedParts;
  const deps = linkedDeps;
  const instructions = new LinkedInstructions({
    whenNoTask: (fn) => tasks.whenNoTask(fn),
    // Peek, never get (as the settings'). Board mode lists no folders in AGENTS.md (Decision 6): nothing to write.
    refresh: async () => {
      if (host) return false;
      const rt = await runtime.peek()?.catch(() => null);
      if (!rt) return false;
      // A turn refused it (a task's that started meanwhile, or in `single` mode a job's on the same workspace): kept
      // stale for the next gap, never taken as written.
      return refreshUnlessBusy(() => rt.refreshInstructions(), () => turns.isBusy() || !!singleParts.get(rt)?.workspace.anyRunning());
    },
    openScope: () => tasks.currentScope(),
  });
  linkedParts = { access: createScopeAccess(deps), instructions };
  return linkedParts;
}

/** The runtime's linked-folder options (hatches): none without linked folders (D0). */
function linkedRuntimeOptions(): Pick<RuntimeOptions, "instructionLinked" | "linkedGitdir"> & { onLinkedUnsupported?: () => void } {
  const linked = linked_();
  if (!linked) return {};
  const userData = app.getPath("userData");
  return {
    // Only a turn's checked access names a folder here (scope-access.ts): its history continues, never pruned.
    linkedGitdir: async (real: string) => {
      const dir = linkedHistoryDir(userData, real);
      await markRelinked(dir);
      return dir;
    },
    onLinkedUnsupported: () => {
      linkedUnsupported = true;
    },
    // The open scope's folders (plain and single mode); board mode lists none (Decision 6). A failure lists none.
    instructionLinked: async () => {
      if (host) return [];
      try {
        const scope = await tasks.currentScope();
        const lines = await linked.access.lines(scope);
        linked.instructions.read(scope);
        return lines;
      } catch (err) {
        console.error("Could not read the open scope's folders for AGENTS.md", err);
        return [];
      }
    },
  };
}

/** Registers an IPC handler that only answers the app's own page; only table channels (replaceable parts §5.3). */
function handle(channel: InvokeChannel, fn: (...args: never[]) => unknown) {
  handleFrom(channel, (_sender, ...args) => fn(...(args as never[])));
}

/** `handle`, also told which window asked (whatever is kept per window, such as the reader's watches). */
function handleFrom(channel: InvokeChannel, fn: (sender: WebContents, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame || !appUrl(event.senderFrame.url)) throw new Error("Unexpected sender");
    return fn(event.sender, ...args);
  });
}

/** `handle` for a module's handler map; a key outside the table fails to compile. */
function handleAll<K extends InvokeChannel>(handlers: Record<K, (...args: never[]) => unknown>) {
  for (const channel of Object.keys(handlers) as K[]) handle(channel, handlers[channel]);
}

const {
  hold,
  restores,
  restoreWith,
  afterRestore,
  switches,
  turnBlocked,
  dataWrites,
  personData,
  harnessUiData,
  reviews,
  fileTimelines,
  contextSvc,
  searchSvc,
  sendContext,
  commitAnnouncements,
  announceCommits,
} = createAppServices({
  harness: () => harness,
  config: () => config,
  here,
  guards,
  quitting: () => quitting,
  moving: () => moving,
  window: () => window,
  tasks: () => tasks,
  jobsHost: () => jobsHost,
  profilesCtl: () => profilesCtl,
  settingsCtl: () => settingsCtl,
  pluginsCtl: () => pluginsCtl,
  engineIpc: () => engineIpc,
  validConfig,
  baseOf,
  scoped,
  activeScope,
  dataStoreFor,
  modStores: appMods.modStores,
  scopeStoreFor,
  scopesView,
  currentHistory,
  currentBase,
  ownCommits,
  closeRuntime,
  arrivedInProfile,
  workReferences,
  sendToWindow,
});

/** The app window (window.ts), with what it reads from here. */
const createWindow = () =>
  createAppWindow({
    get harness() {
      return harness;
    },
    get config() {
      return config;
    },
    hooks,
    here,
    paper: PAPER,
    get window() {
      return window;
    },
    set window(w) {
      window = w;
    },
    get modHost() {
      return appMods.state.modHost;
    },
    get pluginsCtl() {
      return pluginsCtl;
    },
    pluginPanels,
    documentSessions,
    devUrl,
    rendererFile,
    appUrl,
    sendToWindow,
    pluginLog,
    applyTextSize,
    safeMode,
  });

// Each harness is its own app: keep its config, history and caches apart from other harnesses.
// Set before "ready" (ESM top-level await delays it) so Chromium uses the same folder.
const loaded = await loadHarness(path.join(here, "harness.js"), { root: harnessDir }).catch((err: unknown) => {
  // showErrorBox is safe before "ready".
  dialog.showErrorBox("This app could not start", err instanceof Error ? err.message : String(err));
  app.exit(1);
  return null;
});

/** What the start-up blocks (app-lifecycle.ts) read and set here. Getters and setters for what changes later. */
const lifecycle = {
  get backend() {
    return backend;
  },
  set backend(v) {
    backend = v;
  },
  get engineEpochs() {
    return engineEpochs;
  },
  set engineEpochs(v) {
    engineEpochs = v;
  },
  get engineIpc() {
    return engineIpc;
  },
  set engineIpc(v) {
    engineIpc = v;
  },
  get historyHeld() {
    return historyHeld;
  },
  set historyHeld(v) {
    historyHeld = v;
  },
  get lastAppState() {
    return lastAppState;
  },
  get linkedDeps() {
    return linkedDeps;
  },
  set linkedDeps(v) {
    linkedDeps = v;
  },
  get linkedUnsupported() {
    return linkedUnsupported;
  },
  get config() {
    return config;
  },
  set config(v) {
    config = v;
  },
  get control() {
    return control;
  },
  set control(v) {
    control = v;
  },
  get harness() {
    return harness;
  },
  get homeHistory() {
    return appMods.state.homeHistory;
  },
  get host() {
    return host;
  },
  set host(v) {
    host = v;
  },
  get jobBadge() {
    return jobBadge;
  },
  get jobSettings() {
    return jobSettings;
  },
  set jobSettings(v) {
    jobSettings = v;
  },
  get jobsHost() {
    return jobsHost;
  },
  set jobsHost(v) {
    jobsHost = v;
  },
  get layoutsWatch() {
    return appMods.state.layoutsWatch;
  },
  set layoutsWatch(v) {
    appMods.state.layoutsWatch = v;
  },
  get materialJobs() {
    return materialJobs;
  },
  set materialJobs(v) {
    materialJobs = v;
  },
  get materialSvc() {
    return materialSvc;
  },
  set materialSvc(v) {
    materialSvc = v;
  },
  get modHost() {
    return appMods.state.modHost;
  },
  get moving() {
    return moving;
  },
  set moving(v) {
    moving = v;
  },
  get pluginBadge() {
    return pluginBadge;
  },
  set pluginBadge(v) {
    pluginBadge = v;
  },
  get pluginHost() {
    return pluginHost;
  },
  set pluginHost(v) {
    pluginHost = v;
  },
  get pluginStateRoot() {
    return pluginStateRoot;
  },
  set pluginStateRoot(v) {
    pluginStateRoot = v;
  },
  get pluginsCtl() {
    return pluginsCtl;
  },
  set pluginsCtl(v) {
    pluginsCtl = v;
  },
  get pluginsOn() {
    return pluginsOn;
  },
  set pluginsOn(v) {
    pluginsOn = v;
  },
  get profilesCtl() {
    return profilesCtl;
  },
  set profilesCtl(v) {
    profilesCtl = v;
  },
  get quitting() {
    return quitting;
  },
  set quitting(v) {
    quitting = v;
  },
  get references() {
    return references;
  },
  set references(v) {
    references = v;
  },
  get settingsCtl() {
    return settingsCtl;
  },
  set settingsCtl(v) {
    settingsCtl = v;
  },
  get setupCtl() {
    return setupCtl;
  },
  set setupCtl(v) {
    setupCtl = v;
  },
  get setupRun() {
    return setupRun;
  },
  set setupRun(v) {
    setupRun = v;
  },
  get shared() {
    return shared;
  },
  set shared(v) {
    shared = v;
  },
  get sharedAttention() {
    return sharedAttention;
  },
  set sharedAttention(v) {
    sharedAttention = v;
  },
  get single() {
    return single;
  },
  set single(v) {
    single = v;
  },
  get taskAttention() {
    return taskAttention;
  },
  set taskAttention(v) {
    taskAttention = v;
  },
  get tasks() {
    return tasks;
  },
  set tasks(v) {
    tasks = v;
  },
  get toolsHost() {
    return toolsHost;
  },
  set toolsHost(v) {
    toolsHost = v;
  },
  get translation() {
    return translation;
  },
  set translation(v) {
    translation = v;
  },
  get userLayerWatch() {
    return appMods.state.userLayerWatch;
  },
  set userLayerWatch(v) {
    appMods.state.userLayerWatch = v;
  },
  get window() {
    return window;
  },
  harnessDir,
  PAPER,
  QUIT_TEST_WAIT_MS,
  activeScope,
  announceCommits,
  backendReady,
  baseOf,
  boardHost,
  checkTurn,
  closeRuntime,
  commandDeps,
  connections,
  createWindow,
  currentBase,
  currentHistory,
  dataStoreFor,
  dataWrites,
  dropRuntime,
  emit,
  flushTurns,
  guards,
  handle,
  hasNotice,
  here,
  hold,
  hooks,
  interruptTasks,
  jobsReady,
  jobsWiring,
  kickMaterial,
  materialStageDeps,
  modsView,
  notifications,
  offered,
  ownCommits,
  personData,
  pickProfile,
  plainTasks,
  pluginLog,
  pluginPanels,
  prepareEngine,
  readPhaseBrief,
  refreshDockBadge,
  registerIpc: (): void => registerAppIpc(lifecycle),
  restores,
  runtime,
  runtimeOptions,
  safeMode,
  scopeStoreFor,
  scoped,
  scopesChanged,
  searchSvc,
  secretStore,
  sendToWindow,
  setDockBadge,
  settleScopes,
  shellResources,
  showNotice,
  singleMainSlot,
  singleParts,
  startHomeHistory,
  startModHost,
  switches,
  taskDeps,
  taskStoreOptions,
  toolsLog,
  translateEngine: engineChange.translateEngine,
  turnBlocked,
  turnChatLog,
  turnDeps,
  turns,
  validConfig,
  watchUserLayouts,
  watchUserMods,
  workReferences,
  afterRestore,
  appMods,
  appState,
  applyAppearance,
  applyTextSize,
  backendRebase,
  confirmGoBack: engineChange.confirmGoBack,
  contextSvc,
  documentRoots,
  documentSessions,
  dropDataStoresUnder,
  engineFor,
  engineHost_,
  fileTimelines,
  handleAll,
  handleFrom,
  harnessUiData,
  jobsChanged,
  linkedHistoriesOf,
  linked_,
  openHistory,
  openLinked,
  profilesOn,
  pruneEngineConfig,
  rebasePlugins,
  refreshJobBadge,
  restoreWith,
  reviews,
  saveConfigPatch: engineChange.saveConfigPatch,
  scopeStore,
  scopesSettled,
  scopesView,
  standaloneHistory,
  undoByPaths,
  validation,
};
export type LifecycleDeps = typeof lifecycle;

if (loaded) {
  harness = loaded;
  await onLoaded(lifecycle);
}

// One app per data folder (the lock is tied to userData, so it is taken after it is set): a second one would
// share the config, and its start-up recovery could undo a folder move the first one is making.
const primary = loaded !== null && app.requestSingleInstanceLock();
if (loaded && !primary) app.quit();

if (primary) onPrimary(lifecycle);
