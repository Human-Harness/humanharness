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
  nativeImage,
  nativeTheme,
  powerMonitor,
  protocol,
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
  type SidekickRecord,
  TIERS,
  type Tier,
  allBlocks,
  choiceOptionSchema,
  dataCollections,
  hasBackend,
  hasEnginePresets,
  hasJobs,
  hasLinkedFolders,
  hasModes,
  hasPhases,
  hasProfiles,
  hasSecrets,
  hasTools,
  languageName,
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
  DATA_CHANGE_PREFIX,
  DataStore,
  History,
  MAIN_SCOPE,
  ScopeStore,
  appendSidekickEvent,
  DEFAULT_PINNED_TOKENS,
  dataDiffOf,
  dataPath,
  dataRequestSchema,
  flushFileIndexes,
  loadReview,
  migrateToScopes,
  notesPrefix,
  noteSlug,
  profileDir,
  readNotes,
  readSidekickEvents,
  runDataRequest,
  sidekickWorkDir,
  tasksFile,
  writeNote,
  writeSidekickBrief,
} from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { devDockIcon } from "./dock-icon";
import { ChatLog } from "./chat-log";
import { ConfigStore, cleanJobs, historyDir } from "./config";
import { agentDataRequest, dataWriteQueue, harnessUiDataRequests, personDataRequests, toolDataRequests } from "./data-requests";
import { testPrompt } from "./engine-check";
import { createCommandDeps } from "./command-deps";
import { cliCommand, engineCommand, engineSearchPath, loginShellPath, resolveBinary } from "./engine-command";
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
import { type RunningSetup, runSetupProcess, setupCommand, stopSetupProcess } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import { type SharedEngineRecord, SharedConfigStore, sharedConfigDir } from "./shared-config";
import { shellResourcesDir } from "./shell-resources";
import { EngineUnavailable, TurnController, type TurnDeps, memoise } from "./turn-controller";
import {
  type UsageRecord,
  UsageLog,
  capTokens,
  dayTokens,
  modRecord,
  profilesUsage,
  recentUsage,
  summarizeUsage,
  withSpent,
} from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import { DocumentSessions } from "./document-sessions";
import { DocumentWatchers, MAX_EXIST_PATHS, documentsExist, readDocument, readImage } from "./documents";
import { saveWithFolderChange } from "./folder-change";
import { type MoveDeps, guardedMove, moveFolder, moveJournal, precheckMove, recoverMove } from "./move-folder";
import { type ResolvedReference, resolveReferences, usableReferences } from "./references";
import { runFile } from "./plugin-exec";
import { PLUGIN_SCHEME, PluginBackendHost } from "./plugin-host";
import { PluginPanelsOnDemand, installPluginPanels, registerPluginsIpc, safeStorageCrypto } from "./plugin-ipc";
import { PluginPointers } from "./plugin-load";
import { SecretStore } from "./plugin-secrets";
import { ConnectionsController, connectTests } from "./secrets/connections";
import { registerConnectionsIpc } from "./secrets/connections-ipc";
import { testCrypto } from "./secrets/test-crypto";
import { isPublicHost } from "./material-fetch";
import { ToolHost } from "./tools/tool-host";
import { TOOL_SCHEME } from "./tools/tool-protocol";
import { type ToolsHost, createToolsHost, slotTaskOf } from "./tools/tools-host";
import { TOOLS_CHANGE_CHANNEL, registerToolsIpc } from "./tools/tools-ipc";
import { PLUGIN_STATE_DIR } from "./plugin-state";
import { type BoardHost, hostMode } from "./board-host";
import { buildBoardHost } from "./board-host-wiring";
import { type AttentionStores, attentionStores } from "./attention-stores";
import { type TaskAttention, buildTaskAttention, keepNotification } from "./task-attention";
import { saveAppChange } from "./app-change";
import { type JobsHost, isJobSlot, jobOriginKnown, coalescedSender, jobsIpc, openSingleRuntime, singleBeforeStart, singleCaps } from "./jobs/jobs-host";
import { type JobsWiringDeps, buildJobsHost, buildSingleJobs } from "./jobs/jobs-wiring";
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
import { PluginsController, watchPluginFolder } from "./plugins";
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
import { SidekickController, localDay } from "./sidekick";
import { sidekickView } from "./sidekick-view";
import { readImportFiles, sourceTagKey } from "./sidekick-import";
import { registerSidekickIpc } from "./sidekick-ipc";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import { type ModsSettings, cleanModsConfig } from "./mods/config";
import { CORE_MODS } from "./mods/core-mods";
import { harnessLayer, writeLayers } from "./mods/home-folder";
import defaultLayoutJson from "./mods/default-layout.json";
import { shownLayout } from "./mods/layout";
import { HomeHistory } from "./mods/home-history";
import { enterSafeMode, safeAtStart } from "./mods/safe";
import { manualFiles } from "./mods/manual";
import { startControl } from "./mods/control";
import { ModHost } from "./mods/host";
import { MOD_SCHEME } from "./mods/mod-scheme";
import { registerModsIpc } from "./mods/mods-ipc";
import { ModBuilds, UserLayer, modBuildRoot, userConsent, userModFolders, userModsDir, watchLayouts, watchUserLayer, writeMainShims } from "./mods/user-layer";
import { type ResolveProblem, type ResolvedMod, resolveMods } from "./mods/resolve";
import { type ServiceDeps, appHome, buildServices, modHistoryIgnores } from "./mods/services";
import { needsHost } from "./mods/wiring";
import { SidekickStore } from "./sidekick-store";
import { SetupSteps, recordSetup } from "./setup-steps";
import { type TaskDeps, TaskManager } from "./task-manager";
import { createTaskDeps, createTurnDeps } from "./task-deps";
import { createAppState } from "./app-state";
import { type TranslationService, buildTranslation } from "./translation";
import type { MaterialService } from "./material";
import { historyKeep, materialIpc, materialRecommended } from "./material-ipc";
import type { MaterialJobs } from "./material-jobs";
import { buildMaterial, buildMaterialJobs } from "./material-wiring";
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
import {
  MOCK_MODEL,
  devEngine,
  fakeSetupResult,
  isMockEngine,
  mockModels,
  mockToolsDir,
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
        // Search (D0): a no-op until the palette first opened; then a searchable collection is read again.
        if (searchableCollection(dataCollections(harness), change.collection)) searchSvc.dataChanged();
        if (change.collection === SETTINGS_COLLECTION) void settingsCtl?.changed();
        // Profiles: the registry copies the record's name and colour (spec §4), whoever wrote it. Never rejects.
        if (change.collection === PROFILE_COLLECTION) void profilesCtl?.sync(path.resolve(base));
      }),
    };
    dataStores.set(base, entry);
  }
  return entry.store;
}

