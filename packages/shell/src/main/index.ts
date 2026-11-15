import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  Notification,
  type WebContents,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  session,
  shell,
  webContents,
} from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, type ModelProfile, type ModelSpec, NOTICE_VERSION, availableEngines, defaultTier, getEngine } from "@humanharness/engines";
import { type SearchDoc, actionDocs, openTaskDoc, pastTaskDocs } from "@humanharness/search";
import { type PickInput, modelPolicy } from "@humanharness/policies";
import {
  type BackendInit,
  DEFAULT_LANGUAGE,
  type LoadedHarness,
  PROFILE_COLLECTION,
  SETTINGS_COLLECTION,
  SIDEKICK_COLLECTION,
  SIDEKICK_PROCESS,
  TIERS,
  type Tier,
  allBlocks,
  choiceOptionSchema,
  dataCollections,
  hasBackend,
  hasEnginePresets,
  hasLinkedFolders,
  hasModes,
  hasPhases,
  hasProfiles,
  hasSecrets,
  loadHarness,
  materialStageKey,
  pluginsAccepted,
  resolveInHarness,
  sidekickCollection,
  stageTier,
} from "@humanharness/harness-sdk";
import { createI18n } from "@humanharness/i18n";
import { type Job, MaterialStore } from "@humanharness/material/light";
import { modJsonSchema } from "@humanharness/mod-sdk";
import {
  type Event,
  type HarnessRuntime,
  type HarnessWorkspace,
  type RuntimeOptions,
  type SessionSlot,
  SidekickSession,
  type SlotRef,
  createRuntime,
  createWorkspace,
  runSystemTask,
} from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type DocumentRead,
  type ChatLoad,
  type ConfiguredApp,
  type FolderPick,
  type ModelsView,
  type ModsConfig,
  type ModsView,
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
} from "@humanharness/protocol";
import type { InvokeChannel, PushChannel } from "@humanharness/protocol/channels";
import {
  APP_SCOPE,
  DataStore,
  History,
  MAIN_SCOPE,
  ScopeStore,
  DEFAULT_PINNED_TOKENS,
  dataDiffOf,
  flushFileIndexes,
  loadReview,
  migrateToScopes,
  notesPrefix,
  profileDir,
  readNotes,
} from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { ChatLog } from "./chat-log";
import { ConfigStore, cleanJobs, historyDir } from "./config";
import { agentDataRequest, dataWriteQueue, harnessUiDataRequests, personDataRequests } from "./data-requests";
import { testPrompt } from "./engine-check";
import { createCommandDeps } from "./command-deps";
import { cliCommand, engineCommand, engineSearchPath } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { copySetupStep, engineOptionExtras, installCommandOf, runsInTerminal, terminalCommand } from "./install-help";
import { detectEngine, hasAcceptedNotice } from "./engine-status";
import { QUESTIONS, cleanModels, engineOffer, offeredEffort, pinnedBudget } from "./models";
import { ContextService } from "./context";
import { runningPlugins, searchData, searchableCollection } from "./search/data-sources";
import { searchHandlers } from "./search/ipc";
import { workerBuild } from "./search/runner";
import { SearchService } from "./search/service";
import { contextHandlers } from "./context-ipc";
import { languageHandlers } from "./language-ipc";
import { chooseModeHandler } from "./mode-ipc";
import { setPhaseHandler, timeBoxOffered } from "./phase-ipc";
import { requireNoticeForChoice, requireNoticeForTurn } from "./notice-policy";
import { reviewHandlers } from "./review-ipc";
import { workerDiff } from "./diff-runner";
import { commitAnnouncer, fileHandlers, openPathIpc } from "./file-ipc";
import { documentIpc } from "./document-ipc";
import { FileTimelineService } from "./file-timeline";
import { CANCELLED, type GoBackAsk, askNatively, goBackHandlers, goBackText } from "./go-back";
import { ReviewService } from "./reviews";
import { archiveChatsOnEngineChange, archiveStaleChat, startNewChatIfEngineChanged } from "./engine-switch";
import { type RunningSetup, runSetupProcess, setupCommand } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import { type SharedEngineRecord, SharedConfigStore, sharedConfigDir } from "./shared-config";
import { shellResourcesDir } from "./shell-resources";
import { EngineUnavailable, TurnController, type TurnDeps, memoise } from "./turn-controller";
import {
  type UsageRecord,
  UsageLog,
  capTokens,
  modRecord,
  profilesUsage,
  summarizeUsage,
  withSpent,
} from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import { DocumentSessions } from "./document-sessions";
import { DocumentWatchers, MAX_EXIST_PATHS, documentsExist, readDocument, readImage } from "./documents";
import { saveWithFolderChange } from "./folder-change";
import { type MoveDeps, guardedMove, moveFolder, precheckMove } from "./move-folder";
import { type ResolvedReference, usableReferences } from "./references";
import { PluginBackendHost } from "./plugin-host";
import { PluginPanelsOnDemand, installPluginPanels, registerPluginsIpc, safeStorageCrypto } from "./plugin-ipc";
import { SecretStore } from "./plugin-secrets";
import { ConnectionsController, connectTests } from "./secrets/connections";
import { testCrypto } from "./secrets/test-crypto";
import { type ToolsHost } from "./tools/tools-host";
import { type BoardHost } from "./board-host";
import { type AttentionStores } from "./attention-stores";
import { type TaskAttention, keepNotification } from "./task-attention";
import { type JobsHost, isJobSlot, coalescedSender, jobsIpc, openSingleRuntime, singleBeforeStart, singleCaps } from "./jobs/jobs-host";
import { type JobsWiringDeps } from "./jobs/jobs-wiring";
import type { Turns } from "./gated-turns";
import type { TurnGate } from "./turn-gate";
import { cleanCaps, engineHold } from "./parallel-config";
import { restoreTaskByPaths } from "./restore-paths";
import { type LinkedIpcDeps, linkedIpcDeps, linkedSecret, registerLinkedIpc } from "./linked-ipc";
import { EngineHost } from "./engine-config/engine-host";
import { type EngineIpc, engineIpcDeps, registerEngineIpc } from "./engine-config/engine-ipc";
import { EPOCHS_FILE, EngineEpochs } from "./engine-config/epochs";
import { type PruneBase, pruneEngineSnapshots } from "./engine-config/prune";
import { BackendGeneration, backendInit, buildBackend, registerBackendIpc, usableLinks } from "./backend/backend-ipc";
import type { BackendSupervisor } from "./backend/backend-supervisor";
import { linkedHistoryDir, markRelinked } from "./linked-history";
import { LinkedInstructions, type ScopeAccess, createScopeAccess, refreshUnlessBusy } from "./scope-access";
import {
  type LinkedHistoryRef,
  linkedHistoriesFor,
  linkedOnlyRows,
  mergeTaskGroups,
  openLinkedHistory,
  restoreLinkedTask,
  restoreTaskWithLinked,
} from "./linked-restore";
import { isGitRepo } from "./linked-folders";
import { instructionSubagentsOption } from "./instruction-subagents";
import { restoreTaskArgs, tasksIpc, undoRefusalOf } from "./tasks-ipc";
import { PluginsController } from "./plugins";
import { respondHandler } from "./respond-ipc";
import { layoutIpc } from "./layout-ipc";
import { setupIpc } from "./setup-ipc";
import { folderIpc } from "./folder-ipc";
import { engineSetupIpc } from "./engine-setup-ipc";
import { chatIpc } from "./chat-ipc";
import { historyIpc } from "./history-ipc";
import { dataIpc } from "./data-ipc";
import { settingsIpc } from "./settings-ipc";
import { scopesIpc } from "./scopes-ipc";
import { profilesIpc } from "./profiles-ipc";
import { SettingsController } from "./settings";
import { SidekickController } from "./sidekick";
import { registerSidekickIpc } from "./sidekick-ipc";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import { type ModsSettings, cleanModsConfig } from "./mods/config";
import { CORE_MODS } from "./mods/core-mods";
import { shownLayout } from "./mods/layout";
import { HomeHistory } from "./mods/home-history";
import { enterSafeMode } from "./mods/safe";
import { ModHost } from "./mods/host";
import { registerModsIpc } from "./mods/mods-ipc";
import { ModBuilds, UserLayer, modBuildRoot, userConsent, userModFolders, userModsDir, watchLayouts, watchUserLayer, writeMainShims } from "./mods/user-layer";
import { type ResolveProblem, type ResolvedMod, resolveMods } from "./mods/resolve";
import { type ServiceDeps, appHome, buildServices, modHistoryIgnores } from "./mods/services";
import { needsHost } from "./mods/wiring";
import { SetupSteps } from "./setup-steps";
import { type TaskDeps, TaskManager } from "./task-manager";
import { createTaskDeps, createTurnDeps } from "./task-deps";
import { createAppState } from "./app-state";
import { createScopeStores } from "./scope-stores";
import { createRuntimeWiring } from "./runtime-wiring";
import { type TranslationService } from "./translation";
import type { MaterialService } from "./material";
import { historyKeep, materialIpc, materialRecommended } from "./material-ipc";
import type { MaterialJobs } from "./material-jobs";
import { type MaterialStageDeps, runMaterialStage } from "./material-stage";
import { personMaterialRequest } from "./material-requests";
import { baseFor, isInsideFolder } from "./profile-base";
import { type ProfileOutcome, Profiles, profileResult } from "./profiles";
import { ProfileSwitch } from "./profile-switch";
import { holds } from "./holds";
import { historyView } from "./history-view";
import { RestoreGuard, lastOpened } from "./restore-guard";
import { TaskStore, emptyTasks } from "./task-store";
import { trafficLightY } from "./text-size";
import { createWindow as createAppWindow } from "./window";
import { onLoaded, onPrimary } from "./app-lifecycle";
import {
  MOCK_MODEL,
  fakeSetupResult,
  isMockEngine,
  mockModels,
  offeredEngines,
  readTestHooks,
  testEngineStatus,
} from "./test-hooks";