/**
 * Sidekick's own store per base (plan Decision 8): never in dataCollections, so harness rules, the data diff and the
 * harness UI never see it. Its file sits with the others (`.harness/data/_app/`), so undo restores it like any data.
 */
const sidekickStores = new Map<string, DataStore>();
function sidekickStoreFor(base: string): DataStore {
  let s = sidekickStores.get(base);
  if (!s) {
    s = new DataStore(base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
    sidekickStores.set(base, s);
  }
  return s;
}

/** The folder changed or moved: the old base's store goes, with its listener. */
function dropDataStore(base: string): void {
  dataStores.get(base)?.off();
  dataStores.delete(base);
  sidekickStores.delete(base);
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
  // Linked folders reach the window only through their own channel, signed ones only (hatches L1); an engine approval
  // only through the Engine config view (its tag is the app's). D0: no key to drop.
  const list = (await scopeStoreFor(baseOf(c)).list())
    .map(({ linked: _linked, ...s }) => s)
    .map(({ engineApproval: _approval, ...s }) => s);
  return { open: await tasks.currentScope(), list };
}

async function scopesChanged(): Promise<void> {
  // A scope made, archived or brought back: the Jobs section's rows follow (each active scope has its own).
  jobsChanged();
  // A running backend hears the active scopes and their links (hatches spec §4.2). Without one, nothing (D0).
  void backendScopes().catch((err: unknown) => console.error("Could not tell the backend the scopes", err));
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
  // Before anything reads the new base: the old profile's plugins stop, and nothing of theirs reaches the new one.
  await rebasePlugins();
  // The old profile's backend too: stopped now, started in the new one once its scopes are settled (below).
  await backendLeaveBase();
  // Another profile is another folder: the reader's watches were checked against the old one.
  documentSessions.closeAll();
  await interruptTasks();
  settingsCtl?.forget();
  await settingsCtl?.changed();
  // The new profile's open scope and links reach AGENTS.md (hatches). Nothing without linked folders.
  void linked_()?.instructions.changed();
  await settleScopes();
  await scopesChanged();
  if (setupCtl) sendToWindow("hh:setupSteps", await setupCtl.state());
  sendToWindow("hh:tasks", await tasks.view());
  // The new profile's material: what an earlier run (or the switch) left converting resumes, and its AI stages run.
  // Without material, nothing (D0).
  void materialSvc?.settle().catch((err: unknown) => console.error("Could not resume the material", err));
  kickMaterial();
  // The new profile's Sidekick settings; the old base's sessions close.
  void sidekickCtl?.refresh().catch((err: unknown) => console.error("Could not refresh Sidekick", err));
  // A profile chosen for the first time in this process: the jobs' start runs (Decision 7). Without jobs, nothing.
  void jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
  // The backend follows the base: started, or stopped and started in the new profile. Without one, nothing (D0).
  void backendRebase().catch((err: unknown) => console.error("Could not move the backend to the profile", err));
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

/** Settings › General › Text size zooms the whole page; the traffic lights follow the taller top bar. */
function applyTextSize(size: TextSize | undefined) {
  if (!window || window.isDestroyed()) return;
  const factor = TEXT_SIZES[size ?? "normal"];
  window.webContents.setZoomFactor(factor);
  if (process.platform === "darwin") window.setWindowButtonPosition({ x: 14, y: trafficLightY(factor) });
}

/**
 * What a runtime (or board mode's workspace) starts with: the config's checks, the engine's command and the plugin
 * catalogue. Null when the engine CLI isn't installed.
 */
async function prepareEngine() {
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
    cmd = await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) });
  }
  if (!cmd) return null;
  const plugins = pluginsCtl;
  // The running plugins' collections the agent reads (plugins spec §3.2), written for this base; none: no file (D0).
  const extra = plugins ? await plugins.catalogueFile(base).catch((err: unknown) => (pluginLog("Could not write the plugin data catalogue", err), null)) : null;
  plugins?.markRuntimeBuilt(extra !== null);
  return { c, base, engine, cmd, extra };
}

/**
 * The runtime's options (and board mode's workspace's), its session aside. `runningTask` names the task a data or
 * material request is for: the open task's, or in board mode the asking slot's (P3).
 */