declare const __HARNESS_DIR__: string;
declare const __SHELL_RESOURCES__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };

const requireFromHere = createRequire(import.meta.url);
// The build's folder. Not `__dirname`: electron-vite's ESM shim for it is put after the bundle's last
// `import … from` it finds, and a bundled JSDoc example (isomorphic-git's walkers) once fooled it into a comment.
const here = import.meta.dirname;
/** The plugin and tool hosts' files and the Dock icon: the build's packages/shell/resources, or the packaged app's. */
const shellResources = shellResourcesDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, built: __SHELL_RESOURCES__ });
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
/** The backend was started in this process (Decision 5): from then on a base change is a rebase. */
let backendStarted = false;
/** Bumped when the backend's base changes: a scopes update read before it is stale and dropped. */
const backendGen = new BackendGeneration();
/** The install, update, login or logout process running now, if any. */
let setupRun: RunningSetup | null = null;
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
/** Sidekick, the core's prompt coach: built only for a harness that declares `sidekick`. */
let sidekickCtl: SidekickController | null = null;
/** The mod host (minimal-core spec §4); null with no mod that could run (D0). */
let modHost: ModHost | null = null;
/** Folders `resolveMods` couldn't read as mods, for Settings › Mods (the user layer keeps its own). */
let modProblems: ResolveProblem[] = [];
/** The home folder's `mods/` as the host runs them (minimal-core 0b2); null without a host. */
let userLayer: UserLayer | null = null;
/** The watcher on the home folder's `mods/`; closed on quit. */
let userLayerWatch: { close(): void } | null = null;
/** The watch on the home folder's `layouts/` and `settings.json` (0b2). */
let layoutsWatch: { close(): void } | null = null;
/** The home folder's own history (0b2): every change to `mods/`, `layouts/` and `settings.json`, undoable. */
let homeHistory: HomeHistory | null = null;
/** Safe mode was entered this run (the escape hatch, `--safe` or HH_SAFE=1): the window shows its notice. */
let safeEntered = false;
/** The control channel `humanharness status` and `shot` use (0b2); started after the window, stopped on quit. */
let control: { stop(): Promise<void> } | null = null;
/** The last resolved mods: their data folders stay out of the work-folder history unless a mod asks (spec §4.1). */
let resolvedMods: ResolvedMod[] = [];
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
      // Material spec §8: each AI stage is a process, only with material (D0); links only with items.
      ...(harness.material ? materialRecommended(harness.material) : {}),
      // Sidekick is a process of its own (sidekick spec §5), light by default.
      [SIDEKICK_PROCESS]: "light",
    },
    defaults: Object.fromEntries(
      engines.map((e) => [e.id, Object.fromEntries(TIERS.map((t) => [t, tierSpec(e.id, t)])) as Record<Tier, ModelSpec>]),
    ),
    offered: Object.fromEntries(engines.map((e) => [e.id, offer(e)])),
    pinnedTokens: harness.context?.pinnedTokens ?? DEFAULT_PINNED_TOKENS,
  };
}

/**
 * `p` with an effort its engine offers, so an unsupported one never reaches argv or CODEX_CONFIG. An engine
 * this build doesn't offer leaves `p` as it is (its turn fails on the engine check anyway).
 */
async function supportedEffort(p: ModelProfile, saved?: SharedEngineRecord): Promise<ModelProfile> {
  const engine = offered().find((e) => e.id === p.engine);
  return engine ? offeredEffort(p, engine, saved ?? (await savedOffer(p.engine))) : p;
}

/**
 * The profile `input` runs on, picked by the model policy `policyId` (spec §6; config.json's, cleaned when read).
 * The offer is what the engine was saved offering: a model off its saved list (Codex) falls back before the turn,
 * then the effort is fitted as `supportedEffort` does (none for an engine this build doesn't offer: an empty list
 * fits nothing).
 */
async function pickProfile(policyId: string | undefined, input: Omit<PickInput, "offer">): Promise<ModelProfile> {
  const saved = await savedOffer(input.engine);
  const engine = offered().find((e) => e.id === input.engine);
  return modelPolicy(policyId).pick({ ...input, offer: { models: saved.models ?? [], efforts: engine ? engineOffer(engine, saved).efforts : [] } });
}

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

/** The per-base scope, data and Sidekick stores, and the scopes' migration and view (scope-stores.ts). */
const {
  activeScope,
  scopeStoreFor,
  dataStoreFor,
  sidekickStoreFor,
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
  sidekickCtl: () => sidekickCtl,
  materialSvc: () => materialSvc,
  tasks: () => tasks,
  linked_,
  documentSessions,
  jobsChanged,
  jobsReady,
  kickMaterial,
  interruptTasks: () => interruptTasks(),
  rebasePlugins,
  backendScopes,
  backendLeaveBase,
  backendRebase,
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
    resolvedMods: () => resolvedMods,
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

/** What Settings › Mods shows: every resolved mod (none without a host, D0) and the folders that couldn't be read. */
const modsView = async (): Promise<ModsView> => ({ mods: modHost?.view() ?? [], problems: [...modProblems, ...(userLayer?.problems() ?? [])] });

/** A mod's own tool-less engine turn (minimal-core spec §5), on SidekickSession like Sidekick's; usage tagged `mod:<id>`. */
const modEngineRun: ServiceDeps["engineRun"] = async ({ process: proc, tier, prompt, workDir, signal }) => {
  const c = await validConfig();
  if (!c) return { ok: false, text: "", error: "not set up" };
  if (!(await hasNotice(c.engineId))) return { ok: false, text: "", error: "the engine notice is not accepted" };
  const engine = getEngine(c.engineId);
  const cmd = hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }).catch(() => null));
  if (!cmd) return { ok: false, text: "", error: "the engine isn't installed" };
  const saved = await config.load();
  const profile = await pickProfile(saved.policies?.model, { engine: engine.id, tier, models: cleanModels(saved.models) });
  await fs.mkdir(workDir, { recursive: true });
  const session = new SidekickSession({ engine, command: cmd.command, env: cmd.env, folder: workDir, profile });
  try {
    const a = await session.ask(prompt, signal ?? new AbortController().signal);
    if (a.usage) {
      const record = modRecord({ engine: engine.id, process: proc as `mod:${string}`, profile, ok: a.ok, usage: a.usage, ...(a.limits ? { limits: a.limits } : {}) });
      await new UsageLog(baseOf(c)).append(record).catch((err: unknown) => console.error("Could not record the mod's turn", err));
    }
    return a.ok ? { ok: true, text: a.text } : { ok: false, text: "", error: a.error ? (a.error.detail ?? a.error.code) : "failed" };
  } finally {
    await session.close();
  }
};

/** Reads the mods again and builds the host when some mod could run (D0); without one, `modHost` stays null. */
async function startModHost(): Promise<void> {
  const modsConfig = (await config.load()).mods;
  const local = modsConfig?.local ?? [];
  const userData = app.getPath("userData");
  const home = appHome(userData, harness.id);
  const user = await userModFolders(home);
  if (!needsHost({ declared: harness.mods, local: [...local, ...user], coreIds: Object.keys(CORE_MODS) })) {
    resolvedMods = [];
    modProblems = [];
    userLayer = null;
    return;
  }
  const resolved = await resolveMods({ declared: harness.mods, harnessModsDir: path.join(harness.root, "mods"), local, user, core: CORE_MODS });
  for (const p of resolved.problems) console.error(`Mod ${p.id}: ${p.reason}`);
  resolvedMods = resolved.mods;
  // The user layer's folders that couldn't be read are its own (they come and go with the watcher).
  modProblems = resolved.problems.filter((p) => path.dirname(p.id) !== userModsDir(home));
  // A user-layer mod's main imports the app's own zod and mod-sdk, through small files beside its builds.
  const buildRoot = modBuildRoot(userData, harness.id);
  const resolveShared = await writeMainShims(path.join(buildRoot, ".shared"), MAIN_SHARED_MODULES);
  const runningTask = async () => {
    const t = await tasks.runningTask();
    return t ? { id: t.id, scope: t.scope, ...(t.action ? { action: t.action } : {}) } : null;
  };
  const mods = new ModHost({
    config: {
      load: async () => (await config.load()).mods,
      saveFailed: (id, reason) => saveMods((m) => ({ ...m, failed: { ...m?.failed, [id]: reason } })),
    },
    services: buildServices({
      harnessId: harness.id,
      userData: app.getPath("userData"),
      base: async () => {
        const c = await validConfig();
        return c ? baseOf(c) : null;
      },
      engineRun: modEngineRun,
      runningTask,
      noteTitles: async (scope) => {
        const c = await validConfig();
        return c ? (await readNotes(baseOf(c), notesPrefix(scoped(), scope ?? MAIN_SCOPE)).catch(() => [])).map((n) => n.title) : [];
      },
      notify: showNotice,
    }),
    notice: showNotice,
    changed: () => void modsView().then((v) => sendToWindow("hh:modsChanged", v)),
    // A user-layer mod rebuilt after an edit: the window imports its ui again (hh:modReloaded, 0b2).
    reloaded: (id, version) => sendToWindow("hh:modReloaded", { id, version }),
    builds: new ModBuilds(buildRoot, resolveShared),
  });
  modHost = mods;
  userLayer = new UserLayer({ home, host: mods, mods: resolved.mods, problems: resolved.problems, changed: () => void modsView().then((v) => sendToWindow("hh:modsChanged", v)) });
  await mods.start(resolved.mods);
}