async function runtimeOptions(
  { c, base, engine, cmd, extra }: NonNullable<Awaited<ReturnType<typeof prepareEngine>>>,
  runningTask: (slot?: SlotRef) => Promise<{ id: string; action?: string; scope: string } | null>,
) {
  const settings = settingsCtl;
  const plugins = pluginsCtl;
  // The core `tools` server for task and job slots (tools spec §5): only with an `agent: "call"` tool (D0).
  const tools = await toolsHost?.workspaceOptions();
  return {
    harness,
    engine,
    folder: base,
    gitdir: historyDir(app.getPath("userData"), base),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(here, "ui-server.js"),
    dataServerEntry: path.join(here, "data-server.js"),
    // The person's store (one write queue per base), for the folder this runtime runs in.
    // A dotted collection name is a running plugin's (read only); absent without plugins (D0).
    data: (request: unknown, slot?: SlotRef) =>
      agentDataRequest({ store: async () => dataStoreFor(base), runningTask: () => runningTask(slot), ...(plugins ? { plugin: (r: unknown) => plugins.agentData(r) } : {}) }, request),
    ...(extra ? { extraData: { catalogue: extra } } : {}),
    // The person's material in this folder, for the running task's scope (material spec §9): the base this runtime was
    // built for, so a request never reaches another profile's material. Absent without material (D0).
    ...(harness.material
      ? { material: { request: (request: unknown, slot?: SlotRef) => materialRequest(base, request, () => runningTask(slot)), entry: path.join(here, "material-server.js") } }
      : {}),
    // The agent's review tools in this base, through the person's ReviewService so both sides share its locks. Only
    // when the agent may edit the folder (review spec D0); the runtime checks the same.
    ...(harness.permissions.edit === "folder" ? { review: (request: unknown) => reviews.agent(base, request) } : {}),
    command: cmd.command,
    env: cmd.env,
    references: (await workReferences(c, base, true)).map((r) => ({ label: r.label, path: r.path })),
    // The settings' sentences, read now and on every refresh (harness-settings spec §5). Absent without settings (D0).
    // Plugins' sentences follow the harness's own (Decision 16); none on: the same AGENTS.md as without them.
    ...(settings || plugins
      ? { instructionSettings: async () => [...(settings ? await settings.sentences() : []), ...(plugins ? await plugins.sentences() : [])] }
      : {}),
    // Linked folders (hatches spec §3.3, §3.4): absent without them (D0).
    ...linkedRuntimeOptions(),
    // The Subagents part of AGENTS.md follows the open scope's engine preset (agentsFile) when the manifest is silent.
    ...(hasEnginePresets(harness)
      ? { instructionSubagents: instructionSubagentsOption({ engineHost: engineHost_, currentScope: () => tasks.currentScope(), boardMode: () => !!host }) }
      : {}),
    // The asking slot names the caller (P3); createRuntime's only slot is "main".
    ...(tools ? { tools } : {}),
    onModels: (offer: Parameters<NonNullable<RuntimeOptions["onModels"]>>[0]) =>
      void shared.update(engine.id, { models: offer.models, efforts: offer.efforts }).catch((err: unknown) => console.error("Could not save the engine's models", err)),
  };
}

const runtime = memoise<HarnessRuntime>(async () => {
  const p = await prepareEngine();
  if (!p) return null;
  const rt = single
    ? await openSingle(p)
    : await createRuntime({
        ...(await runtimeOptions(p, () => tasks.runningTask())),
        onSession: (s) => void plainTasks.sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
      });
  announceCommits(rt.history);
  // A new runtime: the material queue, stopped by closeRuntime, goes on (in this base). Without material, nothing.
  kickMaterial();
  return rt;
});

/**
 * `single` mode's runtime (Decision 12): a workspace whose `"main"` slot runs the task, as `createRuntime`'s; a data or
 * material request from a job's slot is that run's, in its scope (P3), never the open task's.
 */
async function openSingle(p: NonNullable<Awaited<ReturnType<typeof prepareEngine>>>): Promise<HarnessRuntime> {
  const ws = await createWorkspace(
    await runtimeOptions(p, (slot) => {
      const jobs = jobsHost;
      return slot && jobs && isJobSlot(slot.key) ? Promise.resolve(jobs.runningOf(slot.key)) : tasks.runningTask();
    }),
  );
  const { runtime: rt, slot } = await openSingleRuntime(ws, {
    onSession: (s) => void plainTasks.sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
  });
  singleParts.set(rt, { workspace: ws, slot });
  return rt;
}

/**
 * Closes the running runtime and keeps the open task; the next turn starts a new runtime (and engine session). First
 * the person's material stops (material spec §10): its AI stage and its conversions, which belong to this base.
 */
async function closeRuntime() {
  // Job runs on this workspace end first and are logged "Cancelled" (Decision 11): none is cut off by its slot
  // closing, none queued for this folder or profile runs after. Without jobs, nothing (D0).
  await jobsHost?.cancelAndSettle();
  await materialJobs?.stop();
  await materialSvc?.stop();
  // Board mode: the shared workspace (every lane's slot) closes; the open tasks stay, as today's task does.
  if (host) {
    await host.closeWorkspace();
    // As below: not when a lane has already opened a new workspace, which wrote its own AGENTS.md.
    if (!host.workspaceOpen()) settingsCtl?.forget();
    return;
  }
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
  // A closed runtime's history keeps no listener of main's.
  if (rt) commitAnnouncements.stop(rt.history);
  // The next runtime writes AGENTS.md afresh: nothing is pending against this one's. Only once close() resolved (a
  // running refresh would set what was applied again), and not when a new runtime has already written its own.
  if (!runtime.peek()) settingsCtl?.forget();
}

/** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  // Jobs (Decision 11): the runs queued or running are cancelled ("Cancelled"); the `every` timers stay.
  jobsHost?.cancelRuns();
  // Board mode: every lane ends, the queues empty, the workspace closes; a new engine brings its caps (spec §10).
  if (host) {
    await host.dropAll();
    return closeRuntime();
  }
  single?.gate.dropAll();
  await tasks.interrupt().catch((err: unknown) => console.error("Could not end the task", err));
  await closeRuntime();
  if (single) {
    // A new engine brings its own hold: one session in all (tasks and jobs together) or two at once.
    const c = await config.load();
    single.gate.setCaps(singleCaps(c.engineId, c.parallel), engineHold(c.engineId));
    single.gate.setBeforeStart(singleBeforeStart(c.engineId, singleMainSlot));
  }
}

/**
 * "Undo this task" by its own paths (parallel spec §5.3): board mode, and `single` mode, where job runs commit beside
 * the task. Null in plain mode: the whole folder back to the task's start, as always (D0). `busy`: the task's own lane
 * (single mode: the task) or the job run being undone is still running.
 */