/** Watches the home folder's `mods/` once: a change syncs the folder with whatever host runs now. */
function watchUserMods(): void {
  if (userLayerWatch) return;
  userLayerWatch = watchUserLayer(appHome(app.getPath("userData"), harness.id), (dir) => void userLayer?.sync(dir));
}

/** Watches the home folder's layouts and pick once: a change sends the layout to show now (hh:layoutChanged, 0b2). */
function watchUserLayouts(): void {
  if (layoutsWatch) return;
  const home = appHome(app.getPath("userData"), harness.id);
  layoutsWatch = watchLayouts(home, () => {
    void shownLayout(home)
      .then((v) => sendToWindow("hh:layoutChanged", v))
      .catch((err: unknown) => console.error("Could not read the layout again", err));
  });
}

/**
 * Safe mode (0b2): the layout pick goes and every local mod (the home folder's and the added folders) is set off; with
 * a running host, it restarts. The window gets the layout and shows the notice. At start it runs before the host.
 */
async function safeMode(running: boolean): Promise<void> {
  const home = appHome(app.getPath("userData"), harness.id);
  const { layout } = await enterSafeMode({
    home,
    folders: [...((await config.load()).mods?.local ?? []), ...(await userModFolders(home))],
    mods: { load: async () => (await config.load()).mods as ModsSettings | undefined, save: async (m) => void (await config.save({ mods: cleanModsConfig(m) })) },
  });
  safeEntered = true;
  if (running) await restartModHost();
  sendToWindow("hh:layoutChanged", layout);
  sendToWindow("hh:safeModeEntered", true);
}

/** The home folder's history (0b2): made once, then every quiet change is committed; Settings › Mods hears each. */
async function startHomeHistory(): Promise<void> {
  const userData = app.getPath("userData");
  const home = appHome(userData, harness.id);
  const h = new HomeHistory(home, historyDir(userData, home));
  await h.init();
  h.onChange((c) => sendToWindow("hh:homeHistoryChanged", c));
  h.watch();
  homeHistory = h;
}

/** Stops the host and builds it again from config.json (a local mod added or removed). */
async function restartModHost(): Promise<void> {
  const old = modHost;
  modHost = null;
  await old?.stop().catch((err: unknown) => console.error("Could not stop the mods", err));
  await startModHost();
  sendToWindow("hh:modsChanged", await modsView());
}

/** Changes config.json's `mods` (cleaned, so an empty one goes away). */
async function saveMods(fn: (m: ModsConfig | undefined) => ModsConfig | undefined): Promise<void> {
  await config.save({ mods: cleanModsConfig(fn((await config.load()).mods)) });
}

/**
 * An id a local folder can't take: a resolved mod's, or one the manifest declares or the core ships even when it
 * couldn't be read (its `on` switch is that mod's).
 */
const modIdTaken = (id: string): boolean =>
  resolvedMods.some((m) => m.json.id === id) || Object.hasOwn(harness.mods ?? {}, id) || Object.hasOwn(CORE_MODS, id) || (modHost?.has(id) ?? false);

/** The id in a folder's mod.json, or null when it has none. */
async function modIdIn(folder: string): Promise<string | null> {
  try {
    return modJsonSchema.parse(JSON.parse(await fs.readFile(path.join(folder, "mod.json"), "utf8"))).id;
  } catch {
    return null;
  }
}
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

/** A phase's brief text: its `brief` is a file inside the harness folder (the task's phase turn and Sidekick read it). */
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
  modHost: () => modHost,
  pluginsCtl: () => pluginsCtl,
  settingsCtl: () => settingsCtl,
  sidekickCtl: () => sidekickCtl,
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
  sendContext,
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

/** How long an engine check is reused: the language state is read on every push, and a run pushes every turn. */
const ENGINE_CHECK_MS = 30_000;

/** Language on demand (plan 5b); built once the harness is loaded. Nothing is written until a run saves (D0). */
let translation: TranslationService | null = null;
let engineCheck: { id: string; at: number; ready: Promise<boolean> } | null = null;

/**
 * Asks before a go-back, with a native dialog on the window that asked (go-back.ts). The words are the core's, in the
 * person's language: the cached translation when there is one, else English. Any failure to ask is a no.
 */
async function confirmGoBack(sender: WebContents, ask: GoBackAsk): Promise<boolean> {
  try {
    const language = (await config.load()).language ?? DEFAULT_LANGUAGE;
    const generated = translation ? await translation.strings(language, {}).catch(() => ({})) : {};
    const i18n = await createI18n(language, {}, generated);
    const t = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
    const text = goBackText(t, ask, harness.actions, i18n.resolvedLanguage ?? "en");
    return await askNatively(dialog, BrowserWindow.fromWebContents(sender), text);
  } catch (err) {
    console.error("Could not ask before going back", err);
    return false;
  }
}

/**
 * Whether the engine could run a translation now: installed, not outdated, not signed out (the runtime's own start
 * checks). A fake engine (tests, mock mode) always can. Reused for ENGINE_CHECK_MS unless `fresh`.
 */
function engineReady(engine: EngineDef, fresh = false): Promise<boolean> {
  if (hooks.engines?.[engine.id]) return Promise.resolve(true);
  const now = Date.now();
  if (!fresh && engineCheck?.id === engine.id && now - engineCheck.at < ENGINE_CHECK_MS) return engineCheck.ready;
  const ready = detectEngine(engine, commandDeps, shared).then(
    (s) => s.installed && !s.outdated && s.loggedIn !== false,
    () => false,
  );
  engineCheck = { id: engine.id, at: now, ready };
  return ready;
}

/**
 * The set-up engine when a run could use it (the app is set up, its notice accepted), else null. It reads the
 * saved config, not validConfig(): with profiles and no active profile there is no base, but the engine is ready.
 */
async function translateEngine(fresh = false): Promise<EngineDef | null> {
  const c = await config.load();
  if (!isConfigured(c) || !(await hasNotice(c.engineId))) return null;
  const engine = getEngine(c.engineId);
  return (await engineReady(engine, fresh)) ? engine : null;
}

/** Saves a config patch; an engine change ends the task, drops the runtime and archives the chat (see EngineGuards). */
async function saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void> {
  if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
    const engineId = patch.engineId;
    // A translation run belongs to the old engine: it stops, what it saved stays (plan Decision 12).
    await translation?.stop().catch((err: unknown) => console.error("Could not stop the translation", err));
    await guards.switchEngine(
      {
        // A profile switch counts too: once its task has closed nothing runs, yet its runtime and profile are pending.
        isBusy: hold.engineBusy,
        idle: async () => {
          await tasks.idle();
          await flushTurns();
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

/**
 * The backend's `init` for the base the app is in now (hatches Decisions 3, 4), its data folder made; null before
 * setup. Each scope's links are the ones a turn there would use (the scope access's checks), none without linked folders.
 */
async function backendInitNow(): Promise<BackendInit | null> {
  await scopesSettled();
  const c = await validConfig();
  if (!c) return null;
  const base = baseOf(c);
  const profile = profilesOn() ? (c.profile ?? "") : "";
  const scopes = scoped() ? await scopeStoreFor(base).list() : [];
  const access = linked_()?.access;
  const init = backendInit({
    base,
    scopes,
    ...(access ? { links: await usableLinks(scopes, (id) => access.entries(id)) } : {}),
    language: c.language,
    coreVersion: app.getVersion(),
    userData: app.getPath("userData"),
    ...(profile ? { profile } : {}),
    mock: hooks.mock === true,
  });
  await fs.mkdir(init.dataDir, { recursive: true });
  return init;
}

/** The backend starts the first time the app is set up in this process (Decision 5); never while quitting. */
async function backendReady(): Promise<void> {
  const b = backend;
  if (!b || quitting || backendStarted) return;
  backendGen.bump();
  // Null when another start, rebase or profile switch began meanwhile: that one's base wins.
  const init = await backendGen.readFresh(backendInitNow);
  if (!init || quitting || backendStarted) return;
  backendStarted = true;
  await b.start(init);
}

/** The base changed (profile switch, another folder, a move's end): a started backend starts again there. */
async function backendRebase(): Promise<void> {
  const b = backend;
  if (!b || quitting) return;
  if (!backendStarted) return backendReady();
  backendGen.bump();
  // Null when a later rebase or profile switch began meanwhile: this base is already stale.
  const init = await backendGen.readFresh(backendInitNow);
  if (init && !quitting) await b.rebase(init);
}

async function backendScopes(): Promise<void> {
  const b = backend;
  if (!b || !backendStarted || quitting) return;
  // Null when a rebase began meanwhile: its own init is newer than these scopes.
  const init = await backendGen.readFresh(backendInitNow);
  // The supervisor drops scopes of another folder (Settings changed it; the rebase comes after).
  if (init) b.scopesChanged(init.scopes, init.folder);
}

/** A profile switch begins: a started backend stops before anything reads the new base (backendRebase starts it). */
async function backendLeaveBase(): Promise<void> {
  backendGen.bump();
  if (backend && backendStarted) await backend.stop().catch((err: unknown) => console.error("Could not stop the backend", err));
}

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
const restores = new RestoreGuard({ quitting: () => quitting, busy: () => tasks.isBusy() || (jobsHost?.running() ?? false), turnBlocked: hold.restoreHeld });
const restoreWith = (run: (history: History) => Promise<unknown>) => restores.run(currentHistory, run);
/** A restore changes tracked files with no data event: the settings and Sidekick's settings may have changed. */
function afterRestore(): void {
  void settingsCtl?.changed();
  void sidekickCtl?.refresh().catch((err: unknown) => console.error("Could not refresh Sidekick", err));
  // A restore reconciles the whole folder (search spec §4.2); a no-op until search was first opened (D0).
  searchSvc.committed(null);
}

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

/** The person's data writes and the tools' (tools spec §8.3) in one order: no commit holds the other's write. */
const dataWrites = dataWriteQueue();
/** The harness UI's data requests (hh:data): one handler, so the person's writes and their commits run one at a time. */
const personData = personDataRequests({
  serial: dataWrites,
  store: async () => {
    const c = await validConfig();
    return c ? dataStoreFor(baseOf(c)) : null;
  },
  chatScope: () => tasks.chatScope(),
  trailer: () => tasks.trailerNow(),
  history: () => currentHistory(),
  // Board mode, or a job running beside the single task: a write commits only its collection's file (parallel spec §5.3).
  board: ownCommits,
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  // Without scopes the only scope is the implicit `main` (D2); with them, the registry's open (not archived) scopes.
  scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
  // The reserved `sidekick` collection lives in its own store (sidekick spec §6.4); every other collection as before.
  storeFor: (collection) =>
    collection === SIDEKICK_COLLECTION ? validConfig().then((c) => (c ? sidekickStoreFor(baseOf(c)) : null)) : undefined,
});
/** The same handler for the harness UI, which only reads `settings` (it changes them through `client.settings`). */
const harnessUiData = harnessUiDataRequests(personData, () => harness.settings !== undefined);

/** Document reviews (review spec): the person's side, and the agent's tools for each runtime's folder (one set of locks). */
const reviews = new ReviewService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  history: () => currentHistory(),
  trailer: () => tasks.trailerNow(),
  openTask: async () => {
    const t = await tasks.runningTask();
    return t ? { id: t.id, scope: t.scope } : null;
  },
  busy: () => tasks.isBusy(),
  whenSettled: (write) => tasks.whenSettled(write),
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  // The canonical path and the record's scope; rejects with `RoundNotStarted` when no turn started.
  round: (r) => tasks.reviewRound(r),
  approved: (a) => void tasks.documentApproved(a).catch((err: unknown) => console.error("Could not act on the approval", err)),
  reviewTier: (kind) => {
    const kinds = harness.documents?.kinds;
    return (kind !== undefined && kinds && Object.hasOwn(kinds, kind) ? kinds[kind].reviewTier : undefined) ?? "standard";
  },
  changed: (p) => sendToWindow("hh:reviewChanged", p),
});

/** File timelines (file-timeline spec): read from the history; a one-file go-back goes through the restore guard. */
const fileTimelines = new FileTimelineService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  history: () => currentHistory(),
  actionLabel: (id) => (id === null ? "A question" : Object.hasOwn(harness.actions, id) ? harness.actions[id].label : id),
  approvals: async (base, doc) => (await loadReview(base, doc).catch(() => null))?.approvals ?? [],
  busy: () => quitting || tasks.isBusy() || turnBlocked() !== null,
  restore: (run) => restoreWith(run),
  restored: () => afterRestore(),
  // Diffs run in a worker thread of their own: jsdiff's budget and the Markdown parse never block Electron main.
  diff: workerDiff({ entry: path.join(here, "diff-worker.js") }),
});