function undoByPaths(): {
  running: () => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
  /** The same in a tracked linked folder (hatches spec §3.4), relative to it. */
  linkedRunning: (realPath: string) => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
  busy: (id: string) => boolean;
} | null {
  const jobRunning = (id: string) => (jobsHost?.runningOf(`job:${id}`) ?? null) !== null;
  const board = host;
  if (board)
    return {
      running: () => board.runningPaths(),
      linkedRunning: (p) => board.linkedRunningPaths(p),
      busy: (id) => (board.lane(id)?.manager.isBusy() ?? false) || jobRunning(id),
    };
  if (!single) return null;
  return {
    running: async () => {
      const rt = await runtime.peek()?.catch(() => null);
      const ws = rt ? singleParts.get(rt)?.workspace : undefined;
      return ws ? ws.runningPaths() : [];
    },
    linkedRunning: async (p) => {
      const rt = await runtime.peek()?.catch(() => null);
      const ws = rt ? singleParts.get(rt)?.workspace : undefined;
      return ws ? ws.linkedRunningPaths(p) : [];
    },
    busy: (id) => tasks.isBusy() || jobRunning(id),
  };
}

/** `single` mode: the running runtime's `"main"` slot, if one is open (never opens one). */
async function singleMainSlot(): Promise<SessionSlot | null> {
  const rt = await runtime.peek()?.catch(() => null);
  return rt ? (singleParts.get(rt)?.slot ?? null) : null;
}

/** The history of the folder when no runtime runs: one per folder and ignore list (its queue orders every write). */
const standaloneHistory = lastOpened(async (key) => {
  const { folder, ignore } = JSON.parse(key) as { folder: string; ignore: string[] };
  const history = new History(folder, historyDir(app.getPath("userData"), folder), [...ignore, ...modHistoryIgnores(resolvedMods.map((m) => ({ id: m.json.id, history: m.json.history })))], historyKeep(harness));
  await history.init();
  announceCommits(history);
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
  const rt = host ? null : await runtime.peek()?.catch(() => null);
  if (rt) return rt.history;
  // Board mode: the shared workspace's history while it is open.
  if (host) {
    const open = await host.history();
    if (open) return open;
  }
  const c = await validConfig();
  if (!c) return null;
  const extra = getEngine(c.engineId).instructionsFile?.path;
  // Same ignore list as the runtime's: its files under .harness/ and the generated instructions.
  return standaloneHistory(JSON.stringify({ folder: baseOf(c), ignore: [".harness/", "AGENTS.md", ...(extra ? [extra] : [])] }));
}

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
        // Board mode: a refusal (a lane runs a turn) throws, so the change stays stale for the next gap.
        if (host) return host.refreshInstructions();
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      changed: (state) => sendToWindow("hh:settings", state),
    });
  }
  // Sidekick runs only for a harness that declares it: without the key there is no controller, so no tips, daily card or turns.
  sidekickCtl = !sidekickView(harness) ? null : new SidekickController({
    ...(harness.sidekick ? { manifest: harness.sidekick } : {}),
    harness: { name: harness.name, ...(harness.tagline ? { tagline: harness.tagline } : {}) },
    phases: (action) => (action && Object.hasOwn(harness.actions, action) ? (harness.actions[action].phases ?? []) : []),
    phaseBrief: (action, phase) => readPhaseBrief(action, phase).catch(() => null),
    store: new SidekickStore({
      // Every record of the collection (settings, learned items, sidekicks, scope records), with no query limit.
      readAll: async () => {
        const c = await validConfig();
        if (!c) return [];
        return (await sidekickStoreFor(baseOf(c)).readAll(SIDEKICK_COLLECTION, APP_SCOPE)).records as SidekickRecord[];
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: sidekick` commit (open task's trailer).
      write: (request) => personData(request, { scope: APP_SCOPE }),
      ...(harness.sidekick ? { manifest: harness.sidekick } : {}),
    }),
    setup: async () => {
      const c = await validConfig();
      return c ? { engineId: c.engineId, base: baseOf(c) } : null;
    },
    hasNotice,
    engine: getEngine,
    command: async (engine) => hooks.engines?.[engine.id] ?? engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }),
    // The `sidekick` process in Settings › Models, light by default (plan 3c), resolved when a session opens; a
    // sidekick's own tier (or the routing turn's light one) uses that tier's model instead.
    profile: async (engine, tier) => {
      const c = await config.load();
      const models = cleanModels(c.models);
      return pickProfile(c.policies?.model, tier ? { engine: engine.id, tier, models } : { engine: engine.id, action: SIDEKICK_PROCESS, manifestTier: "light", models });
    },
    // Outside the base (plan Decision 1), so the task's CLAUDE.md/AGENTS.md never load in the Sidekick session.
    workDir: (base, id = "sidekick") => sidekickWorkDir(app.getPath("userData"), base, id),
    writeBrief: writeSidekickBrief,
    open: (o) => new SidekickSession(o),
    task: async () => {
      const t = await tasks.runningTask();
      if (!t) return null;
      const phase = await tasks.openPhase();
      return { ...t, ...(phase ? { phase } : {}) };
    },
    context: async (base, scope) => {
      // readNotes returns newest first.
      const notes = await readNotes(base, notesPrefix(scoped(), scope ?? MAIN_SCOPE)).catch(() => []);
      const data = Object.entries(harness.data)
        .filter(([, c]) => c.agent !== "none")
        .map(([name]) => name);
      return { notes: notes.slice(0, 20).map((n) => n.title), data };
    },
    uiLanguage: async () => languageName((await config.load()).language ?? DEFAULT_LANGUAGE),
    usage: async (base) => recentUsage(await new UsageLog(base).load(Infinity), 2000),
    log: (base, record) => new UsageLog(base).append(record),
    // The daily card (sidekick plan Decision 12): the day's note titles in every scope and its tokens, titles only.
    // The task manager can't list open tasks (Open question 7): nothing is open.
    dailyInput: async (base, day) => {
      const scopes = scoped() ? [MAIN_SCOPE, ...(await scopeStoreFor(base).list().catch(() => [])).map((sc) => sc.id)] : [MAIN_SCOPE];
      const notes: string[] = [];
      for (const scope of new Set(scopes)) {
        for (const n of await readNotes(base, notesPrefix(scoped(), scope)).catch(() => [])) {
          if (n.date && localDay(new Date(n.date)) === day) notes.push(n.title);
        }
      }
      return { day, notes, tokens: dayTokens(await new UsageLog(base).load(Infinity), day, localDay), open: [] };
    },
    changed: (state) => sendToWindow("hh:sidekick", state),
    events: { read: readSidekickEvents, append: appendSidekickEvent },
    // Import (sidekick spec §2a.6): a file in an engine's settings folder (under home or moved by env) is refused, links resolved, before any read.
    importFiles: (paths, signal) => readImportFiles(paths, { home: os.homedir(), env: process.env }, undefined, signal),
    // The tag key of imported files sources: in userData, where the agent can't reach it (never in the data folder).
    tagKey: (create) => sourceTagKey(path.join(app.getPath("userData"), "sidekick", "source-key"), create),
    pickImportFiles: async () => {
      if (!window || window.isDestroyed()) return [];
      const r = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"], filters: [{ name: "Text", extensions: ["md", "txt"] }] });
      return r.canceled ? [] : r.filePaths;
    },
    // "Save as decision" (sidekick plan Decision 7): a note like any other, written as the person when they press the button.
    saveDecision: async ({ scope, action, title, decision }) => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      const base = baseOf(c);
      const prefix = notesPrefix(scoped(), scope === APP_SCOPE ? MAIN_SCOPE : scope);
      // Never over another note of the scope: numbered (`-2`, `-3`…) like a question's note.
      const exists = (slug: string) => fs.access(path.join(base, prefix, `${slug}.md`)).then(() => true, () => false);
      const first = noteSlug(title);
      let slug = first;
      for (let i = 2; await exists(slug); i++) slug = `${first}-${i}`;
      await writeNote(base, slug, { title, summary: [decision], decisions: [decision], files: [], open: [] }, { ...(action ? { action } : {}), date: new Date().toISOString(), engine: c.engineId }, prefix);
      await saveAppChange(await currentHistory(), ownCommits(), [`${prefix}${slug}.md`], `Note: ${title}`, await tasks.trailerNow());
    },
    // Learning (sidekick spec §6.4): Sidekick's own items, written as the app after a task closes, in one `Data: sidekick` commit.
    writeApp: async (base, requests) => {
      const blocked = quitting ? "The app is closing" : turnBlocked();
      if (blocked) throw new Error(blocked);
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      // Learned in another profile (or before a move): never written into this one.
      if (baseOf(c) !== base) throw new Error("The app's folder changed while Sidekick was learning");
      // Every request checked before any runs, so a malformed one writes nothing.
      for (const r of requests) if (!dataRequestSchema.safeParse(r).success) throw new Error("Not a data request");
      const store = sidekickStoreFor(base);
      for (const r of requests) await runDataRequest(store, r, { who: "app", scope: APP_SCOPE });
      const own = [dataPath(store.scopeFor(SIDEKICK_COLLECTION, APP_SCOPE), SIDEKICK_COLLECTION)];
      await saveAppChange(await currentHistory(), ownCommits(), own, `${DATA_CHANGE_PREFIX}${SIDEKICK_COLLECTION}`).catch((err: unknown) =>
        console.error("Could not record Sidekick's learning", err),
      );
    },
  });
  // Board and single mode (parallel spec §9.2): one Attention store per base for the plugins, the waiting tasks and
  // the jobs, with the plugins' tag key (outside every base, P5). A task's items show while it is an open lane; a job's
  // while the harness declares it; the harness tools' item while it has tools (tools Decision 7). Plain mode: none (D0).
  if (hostMode(harness) !== "plain") {
    const stores = attentionStores({ tagKey: (create) => sourceTagKey(path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id, "attention-key"), create), log: pluginLog });
    stores.registerKnown("task", (id) => host?.board.laneIds().includes(id) ?? false);
    if (harness.jobs) stores.registerKnown("job", jobOriginKnown(harness.jobs));
    if (hasTools(harness)) stores.registerKnown("tool", (id) => id === harness.id);
    sharedAttention = stores;
  }
  // Plugins (plugins spec): only a harness that takes them, or dev folders (HH_PLUGIN_DIRS, development builds). D0:
  // otherwise no scheme, no controller, no window, no IPC handler and no file.
  if (pluginsAccepted(harness) || (hooks.pluginDirs?.length ?? 0) > 0) {
    // Before "ready" (spike S2): the backend windows' own scheme. Nothing else registers one.
    protocol.registerSchemesAsPrivileged(hasTools(harness) ? [MOD_SCHEME, PLUGIN_SCHEME, TOOL_SCHEME] : [MOD_SCHEME, PLUGIN_SCHEME]);
    // The app's own per-harness folder (outside every base, B8/B13): pointers, approvals, keys, the inbox's tag key.
    const appDir = path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id);
    const host = new PluginBackendHost({ resources: shellResources, devTools: !app.isPackaged, electron: { BrowserWindow, session, ipcMain }, log: pluginLog });
    pluginHost = host;
    pluginStateRoot = path.join(appDir, PLUGIN_STATE_DIR);
    // Board mode: the inbox's store is shared with the waiting tasks (Decision 10). Plain mode passes nothing (D0).
    const attentionShared = sharedAttention;
    pluginsCtl = new PluginsController({
      harness: { id: harness.id, name: harness.name, root: harness.root, ...(harness.plugins ? { plugins: harness.plugins } : {}), ...(harness.slots ? { slots: harness.slots } : {}) },
      devDirs: hooks.pluginDirs ?? [],
      pointers: new PluginPointers(path.join(appDir, "plugins.json")),
      // Keys only where the OS encrypts them (Decision 17): never in the clear on a Linux without a keyring. The one
      // store, shared with Settings › Connections; never null here (this block runs only when it is built).
      secrets: secretStore()!,
      appDir,
      base: currentBase,
      host,
      fetch: globalThis.fetch,
      exec: {
        resolve: async (cmd) => resolveBinary(cmd, await loginShellPath(commandDeps), commandDeps),
        run: runFile,
        // The controller keeps only PATH, HOME and LANG of this, and sets TERM=dumb (B7).
        env: async () => ({ PATH: await loginShellPath(commandDeps), HOME: os.homedir(), LANG: process.env.LANG ?? "en_US.UTF-8" }),
      },
      userData: app.getPath("userData"),
      // The inbox's HMAC key (Attention review): its own file, not Sidekick's, where the agent can't reach it.
      tagKey: (create) => sourceTagKey(path.join(appDir, "attention-key"), create),
      ...(attentionShared
        ? {
            attentionStoreFor: (b: string, create: boolean) => attentionShared.forBase(b, create),
            registerKnown: (kind: "plugin", fn: (id: string) => boolean) => attentionShared.registerKnown(kind, fn),
          }
        : {}),
      pickFolder: async () => {
        if (!window || window.isDestroyed()) return null;
        const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show();
      },
      whenNoTask: (fn) => tasks.whenNoTask(fn),
      // As the settings' (harness-settings D4): only from betweenTasks or a whenNoTask callback; peek, never get.
      refreshInstructions: async () => {
        const board = boardHost();
        if (board) return board.refreshInstructions();
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      runLimitMs: hooks.pluginRunLimitMs ?? 120_000,
      // Mock mode and HH_PLUGIN_FIXTURES: plugins run on their fixtures, never the network or the key store (P10).
      ...(hooks.mock || hooks.pluginFixtures ? { fixtures: true } : {}),
      // `plugin dev` (Decision 22): a dev plugin's dist/ rebuilt → its backend restarts and its panels remount.
      ...(app.isPackaged
        ? {}
        : { watch: (dir: string, onChange: (name: string | null) => void) => watchPluginFolder(dir, onChange, (err) => pluginLog(`Stopped watching ${dir}`, err)) }),
      changed: (view) => {
        sendToWindow("hh:plugins", view);
        // A plugin on, off, added or removed: its searchable records come or go (search spec §7). D0 inside. Any
        // other change (a sync time, an error) leaves them as they are.
        const on = runningPlugins(view);
        if (on !== pluginsOn) searchSvc.dataChanged();
        pluginsOn = on;
      },
      attentionChanged: (view) => {
        sendToWindow("hh:attention", view);
        pluginBadge = view.badge;
        refreshDockBadge();
      },
      surfaceChanged: (view) => sendToWindow("hh:pluginSurface", view),
      panelsNeeded: () => pluginPanels.needed(),
      dataChanged: (plugin, collections) => {
        sendToWindow("hh:pluginData", { plugin, collections });
        searchSvc.dataChanged();
      },
      log: pluginLog,
    });
  }
  // hh-mod (minimal-core 0b2): always, in the one call Electron takes; with plugins or tools, theirs registers it.
  if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0 && !hasTools(harness)) protocol.registerSchemesAsPrivileged([MOD_SCHEME]);
  // Settings › Connections (tools spec §9): only a harness that declares secrets (D0: no channel, no controller).
  if (hasSecrets(harness)) registerConnectionsIpc(handle, connections());
  // Tools (tools spec §4, §5): only a harness that declares them. D0: otherwise no scheme, no window, no IPC handler,
  // no `tools` server and no trace.
  if (hasTools(harness)) {
    // Before "ready". Electron takes one call: with plugins, theirs above registers this scheme too.
    if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0) protocol.registerSchemesAsPrivileged([MOD_SCHEME, TOOL_SCHEME]);
    const sandbox = new ToolHost({ resources: shellResources, devTools: !app.isPackaged, electron: { BrowserWindow, session, ipcMain }, log: toolsLog });
    const toolData = toolDataRequests({
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      history: () => currentHistory(),
      board: ownCommits,
      blocked: () => (quitting ? "The app is closing" : turnBlocked()),
      scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
      // A call in no scope (the UI's with none open, before a task): `_app` with scopes, `main` without.
      noScope: () => (scoped() ? APP_SCOPE : MAIN_SCOPE),
      serial: dataWrites,
    });
    const toolRecordings = mockToolsDir(hooks);
    toolsHost = createToolsHost({
      harness,
      base: currentBase,
      references: async () => {
        const c = await validConfig();
        return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, path: r.path })) : [];
      },
      userData: app.getPath("userData"),
      // The one key store; a harness with tools but no secrets has no key to read.
      store: secretStore() ?? { harnessValues: async () => ({}) },
      data: toolData,
      exec: {
        resolve: async (cmd) => resolveBinary(cmd, await loginShellPath(commandDeps), commandDeps),
        run: runFile,
        // The tools host keeps only PATH, HOME and LANG of this, and sets TERM=dumb (Decision 6).
        env: async () => ({ PATH: await loginShellPath(commandDeps), HOME: os.homedir(), LANG: process.env.LANG ?? "en_US.UTF-8" }),
      },
      fetch: globalThis.fetch,
      // Public addresses only, on every hop: a tool never reaches this computer or its network.
      allowHost: isPublicHost,
      host: sandbox,
      openScope: () => tasks.currentScope(),
      // Board mode: the lane whose slot asks; otherwise the open task (the `main` slot).
      slotTask: (key) => slotTaskOf(host ? host.lane(key)?.manager : tasks),
      jobRun: (key) => jobsHost?.runOf(key) ?? null,
      // A call during the task's turn is saved on its reply (tools spec §8.2); otherwise it is only shown.
      emitToTask: (task, event) => {
        if (host) {
          const lane = host.lane(task);
          if (lane && !lane.controller.addToTurn(task, event)) lane.emit(event);
          return;
        }
        if (turns.addToTurn(task, event)) return;
        void tasks.runningTask().then((t) => {
          if (t?.id === task) emit(event);
        });
      },
      changed: () => {
        if (toolsHost) sendToWindow(TOOLS_CHANGE_CHANNEL, toolsHost.info());
      },
      // Off after repeated crashes (Decision 7): an action item in the base's shared Attention store, when the app has
      // one. Without one, only the chat's top line says so.
      ...(sharedAttention
        ? {
            attention: async (create: boolean) => {
              const base = await currentBase().catch(() => null);
              return base && sharedAttention ? sharedAttention.forBase(base, create) : null;
            },
          }
        : {}),
      serverEntry: path.join(here, "tools-server.js"),
      // The `pre` and `expects-miss` rows (tools spec §6); written only when an action declares them.
      usage: async (record) => {
        const c = await validConfig();
        if (c) await new UsageLog(baseOf(c)).append(record);
      },
      engine: async () => (await config.load()).engineId ?? "",
      scoped,
      // Mock mode replaying recordings (`dev --mock`, tools spec §12): tools run for real, their fetch and exec answer
      // from <recordings>/tools/<tool>/, keys are fixture-<id>. When that applies: mockToolsDir (test-hooks.ts).
      // Otherwise the real transport (D0).
      ...(toolRecordings ? { mock: { dir: toolRecordings } } : {}),
      log: toolsLog,
    });
    registerToolsIpc(handle, toolsHost);
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
      // A connect step is done once its secrets are set (tools spec §9); the schema gives one only with `secrets`.
      ...(hasSecrets(harness) ? { secretsSet: (ids: readonly string[]) => connections().allSet(ids) } : {}),
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
      // Profile ids are reused names: the search index is keyed by the folder's path, so a deleted one's must go.
      forget: (folder) => searchSvc.discard(folder),
      changed: (state) => sendToWindow("hh:profiles", state),
      blocked: hold.profileChangeBlocked,
    });
  }
  materialSvc = await buildMaterial({
    harness: () => harness,
    config: () => config,
    validConfig,
    baseOf,
    scoped,
    activeScope,
    pickFiles: async () => {
      if (!window || window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
      return r.canceled ? null : r.filePaths;
    },
    send: sendToWindow,
    kick: kickMaterial,
    currentHistory,
    ownCommits,
    trailerNow: () => tasks.trailerNow(),
    here,
    stageDeps: materialStageDeps,
    trash: (file) => shell.trashItem(file),
    dataStoreFor,
  });
  // The AI stages start only when no turn, task operation, hold, move or quit is under way.
  materialJobs = materialSvc
    ? buildMaterialJobs(materialSvc, () => !quitting && moving === null && !tasks.isBusy() && hold.turnBlocked() === null && !hold.folderBusy())
    : null;
  translation = buildTranslation({
    userData: app.getPath("userData"),
    ...(harness.tone ? { tone: harness.tone } : {}),
    config: () => config,
    mock: hooks.mock === true,
    translateEngine,
    command: async (engine) => hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }).catch(() => null)),
    pickProfile,
    validConfig,
    baseOf,
    serverEntry: path.join(here, "translate-server.js"),
    send: (state) => sendToWindow("hh:language", state),
  });
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
    // Test background mode: no Dock icon, so the run never shows up beside the person's own apps.
    if (hooks.background && process.platform === "darwin") app.dock?.hide();
    // Development builds: the harness's logo in the Dock, else Human Harness's (packages/shell/resources).
    if (process.platform === "darwin" && !app.isPackaged) {
      const icon = devDockIcon(
        [() => (harness.logo ? resolveInHarness(harness, harness.logo) : undefined), () => path.join(shellResources, "hh-logo.png")],
        (file) => nativeImage.createFromPath(file),
      );
      if (icon && !hooks.background) app.dock?.setIcon(icon);
    }
    config = new ConfigStore(app.getPath("userData"));
    jobSettings = (await config.load()).jobs;
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
    // A harness that declares `parallel` runs the board (D7); any other keeps today's single task.
    if (hostMode(harness) === "board") {
      const board = buildBoardHost(
        {
          harness: () => harness,
          config: () => config,
          currentBase,
          taskStoreOptions,
          prepareEngine,
          runtimeOptions,
          jobsHost: () => jobsHost,
          announceCommits,
          kickMaterial,
          turnDeps,
          checkTurn,
          restoreBlocked: () => restores.turnBlocked(),
          turnChatLog,
          taskDeps,
          scoped,
          activeScope,
          emit,
          send: sendToWindow,
          currentHistory,
          attention: () =>
            (taskAttention = buildTaskAttention({
              currentBase,
              sharedAttention: () => sharedAttention,
              badge: setDockBadge,
              notify: ({ title, body }, onClick) => {
                if (!Notification.isSupported()) return;
                const n = keepNotification(new Notification({ title, body }), notifications);
                n.on("click", onClick);
                n.show();
              },
              showWindow: () => {
                if (window && !window.isDestroyed()) {
                  if (window.isMinimized()) window.restore();
                  window.show();
                  window.focus();
                }
              },
              focusTask: (id) => host?.board.focus(id),
              notifyOn: async () => (await config.load()).notifyWaiting === true,
              windowFocused: () => (window && !window.isDestroyed() ? window.isFocused() : false),
              otherCount: () => pluginBadge + jobBadge,
            })),
        },
        await config.load(),
      );
      host = board;
      tasks = board.board;
    }
    // Jobs (part 3): beside the board's lanes, or beside the single task (Decision 12). Without jobs, nothing (D0).
    if (hasJobs(harness)) {
      const board = host;
      jobsHost = board
        ? buildJobsHost(jobsWiring(), board.gate, async () => {
            const ws = await board.workspace();
            if (!ws) throw new Error("The engine isn't installed");
            return ws;
          })
        : buildSingleJobs(
            jobsWiring(),
            {
              mainSlot: singleMainSlot,
              turns,
              emit,
              workspace: async () => {
                const rt = await runtime.get();
                const parts = rt ? singleParts.get(rt) : undefined;
                if (!parts) throw new Error("The engine isn't installed");
                return parts.workspace;
              },
              setSingle: (s) => (single = s),
            },
            await config.load(),
          );
    }
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
    // The home folder's read-only layers (minimal-core spec §5.1), every start, before the host resolves the mods.
    await writeLayers({
      home: appHome(userData, harness.id),
      core: { mods: Object.fromEntries(Object.entries(CORE_MODS).map(([id, m]) => [id, m.dir])), layouts: {}, layoutTexts: { main: `${JSON.stringify(defaultLayoutJson, null, 2)}\n` } },
      harness: await harnessLayer(harness.root, Object.keys(harness.mods ?? {}).filter((id) => !Object.hasOwn(CORE_MODS, id))),
      notice: showNotice,
      // The folder's manual, AGENTS.md and hh.d.ts (0b2), rewritten every start.
      manual: manualFiles(),
    });
    // Safe mode at start (0b2): `--safe` or HH_SAFE=1, before the host so no local mod runs.
    if (safeAtStart(process.argv, process.env)) await safeMode(false).catch((err: unknown) => console.error("Could not enter safe mode", err));
    // The home folder's history (0b2): what changed while the app was closed is committed, then every quiet change.
    await startHomeHistory().catch((err: unknown) => console.error("Could not start the home folder's history", err));
    // The mods (minimal-core spec §4): a host only when some mod could run (D0); before the IPC, so the first send meets it.
    await startModHost().catch((err: unknown) => console.error("Could not start the mods", err));
    // The home folder's mods/ (0b2): an edit syncs and reloads the user mod live.
    watchUserMods();
    // The home folder's layouts/ and settings.json (0b2): an edit or a pick redraws the window.
    watchUserLayouts();
    registerIpc();
    // A task left open by an earlier run can't continue: its session is gone.
    void interruptTasks().catch((err: unknown) => console.error("Could not settle the last task", err));
    // After the interrupt (queued behind it): a scoped harness's earlier work moves into `main`.
    void settleScopes()
      .then(scopesChanged)
      .catch((err: unknown) => console.error("Could not prepare the scopes", err));
    // Material an earlier run left converting (a quit or crash mid-way) is converted again; other bases (profiles)
    // resume the first time they are used. Without material there is nothing (D0).
    void materialSvc?.settle().catch((err: unknown) => console.error("Could not resume the material", err));
    // AI stages an earlier run left to do (the queue looks only once the app is set up).
    if (await validConfig()) kickMaterial();
    await createWindow();
    // The control channel (0b2): `humanharness status` and `shot` reach the app through app/.control.json.
    const controlHome = appHome(userData, harness.id);
    void startControl({
      home: controlHome,
      window: () => window,
      status: async () => {
        const layout = await shownLayout(controlHome);
        return { ...(await modsView()), layout: { name: layout.name, source: layout.source, problems: layout.problems } };
      },
    })
      .then((c) => {
        // A quit that came first: the channel closes at once.
        if (quitting) void c.stop();
        else control = c;
      })
      .catch((err: unknown) => console.error("Could not start the control channel", err));
    // The plugins of the current base (none before setup); a computer that slept runs the sources that came due.
    if (pluginsCtl) {
      const plugins = pluginsCtl;
      void plugins.start().catch((err: unknown) => pluginLog("Could not start the plugins", err));
      powerMonitor.on("resume", () => plugins.resumed());
    }
    // The tools host window, warm from now (Decision 7). Without tools, nothing (D0).
    void toolsHost?.start().catch((err: unknown) => toolsLog("Could not start the tools", err));
    // Jobs: the `start` runs and `every` timers, once the app is set up (now, or when setup or a profile finishes).
    void jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
    // The harness's backend, the same moment (hatches Decision 5). Without one, nothing (D0).
    void backendReady().catch((err: unknown) => console.error("Could not start the backend", err));
    // Sidekick's daily card (spec §2a.2 daily-summary): once per local day, detached; off or without a daily-summary sidekick, nothing.
    void sidekickCtl?.daily().catch((err: unknown) => console.error("Sidekick's daily card failed", err));
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    // Jobs (Decision 11): no run starts from now on; the running ones are cancelled, the queued ones dropped.
    jobsHost?.stopAll();
    single?.gate.dropAll();
    // Board mode: every lane's turn stops now and its slot closes (Decision 16); never an interrupt, which would reopen them.
    const boardClosed = host?.closeAll().catch((err: unknown) => console.error("Could not close the open tasks", err));
    if (!host) {
      plainTasks.close();
      turns.close();
    }
    void sidekickCtl?.close();
    // The mods stop (their disposers run) before the app goes; the home folder is no longer watched.
    userLayerWatch?.close();
    userLayerWatch = null;
    layoutsWatch?.close();
    layoutsWatch = null;
    homeHistory?.close();
    const modsStopped = modHost?.stop().catch((err: unknown) => console.error("Could not stop the mods", err));
    // The control channel closes and app/.control.json goes.
    const controlStopped = control?.stop().catch((err: unknown) => console.error("Could not stop the control channel", err));
    control = null;
    // The test prompt cleans up (its CLI, its temporary folder) before the app goes; bounded wait.
    const testStopped = Promise.race([guards.close(), new Promise<void>((r) => setTimeout(r, QUIT_TEST_WAIT_MS))]);
    const setupStopped = setupRun ? stopSetupProcess(setupRun) : Promise.resolve();
    void (async () => {
      // A folder move under way finishes (or undoes itself) first: it is never cut short on purpose.
      await moving?.catch(() => undefined);
      await Promise.all([setupStopped, testStopped, modsStopped, controlStopped]);
      // Every plugin backend stops (and its window closes) before the agent goes.
      await pluginsCtl?.stop().catch((err: unknown) => pluginLog("Could not stop the plugins", err));
      await pluginHost?.stopAll().catch((err: unknown) => pluginLog("Could not close the plugin windows", err));
      // The tools host window closes; a call still running fails "Tools stopped".
      toolsHost?.stop();
      // The backend stops for good (SIGTERM, SIGKILL after 3 s) before the agent goes; nothing starts it again.
      await backend?.stop({ quit: true }).catch((err: unknown) => console.error("Could not stop the backend", err));
      // A translation run stops; the batches it saved stay.
      await translation?.stop().catch((err: unknown) => console.error("Could not stop the translation", err));
      try {
        if (boardClosed) await boardClosed;
        await (host ? closeRuntime() : dropRuntime());
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await flushTurns();
      await flushFileIndexes();
      await searchSvc.flush().catch(() => undefined);
    })().finally(() => app.quit());
  });
}