/** The context panel (context-panel spec): the person's pins and exclusions and the open task's record. */
const contextSvc = new ContextService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  scoped,
  scopeExists: (id) => activeScope(id),
  budget: async () => pinnedBudget(cleanModels((await config.load()).models), harness.context),
  record: (id) => tasks.contextRecord(id),
  openTask: async () => (await tasks.runningTask())?.id ?? null,
  noteTitles: async (scope) => {
    const c = await validConfig();
    if (!c) return new Map<string, string>();
    const notes = await readNotes(baseOf(c), notesPrefix(scoped(), scope)).catch(() => []);
    return new Map(notes.map((n) => [n.path, n.title]));
  },
  history: () => currentHistory(),
  trailer: () => tasks.trailerNow(),
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  add: (taskId, file) => {
    const { accepted, done } = tasks.addContext(taskId, file);
    // Closing ends the operation before it runs: not a failure worth a log line.
    done.catch((err: unknown) => {
      if (!quitting) console.error("The Add now turn failed", err);
    });
    return accepted;
  },
  pickFile: async (base) => {
    if (!window || window.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(window, { defaultPath: base, properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  changed: (task) => void sendContext(task),
});

/** What search finds among the tasks, built when the palette opens (search spec §4.2): actions, the open task, past tasks. */
async function searchMemory(): Promise<SearchDoc[]> {
  const scopeOf = (s: string | undefined) => (scoped() ? (s ?? APP_SCOPE) : MAIN_SCOPE);
  const view = await tasks.view();
  const actions = actionDocs(
    Object.entries(harness.actions).map(([id, a]) => ({
      id,
      label: a.label,
      ...(a.description ? { description: a.description } : {}),
      ...(a.tier ? { tier: a.tier } : {}),
      ...(view.actions[id] ? { status: view.actions[id] } : {}),
      scope: scopeOf(undefined),
    })),
  );
  const current = view.current;
  const label = (id: string | null | undefined) => (id && Object.hasOwn(harness.actions, id) ? harness.actions[id].label : undefined);
  const open = current && label(current.action) ? [openTaskDoc({ id: current.id, title: label(current.action)!, scope: scopeOf(current.scope), at: 0 })] : [];
  const history = await currentHistory();
  const rows = history ? historyView(await history.tasks()) : [];
  const past = pastTaskDocs(
    rows.flatMap((r) => {
      const title = r.noteTitle ?? label(r.actionId);
      return r.taskId && r.taskId !== current?.id && title ? [{ id: r.taskId, title, scope: scopeOf(r.scopeId), at: Date.parse(r.date) || 0 }] : [];
    }),
  );
  return [...actions, ...open, ...past];
}

/** Global search's collections (search spec D4): the harness's, then each running plugin's, of the live index's base only. */
const searchDataDeps = searchData({
  current: () => currentBase(),
  collections: () => dataCollections(harness),
  scoped,
  scopes: async (base) => (await scopeStoreFor(base).list()).filter((s) => !s.archived).map((s) => s.id),
  store: (base) => dataStoreFor(base),
  plugins: () => pluginsCtl ?? null,
});

/** Global search (search spec): nothing is read, written or started until the window first asks (D0, D8). */
const searchSvc = new SearchService({
  userData: () => app.getPath("userData"),
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  scoped,
  openScope: () => tasks.currentScope(),
  scopeTitles: async () => new Map((await scopesView()).list.map((s) => [s.id, s.title])),
  references: async () => {
    const c = await validConfig();
    return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, label: r.label, path: r.path })) : [];
  },
  memory: () => searchMemory(),
  extraDenied: async () => {
    // Same rule as the history's ignore list: the engine's instructions file is the app's, not the person's.
    const c = await validConfig();
    const extra = c ? getEngine(c.engineId).instructionsFile?.path : undefined;
    return extra ? [extra] : [];
  },
  status: (s) => sendToWindow("hh:searchStatus", s),
  runner: workerBuild({ entry: path.join(here, "search-worker.js") }),
  reveal: (file, roots) => revealIfStillSafe(file, roots, (p) => shell.showItemInFolder(p)),
  data: searchDataDeps,
  // A burst of writes (an import, a plugin run) is one refresh.
  dataDelayMs: 500,
});

/** The task's panel refreshes (`hh:context`); a task that is no longer open sends nothing. */
async function sendContext(task: string): Promise<void> {
  const got = await contextSvc.get(task).catch(() => null);
  if (got?.ok) sendToWindow("hh:context", { task, context: got.context });
}

/** Tells the window which paths each commit touched: an open timeline gets its new entry (§6.3 `onChange`). */
const commitAnnouncements = commitAnnouncer((paths) => {
  sendToWindow("hh:fileCommits", paths);
  // A commit that touched a scope's engine folder: its Engine config section reads it again (enginePresets only).
  engineIpc?.committed(paths);
  // Search (D0): a no-op until the palette first opened; then the commit's paths are read again.
  searchSvc.committed(paths);
});
const announceCommits = (history: History) => commitAnnouncements.watch(history);

function registerIpc() {
  handle("hh:getState", () => appState());
  handleAll(
    settingsIpc({
      harness: () => harness,
      config: () => config,
      settingsCtl: () => settingsCtl,
      pluginsCtl: () => pluginsCtl,
      setupCtl: () => setupCtl,
      host: () => host,
      setJobSettings: (jobs) => (jobSettings = jobs),
      validation,
      currentBase,
      hasNotice,
      folderBusy: hold.folderBusy,
      guards,
      interruptTasks,
      dropRuntime,
      saveConfigPatch,
      documentSessions,
      dropDataStoresUnder,
      settleScopes,
      scopesChanged,
      rebasePlugins,
      validConfig,
      jobsReady,
      backendRebase,
      backendReady,
      applyAppearance,
      applyTextSize,
      jobsChanged,
      refreshJobBadge,
      appState,
    }),
  );
  handleAll(
    chatIpc({
      harness: () => harness,
      quitting: () => quitting,
      turnBlocked,
      tasks: () => tasks,
      host: () => host,
      modHost: () => modHost,
      guards,
      engineBusy: hold.engineBusy,
      scopesSettled,
      scopesChanged,
      validConfig,
      baseOf,
      dropRuntime,
    }),
  );
  handle("hh:getTasks", () => tasks.view());
  handleAll(
    scopesIpc({
      quitting: () => quitting,
      turnBlocked,
      tasks: () => tasks,
      scopesView,
      scopesSettled,
      scopeStore,
      scopesChanged,
      linked_,
    }),
  );
  // Linked folders (hatches spec §3.2): only a harness that declares them has these channels, or its key (D0).
  if (hasLinkedFolders(harness)) {
    // Made once: the turns' scope access (linked_) shares these deps, so the prune runs once and one signing writes.
    linkedDeps ??= linkedIpcDeps({
      userData: app.getPath("userData"),
      home: os.homedir(),
      linkedFolders: harness.linkedFolders ?? {},
      store: scopeStore,
      validConfig,
      profilesOn,
      profileIds: () => profilesCtl?.state().then((st) => st.list.map((p) => p.id)) ?? null,
      baseFor: (c) => baseFor(c, true),
      baseOf,
      scopeStoreFor,
      references: async (c, base) => (await workReferences(c, base)).map((r) => r.path),
      pick: async () => {
        if (!window || window.isDestroyed()) return null;
        const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      trash: (d) => shell.trashItem(d),
      scopesChanged,
      linked: linked_,
      unsupported: () => linkedUnsupported,
      currentScope: () => tasks.currentScope(),
      openLinked,
    });
    registerLinkedIpc(handle, linkedDeps);
  }
  // A scope's engine config (hatches spec §5.3): only a harness that declares `enginePresets` has these channels (D0).
  if (hasEnginePresets(harness)) {
    const userData = app.getPath("userData");
    engineIpc = registerEngineIpc(
      handle,
      engineIpcDeps({
        host: engineHost_()!,
        userData,
        validConfig,
        baseOf,
        scopeStoreFor,
        profilesOn,
        epochs: () => (engineEpochs ??= new EngineEpochs(path.join(userData, EPOCHS_FILE))),
        engines: () => harness.engines,
        engineId: async () => (await config.load()).engineId,
        send: sendToWindow,
      }),
    );
  }
  if (hasEnginePresets(harness)) void pruneEngineConfig();
  // The harness's backend (hatches spec §4): only a harness that declares one has a supervisor and these channels (D0).
  if (hasBackend(harness)) {
    backend = buildBackend(harness, { userData: app.getPath("userData"), launcher: electronLauncher(process.execPath), send: sendToWindow });
    if (backend) registerBackendIpc(handle, { supervisor: backend });
  }
  handleAll(dataIpc({ harness: () => harness, scopesSettled, harnessUiData, currentHistory }));
  // Sidekick (sidekick spec §7): malformed requests are refused before the controller; a bad review sends as typed.
  registerSidekickIpc(handle, () => sidekickCtl);
  // The layout the screen shows (minimal-core spec §5.2).
  handle("hh:layout", () => shownLayout(appHome(app.getPath("userData"), harness.id)));
  // The person's pick (0b2): written in the home folder's settings.json; the watcher redraws the window too.
  handle("hh:layoutPick", layoutIpc({ home: () => appHome(app.getPath("userData"), harness.id) })["hh:layoutPick"]);
  // Safe mode entered this run: the window shows its notice.
  handle("hh:safeMode", () => safeEntered);
  // Settings › Mods (minimal-core spec §4, §6): registered with or without a host, so the page always answers (empty).
  registerModsIpc(handle, {
    view: modsView,
    // A mod in the home folder's `mods/`: turned on the first time only through the warning (spec D2, `mods.trusted`).
    ...userConsent({
      config: { load: async () => (await config.load()).mods as ModsSettings | undefined, save: async (m) => void (await config.save({ mods: cleanModsConfig(m) })) },
      host: { set: async (id, on) => modHost?.set(id, on) },
      layer: { dirOf: (id) => userLayer?.dirOf(id) },
    }),
    set: async (id, on) => {
      // Turning a mod on clears its three-strikes failure.
      await saveMods((m) => ({ ...m, on: { ...m?.on, [id]: on }, ...(on && m?.failed ? { failed: Object.fromEntries(Object.entries(m.failed).filter(([k]) => k !== id)) } : {}) }));
      await modHost?.set(id, on);
    },
    pickFolder: async () => {
      if (!window || window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    // The person confirmed the warning: the mod starts on.
    addLocal: async (folder) => {
      // Read again (the folder may have changed since the review); a taken id never reaches config.json.
      const id = await modIdIn(folder);
      if (!id) throw new Error("This folder has no valid mod.json");
      if (modIdTaken(id)) throw new Error(`A mod with the id "${id}" is already in this app`);
      await saveMods((m) => ({
        ...m,
        local: [...new Set([...(m?.local ?? []), folder])],
        on: { ...m?.on, [id]: true },
        failed: Object.fromEntries(Object.entries(m?.failed ?? {}).filter(([k]) => k !== id)),
      }));
      await restartModHost();
    },
    removeLocal: async (id) => {
      const dir = resolvedMods.find((m) => m.json.id === id && m.shipped === "local")?.dir;
      const drop = <T>(r: Record<string, T> | undefined) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => k !== id));
      await saveMods((m) => ({ ...m, local: (m?.local ?? []).filter((f) => f !== dir), on: drop(m?.on), failed: drop(m?.failed) }));
      await restartModHost();
    },
    // A user-layer mod goes by deleting its folder, not from config.json's `local`.
    isLocal: (id) => resolvedMods.some((m) => m.json.id === id && m.shipped === "local" && !m.user),
    taken: modIdTaken,
  });
  // Plugins and the Attention inbox (plugins spec §6, §7): only with the controller (D0: no handler at all).
  // A prepared task starts only here, from the person's Start (P6): nothing but the token comes from the window.
  if (pluginsCtl) {
    registerPluginsIpc(handle, pluginsCtl, {
      startPrepared: (p) => tasks.startPrepared(p),
      // Board mode: a prepared task starts in a lane of its own, whatever another lane runs.
      startBlocked: () => (quitting ? "The app is closing" : (turnBlocked() ?? (!host && tasks.isBusy() ? "A turn is already running" : null))),
      ...(harness.scopes ? { scopes: { label: harness.scopes.label, open: async () => (await tasks.currentScope()) !== null } } : {}),
    });
  }
  handleAll(setupIpc({ setupCtl: () => setupCtl }));
  handleAll(profilesIpc({ profilesCtl: () => profilesCtl, appState, lastAppState: () => lastAppState }));
  // The person's material (material spec §10).
  handleAll(materialIpc({ materialSvc: () => materialSvc, shell }));
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
  handleAll(openPathIpc({ validConfig, baseOf, workReferences, shell }));
  const reader = documentIpc({ documentRoots, documentSessions });
  handle("hh:readDocument", reader["hh:readDocument"]);
  handle("hh:readImage", reader["hh:readImage"]);
  handle("hh:documentsExist", reader["hh:documentsExist"]);
  handleFrom("hh:watchDocument", reader["hh:watchDocument"]);
  handleFrom("hh:unwatchDocument", reader["hh:unwatchDocument"]);
  // Reviews (review spec §5.6): every answer is data; nothing reaches the service unless the agent may edit the folder (D0).
  handleAll(reviewHandlers(reviews, () => harness.permissions.edit === "folder"));
  // File timelines (file-timeline spec §6.3): every harness (Q1); every answer is data.
  handleAll(fileHandlers(fileTimelines));
  handleAll(contextHandlers(contextSvc));
  handleAll(searchHandlers(searchSvc));
  // Language on demand (plan 5b): every answer is data; the state is pushed on hh:language.
  if (translation) handleAll(languageHandlers(translation));
  // Cancels the turn and stops the task operation (a closing turn never goes on to the next task).
  handle("hh:cancel", () => tasks.cancel());
  const history = historyIpc({
    quitting: () => quitting,
    tasksBusy: () => tasks.isBusy(),
    restoreHeld: hold.restoreHeld,
    homeHistory: () => homeHistory,
    linked_,
    currentHistory,
    linkedHistoriesOf,
    confirmGoBack,
    restoreWith,
    afterRestore,
    restores,
    undoByPaths,
    fileTimelines,
  });
  handleFrom("hh:restore", history["hh:restore"]);
  handleFrom("hh:fileRestore", history["hh:fileRestore"]);
  handle("hh:historyTasks", history["hh:historyTasks"]);
  handleFrom("hh:restoreTask", history["hh:restoreTask"]);
  handle("hh:homeHistory", history["hh:homeHistory"]);
  handle("hh:homeUndo", history["hh:homeUndo"]);
  // Board mode's task inbox (parallel spec §9.1). Ids are looked up in the board's lanes (P1); plain mode refuses.
  const inbox = tasksIpc(() => host);
  handle("hh:tasksList", () => inbox.list());
  handle("hh:tasksFocus", (id: unknown) => inbox.focus(id));
  handle("hh:tasksCancelQueued", (id: unknown) => inbox.cancelQueued(id));
  handle("hh:tasksResume", () => inbox.resume());
  // The jobs channels (parallel spec §9.1, J4): a declared manual job in an existing scope; without jobs, refused (D0).
  const jobsChannels = jobsIpc(() => jobsHost);
  handle("hh:jobsList", () => jobsChannels.list());
  handle("hh:jobsRun", (id: unknown, scope: unknown) => jobsChannels.run(id, scope));
  handleAll(
    engineSetupIpc({
      harness: () => harness,
      config: () => config,
      shared: () => shared,
      quitting: () => quitting,
      profilesCtl: () => profilesCtl,
      setupRun: () => setupRun,
      setSetupRun: (run) => (setupRun = run),
      stopTranslation: () => translation?.stop(),
      hooks,
      commandDeps,
      guards,
      engineFor,
      hasNotice,
      engineBusy: hold.engineBusy,
      dropRuntime,
      sendToWindow,
      validConfig,
      baseOf,
      clipboard,
      shell,
    }),
  );
  handleAll(
    folderIpc({
      window: () => window,
      config: () => config,
      quitting: () => quitting,
      profilesCtl: () => profilesCtl,
      pluginsCtl: () => pluginsCtl,
      backend: () => backend,
      host: () => host,
      tasks: () => tasks,
      moving: () => moving,
      setMoving: (run) => (moving = run),
      setHistoryHeld: (held) => (historyHeld = held),
      pluginStateRoot: () => pluginStateRoot,
      userData: () => app.getPath("userData"),
      dialog,
      shell,
      guards,
      folderBusy: hold.folderBusy,
      plainTasks,
      restores,
      documentSessions,
      searchSvc,
      validConfig,
      baseOf,
      standaloneHistory,
      openHistory,
      flushTurns,
      flushFileIndexes,
      closeRuntime,
      pluginLog,
      rebasePlugins,
      backendRebase,
      appState,
      dropDataStoresUnder,
    }),
  );
}

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
      return modHost;
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
const loaded = await loadHarness(path.join(here, "harness.js"), { root: __HARNESS_DIR__ }).catch((err: unknown) => {
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
    return homeHistory;
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
    return layoutsWatch;
  },
  set layoutsWatch(v) {
    layoutsWatch = v;
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
    return modHost;
  },
  get moving() {
    return moving;
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
  get sidekickCtl() {
    return sidekickCtl;
  },
  set sidekickCtl(v) {
    sidekickCtl = v;
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
    return userLayerWatch;
  },
  set userLayerWatch(v) {
    userLayerWatch = v;
  },
  get window() {
    return window;
  },
  harnessDir: __HARNESS_DIR__,
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
  registerIpc,
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
  sidekickStoreFor,
  singleMainSlot,
  singleParts,
  startHomeHistory,
  startModHost,
  switches,
  taskDeps,
  taskStoreOptions,
  toolsLog,
  translateEngine,
  turnBlocked,
  turnChatLog,
  turnDeps,
  turns,
  validConfig,
  watchUserLayouts,
  watchUserMods,
  workReferences,
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
