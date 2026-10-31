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
import { electronLauncher, translateServerSpec } from "@humanharness/blocks";
import { type EngineDef, type ModelProfile, type ModelSpec, NOTICE_VERSION, availableEngines, defaultTier, getEngine } from "@humanharness/engines";
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
  hasExpects,
  hasJobs,
  hasLinkedFolders,
  hasModes,
  hasPhases,
  hasPre,
  hasProfiles,
  hasSecrets,
  hasTools,
  inputBlocks,
  inputSpecs,
  interviewCollections,
  languageName,
  loadHarness,
  materialStageKey,
  pluginsAccepted,
  profileFormSpec,
  resolveInHarness,
  settingsView,
  sidekickCollection,
  stageTier,
} from "@humanharness/harness-sdk";
import { createI18n } from "@humanharness/i18n";
import { CORE_EN } from "@humanharness/i18n/translate";
import { type Job, MaterialStore, groundingMode, materialSection, workerRunner } from "@humanharness/material/light";
import {
  type Event,
  type HarnessRuntime,
  type HarnessWorkspace,
  type RuntimeOptions,
  type SessionSlot,
  SidekickSession,
  type SlotRef,
  type SystemTaskResult,
  createRuntime,
  createWorkspace,
  runSystemSession,
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
  buildDataContextParts,
  dataDiffOf,
  dataPath,
  dataRequestSchema,
  flushFileIndexes,
  isScopeId,
  loadReview,
  migrateToScopes,
  notesPrefix,
  noteSlug,
  profileDir,
  readNotes,
  readSidekickEvents,
  runDataRequest,
  sidekickWorkDir,
  syncLocations,
  syncStatus,
  tasksFile,
  writeNote,
  writeSidekickBrief,
} from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { devDockIcon } from "./dock-icon";
import { ChatLog } from "./chat-log";
import { ConfigStore, cleanJobs, historyDir } from "./config";
import { agentDataRequest, dataWriteQueue, harnessUiDataRequests, personDataRequests, saveAnswerRecords, toolDataRequests } from "./data-requests";
import { testPrompt } from "./engine-check";
import { createCommandDeps } from "./command-deps";
import { cliCommand, engineCommand, engineSearchPath, loginShellPath, resolveBinary } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { copySetupStep, engineOptionExtras, installCommandOf, runsInTerminal, terminalCommand } from "./install-help";
import { detectEngine, hasAcceptedNotice } from "./engine-status";
import { QUESTIONS, cleanModels, engineOffer, manifestTier, nearestTier, offeredEffort, pinnedBudget } from "./models";
import { ContextService } from "./context";
import { contextHandlers } from "./context-ipc";
import { languageHandlers } from "./language-ipc";
import { chooseModeHandler } from "./mode-ipc";
import { setPhaseHandler, timeBoxOffered } from "./phase-ipc";
import { requireNoticeForChoice, requireNoticeForTurn } from "./notice-policy";
import { reviewHandlers } from "./review-ipc";
import { workerDiff } from "./diff-runner";
import { commitAnnouncer, fileHandlers } from "./file-ipc";
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
  compactionRecord,
  dayTokens,
  measuredMaterialCosts,
  profileMeta,
  profilesUsage,
  recentUsage,
  summarizeUsage,
  translateRecord,
  usageRecord,
  withSpent,
} from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import { DocumentSessions } from "./document-sessions";
import { DocumentWatchers, MAX_EXIST_PATHS, documentsExist, readDocument, readImage } from "./documents";
import { saveWithFolderChange } from "./folder-change";
import { type MoveDeps, guardedMove, moveFolder, moveJournal, precheckMove, recoverMove } from "./move-folder";
import { type ResolvedReference, displayPath, resolveReferences, usableReferences } from "./references";
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
import { type ToolsHost, createToolsHost, jobLimits, lastCallOf, slotTaskOf } from "./tools/tools-host";
import { TOOLS_CHANGE_CHANNEL, registerToolsIpc } from "./tools/tools-ipc";
import { PLUGIN_STATE_DIR } from "./plugin-state";
import { type BoardHost, createBoardHost, hostMode } from "./board-host";
import { type AttentionStores, attentionStores } from "./attention-stores";
import { keepNotification, TaskAttention } from "./task-attention";
import { materialOwn, notePath, saveAppChange } from "./app-change";
import { type JobsHost, type JobsHostDeps, createJobsHost, isJobSlot, jobOriginKnown, coalescedSender, jobsInfo, jobsIpc, openSingleRuntime, singleBeforeStart, singleCaps, singleGate, singleTurns } from "./jobs/jobs-host";
import type { Turns } from "./gated-turns";
import type { TurnGate } from "./turn-gate";
import { cleanCaps, engineHold, parallelInfo } from "./parallel-config";
import { restoreTaskByPaths } from "./restore-paths";
import { type LinkedIpcDeps, hatchesState, linkedSecret, linkedSigning, registerLinkedIpc } from "./linked-ipc";
import { EngineHost } from "./engine-config/engine-host";
import { type EngineIpc, type EngineIpcDeps, registerEngineIpc } from "./engine-config/engine-ipc";
import { EPOCHS_FILE, EngineEpochs } from "./engine-config/epochs";
import { type PruneBase, pruneEngineSnapshots } from "./engine-config/prune";
import { BackendGeneration, backendFor, backendInit, registerBackendIpc, usableLinks } from "./backend/backend-ipc";
import { BackendLog } from "./backend/backend-log";
import { BackendProcess } from "./backend/backend-process";
import type { BackendSupervisor } from "./backend/backend-supervisor";
import { linkedHistoryDir, markRelinked, pruneUnlinked } from "./linked-history";
import { LinkedInstructions, type ScopeAccess, createScopeAccess, refreshUnlessBusy } from "./scope-access";
import {
  type LinkedHistoryRef,
  linkedHistoriesFor,
  linkedHistoryView,
  linkedOnlyRows,
  mergeTaskGroups,
  openLinkedHistory,
  restoreLinkedTask,
  restoreTaskWithLinked,
} from "./linked-restore";
import { isGitRepo } from "./linked-folders";
import { restoreTaskArgs, tasksIpc, undoRefusalOf } from "./tasks-ipc";
import { PluginsController, watchPluginFolder } from "./plugins";
import { respondHandler } from "./respond-ipc";
import { SettingsController } from "./settings";
import { SidekickController, localDay } from "./sidekick";
import { readImportFiles, sourceTagKey } from "./sidekick-import";
import { registerSidekickIpc } from "./sidekick-ipc";
import { SidekickStore } from "./sidekick-store";
import { SetupSteps, recordSetup, setupStepViews } from "./setup-steps";
import { type PhaseMoved, type TaskDeps, TaskManager, type TurnEnd } from "./task-manager";
import { TranslationCache } from "./translation-cache";
import { type Runner, TranslationService } from "./translation";
import type { MaterialService } from "./material";
import { historyKeep, materialAppState, materialItems, materialRecommended, openMaterial } from "./material-ipc";
import { MaterialJobs } from "./material-jobs";
import { type MaterialStageDeps, runMaterialStage } from "./material-stage";
import { personMaterialRequest } from "./material-requests";
import { baseFor, isInsideFolder } from "./profile-base";
import { type ProfileOutcome, Profiles, profileResult } from "./profiles";
import { ProfileSwitch } from "./profile-switch";
import { holds } from "./holds";
import { historyView } from "./history-view";
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
  mockToolsDir,
  offeredEngines,
  readTestHooks,
  testEngineStatus,
} from "./test-hooks";

declare const __HARNESS_DIR__: string;
declare const __SHELL_RESOURCES__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };
const SETUP_STEPS: SetupStep[] = ["install", "update", "login", "logout"];
/** How long each setup step may run before it is stopped (a sign-in left open in the browser, a stuck download). */
const SETUP_TIMEOUT_MS: Record<SetupStep, number> = { install: 20 * 60_000, update: 20 * 60_000, login: 10 * 60_000, logout: 60_000 };

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
/** Sidekick, the core's prompt coach (sidekick spec D1): every harness gets it once loaded; it does nothing while off. */
let sidekickCtl: SidekickController | null = null;
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

async function appState(): Promise<AppState> {
  const harnessImage = await harnessLogo();
  const saved = await config.load();
  jobSettings = saved.jobs;
  const jobs = jobsInfo(harness);
  const inputs = inputSpecs(harness.blocks);
  const interviews = interviewCollections(harness);
  const parallel = parallelInfo(harness, saved, engineHold(saved.engineId));
  const hatches = hatchesState(harness);
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
            // Empty for Claude and Codex (D0); a mocked OpenCode keeps its cost and Terminal facts.
            ...engineOptionExtras(e),
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
          ...engineOptionExtras(e),
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
    // Sidekick is core (sidekick spec D1): every harness sends it; the window draws it only with this.
    sidekick: { id: "sidekick", name: "Sidekick", mark: "spark" },
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
    // Only a harness that takes plugins (or dev folders) sends this: the Plugins tab and the inbox (plugins D0).
    ...(pluginsCtl ? { plugins: { local: pluginsAccepted(harness) && (harness.plugins?.local ?? false) } } : {}),
    // Only a harness that declares `parallel` sends this: caps, the task inbox (parallel D7).
    ...(parallel ? { parallel } : {}),
    // Only a harness that declares jobs sends them: the Jobs tab and the inbox's Jobs section (part 3 D0).
    ...(jobs ? { jobs } : {}),
    // The reader's template check (document-reader spec §4.3); absent without kinds (D0).
    ...(harness.documents ? { documents: { kinds: harness.documents.kinds } } : {}),
    // Documents can be reviewed only when the agent may edit the folder (review spec D0).
    ...(harness.permissions.edit === "folder" ? { review: true as const } : {}),
    // Only a harness that declares a hatch sends this: Scope settings (hatches D0).
    ...(hatches ? { hatches } : {}),
    // Only a harness that declares secrets sends this: Settings › Connections (tools spec §9, D0).
    ...(hasSecrets(harness) ? { connections: { count: harness.secrets!.length } } : {}),
    // Only a harness that declares tools sends this: their ids and why they are off, if they are (tools spec §5, D0).
    ...(toolsHost ? { tools: toolsHost.info() } : {}),
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

let textSizeSteps: Promise<void> = Promise.resolve();

/** Settings › General › Text size zooms the whole page; the traffic lights follow the taller top bar. */
function applyTextSize(size: TextSize | undefined) {
  if (!window || window.isDestroyed()) return;
  const factor = TEXT_SIZES[size ?? "normal"];
  window.webContents.setZoomFactor(factor);
  if (process.platform === "darwin") window.setWindowButtonPosition({ x: 20, y: trafficLightY(factor) });
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
  const history = new History(folder, historyDir(app.getPath("userData"), folder), ignore, historyKeep(harness));
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
const turnDeps: TurnDeps = {
  ensureRuntime: async () => {
    await checkTurn();
    return runtime.get();
  },
  chatLog: (chat) => turnChatLog(chat),
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
  // The turn's own task scope's linked folders, checked each turn (hatches L5). A getter: undefined without them (D0).
  get scopeAccess() {
    const linked = linked_();
    return linked ? (scope: string) => linked.access.access(scope) : undefined;
  },
};
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
const taskDeps: TaskDeps = {
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
  // `single` mode: through the gate's `tasks` cap, apart from the job turns. A getter: the mode is known once the app is ready.
  get turns() {
    return single?.turns ?? turns;
  },
  // A task closed with its note saved: the jobs' `afterTask` (Decision 6). A getter: undefined without jobs (D0).
  get taskClosed() {
    const jobs = jobsHost;
    return jobs ? (t: { id: string; action?: string; scope: string }) => jobs.taskClosed(t) : undefined;
  },
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
  // Plugins' tables follow the harness's (Decision 16); none: "" adds nothing to the first message.
  get dataContext() {
    const own = Object.values(harness.data).some((c) => c.context !== false);
    const plugins = pluginsCtl;
    if (!own && !plugins) return undefined;
    return async (scope: string, action: string | undefined) => {
      const c = await validConfig();
      // One part per collection: the context panel lists each (context-panel spec §3.1); the agent gets them joined.
      const tables = c && own ? await buildDataContextParts(dataStoreFor(baseOf(c)), harness.data, scope, action) : [];
      const extra = plugins ? await plugins.contextParts(action) : [];
      return [...tables, ...extra];
    };
  },
  // Context panel (context-panel spec §3.1): the size of AGENTS.md in the agent's working folder.
  instructionsSize: async () => {
    const c = await validConfig();
    if (!c) return null;
    const stat = await fs.stat(path.join(baseOf(c), "AGENTS.md")).catch(() => null);
    return stat?.isFile() ? stat.size : null;
  },
  // Pins and exclusions for a new task (spec §4); `contextSvc` is built below, before any task can start.
  personContext: (scope) => contextSvc.personContext(scope),
  contextChanged: (id) => void sendContext(id),
  // The agent's working folder: the engine's read paths become folder paths (spec §3.2).
  folder: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
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
      return materialSection({ mode: groundingMode(await store.grounding(), m.grounding), sheet: await store.sheet(), rows, budgetTokens: m.budget.indexTokens });
    };
  },
  // The scope's approved engine preset for each task (hatches spec §5.2). A getter: undefined without enginePresets (D0).
  get enginePreset() {
    return engineHost_();
  },
  // Board mode only (hatches Decision 6): AGENTS.md is shared by lanes in different scopes, so each task's first message
  // names its own scope's folders. A getter: undefined without linked folders (D0) or outside board mode.
  get linkedContext() {
    const linked = linked_();
    return linked && host ? (scope: string) => linked.access.section(scope) : undefined;
  },
  get path() {
    return harness.path ?? [];
  },
  // A getter, because the harness is loaded after this object is built. Undefined without settings (D0).
  get betweenTasks() {
    const settings = settingsCtl;
    const sidekick = sidekickCtl;
    const plugins = pluginsCtl;
    const linked = linked_();
    if (!settings && !sidekick && !plugins && !linked) return undefined;
    return async () => {
      await settings?.betweenTasks();
      // A link change a running turn kept from AGENTS.md, or another scope opened since it was written.
      await linked?.instructions.betweenTasks();
      await sidekick?.betweenTasks();
      // Plugin settings reach AGENTS.md; plugin collections coming or going need a runtime with (or without) them.
      await plugins?.betweenTasks();
      // Board mode closes the workspace only once no task is open (Decision 13).
      if (plugins?.takeRuntimeStale()) await (host ? host.runtimeStale() : closeRuntime());
    };
  },
  // Sidekick's after-reply moment (sidekick spec §4.2). Getters: undefined until the controller exists (D0).
  get turnStarting() {
    const sidekick = sidekickCtl;
    return sidekick ? () => sidekick.turnStarting() : undefined;
  },
  get turnEnded() {
    const sidekick = sidekickCtl;
    return sidekick ? (end: TurnEnd) => void sidekick.afterReply(end).catch((err: unknown) => console.error("Sidekick's after-reply turn failed", err)) : undefined;
  },
  // Sidekick's phase-change moment (sidekick spec §2a.2 process-guard). A getter for the same reason (D0).
  get phaseMoved() {
    const sidekick = sidekickCtl;
    return sidekick ? (e: PhaseMoved) => void sidekick.phaseMoved(e).catch((err: unknown) => console.error("Sidekick's phase-change turn failed", err)) : undefined;
  },
  // An action's pre-steps and a part's expects (tools spec §6, §6.1). Getters: undefined without tools (no toolsHost)
  // or when no action declares them (D0).
  get prepare() {
    const tools = toolsHost;
    return tools && hasPre(harness) ? tools.prepare : undefined;
  },
  get phaseEnded() {
    const tools = toolsHost;
    return tools && hasExpects(harness) ? tools.phaseEnded : undefined;
  },
  // Getters, because the harness is loaded after this object is built. Undefined without modes (task-modes D0).
  get modes() {
    return hasModes(harness) ? harness.modes : undefined;
  },
  readModeBrief: (mode) => {
    if (!Object.hasOwn(harness.modes, mode)) return Promise.reject(new Error("Unknown mode"));
    return fs.readFile(resolveInHarness(harness, harness.modes[mode].brief), "utf8");
  },
  readPhaseBrief,
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
    if (single) singleNote = notePath(scoped(), scope, slug);
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
    const own = singleNote;
    singleNote = undefined;
    // `single` mode while a job runs: the note's file alone, never the run's work (parallel spec §5.3).
    if (jobsHost?.running()) return saveAppChange(await currentHistory(), true, own ? [own] : [], message, trailer);
    await (await currentHistory())?.save(message, trailer);
  },
  changed: (view) => sendToWindow("hh:tasks", view),
  emit,
  // The ids a new task starts with (replaceable-parts §8): config.json's, already cleaned by ConfigStore.load().
  policies: async () => (await config.load()).policies ?? {},
  // `policies`: the task's own ids, fixed when it started; none passed runs the defaults (never config.json's now).
  profileFor: async (action, floor, tier, policies) => {
    const c = await config.load();
    const engine = c.engineId ?? "";
    const models = cleanModels(c.models);
    // `tier`: a plugin action's prepared task (plugins spec §5.3) or a core review task (review spec §11.3); otherwise
    // the action's, or the free questions'.
    // `floor`: the mode's minTier when a task restarts in that mode (task-modes spec §5.3); passed only when there is one.
    // Codex: a model its saved list lacks falls back before the turn (spec §5.3).
    return pickProfile(policies?.model, { engine, action, manifestTier: manifestTier(harness, action, tier), models, ...(floor ? { floor } : {}) });
  },
  fallbackFor: async (profile, tried, policies) => {
    const c = await config.load();
    const next = modelPolicy(policies?.model).fallback(profile, cleanModels(c.models), tried);
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
        ...(task.policies?.model ? { modelPolicy: task.policies.model } : {}),
        ...(task.policies?.context ? { contextPolicy: task.policies.context } : {}),
      }),
    );
  },
};
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

/** The model key of a translation run (language spec §5): not listed in Settings › Models, so always the light tier. */
const TRANSLATE_KEY = "_translate";
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

function buildTranslation(): TranslationService {
  return new TranslationService({
    cache: new TranslationCache(app.getPath("userData")),
    core: CORE_EN,
    ...(harness.tone ? { tone: harness.tone } : {}),
    language: async () => (await config.load()).language ?? DEFAULT_LANGUAGE,
    saveLanguage: async (tag) => {
      await config.save({ language: tag });
    },
    answerOffer: async () => {
      await config.save({ languageOffered: true });
    },
    // Spec §3: "no-engine" also covers an engine with a problem; mock mode never translates.
    available: async () => {
      if (hooks.mock) return "mock";
      return (await translateEngine()) ? true : "no-engine";
    },
    engineName: async () => {
      const c = await config.load();
      return isConfigured(c) ? getEngine(c.engineId).name : undefined;
    },
    prepare: async () => {
      if (hooks.mock) return null;
      const engine = await translateEngine(true);
      if (!engine) return null;
      const cmd = hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }).catch(() => null));
      if (!cmd) return null;
      const c = await config.load();
      const models = cleanModels(c.models);
      const profile = await pickProfile(c.policies?.model, { engine: engine.id, action: TRANSLATE_KEY, manifestTier: "light", models });
      const launcher = electronLauncher(process.execPath);
      // Each turn is logged in the current base (Decision 9), failed turns included; with profiles and none active,
      // there is no base and nothing is logged. Translate lines never carry a scope. `turn` is 0-based; the log's
      // batch is 1-based.
      const log = async (r: SystemTaskResult, turn: number, tag: string) => {
        const c = await validConfig();
        if (!c) return;
        const record = translateRecord({
          engine: engine.id,
          language: tag,
          batch: turn + 1,
          profile,
          ok: r.ok,
          ...(r.ok && r.usage ? { usage: r.usage } : {}),
          ...(r.limits ? { limits: r.limits } : {}),
        });
        await new UsageLog(baseOf(c)).append(record);
      };
      const run: Runner = (o) =>
        runSystemSession({
          engine,
          command: cmd.command,
          env: cmd.env,
          server: (rpc) => translateServerSpec({ rpc, launcher, entry: path.join(here, "translate-server.js") }),
          parent: path.join(app.getPath("userData"), "translate-work"),
          handle: o.handle,
          next: o.next,
          signal: o.signal,
          profile,
          onTurn: async (r, turn) => {
            await log(r, turn, o.tag).catch((err: unknown) => console.error("Could not record the translation turn", err));
            await o.onTurn(r, turn);
          },
        });
      return { engineName: engine.name, run };
    },
    send: (state) => sendToWindow("hh:language", state),
  });
}

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
      const last = recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 50).filter((r) => r.limits?.length).at(-1);
      const w = last?.limits?.find((x) => x.kind === primary) ?? last?.limits?.[0];
      return w && Date.parse(w.resetsAt) > Date.now() ? { kind: w.kind, utilization: w.utilization } : null;
    },
    afterChange: async (scope, what) => {
      kickMaterial();
      const history = await currentHistory();
      // Board mode: only this scope's material, never another task's running work (parallel spec §5.3).
      await saveAppChange(history, ownCommits(), materialOwn(scope), `Material: ${what}`, await tasks.trailerNow()).catch((err: unknown) =>
        console.error("Could not record the material change", err),
      );
    },
    // The built converter worker (its own entry beside this file), at most CONVERT_AT_ONCE at a time.
    runner: workerRunner({ entry: path.join(here, "material-worker.js") }),
    runStage: (job, prompt, tools, handle, signal, fragments) => runMaterialStage(materialStageDeps, job, prompt, tools, handle, signal, fragments),
    // The stages' costs measured in this base's log (§7): each profile's own.
    measured: async () => {
      const c = await validConfig();
      return c ? measuredMaterialCosts(recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 500)) : undefined;
    },
    kick: kickMaterial,
    trash: (file) => shell.trashItem(file),
    // The links stage's items (§8), from the current base's data store; never throws.
    ...(m.items
      ? {
          items: (scope: string) =>
            materialItems(
              m.items,
              harness.data,
              async () => {
                const c = await validConfig();
                return c ? dataStoreFor(baseOf(c)) : null;
              },
              scope,
            ),
        }
      : {}),
  });
}

/**
 * The queue of AI stages over the service (material spec §10): one at a time, started only when no turn, task
 * operation, hold, move or quit is under way.
 */
function buildMaterialJobs(svc: MaterialService): MaterialJobs<Job> {
  return new MaterialJobs<Job>({
    idle: () => !quitting && moving === null && !tasks.isBusy() && hold.turnBlocked() === null && !hold.folderBusy(),
    next: () => svc.nextJob(),
    run: (job, signal) => svc.runJob(job, signal),
  });
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

/**
 * Board mode's host (parallel spec §6) over the app's own wiring: the plain runtime's checks and options for its
 * workspace, today's turn and task deps for its lanes.
 */
function buildBoardHost(c: AppConfig): BoardHost {
  return createBoardHost(
    {
      suggested: harness.parallel ?? { tasks: 1, jobs: 1 },
      config: () => config.load(),
      base: currentBase,
      taskStoreOptions,
      openWorkspace: async (runningTask) => {
        const p = await prepareEngine();
        if (!p) return null;
        const ws = await createWorkspace(
          await runtimeOptions(p, (slot) => {
            // A job run's slot: that run, in its scope (P3); never a lane's task.
            const jobs = jobsHost;
            if (slot && jobs && isJobSlot(slot.key)) return Promise.resolve(jobs.runningOf(slot.key));
            return slot ? runningTask(slot) : Promise.resolve(null);
          }),
        );
        // A new workspace: the material queue goes on (in this base), and its commits reach the file timelines, as with
        // a new runtime.
        announceCommits(ws.history);
        kickMaterial();
        return ws;
      },
      turnDeps,
      checkTurn: async () => {
        await checkTurn();
        // A lane let in while an undo runs waits for it: it never edits a file being put back.
        while (restores.turnBlocked()) await new Promise((r) => setTimeout(r, 50));
      },
      chatLog: (chat, task) => turnChatLog(chat, task),
      taskDeps,
      scoped,
      scopeExists: activeScope,
      emit,
      send: sendToWindow,
      label: (t) => (t.action && Object.hasOwn(harness.actions, t.action) ? harness.actions[t.action].label : (t.question ?? "").slice(0, 60)),
      // A lane's note commits its file alone (parallel spec §5.3).
      saveOwn: async (paths, message, trailer) => saveAppChange(await currentHistory(), true, paths, message, trailer),
      attention: buildTaskAttention(),
    },
    { engineId: c.engineId, parallel: c.parallel },
  );
}

/**
 * The jobs' wiring (part 3) over the app's own: the brief from the harness folder, the task deps' notes, data and
 * material for the first message, the active scopes. `workspace` is single mode's or the board's.
 */
function buildJobsHost(gate: TurnGate, workspace: () => Promise<HarnessWorkspace>): JobsHost {
  return createJobsHost({
    jobs: harness.jobs ?? {},
    actions: harness.actions,
    // Only a prompt job's run reads a brief; a recipe has none (a job declares prompt or steps).
    readBrief: (job) => (job.prompt !== undefined ? fs.readFile(resolveInHarness(harness, job.prompt), "utf8") : Promise.reject(new Error("A recipe has no brief"))),
    workspace: async () => {
      if (quitting) throw new Error("The app is closing");
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      await checkTurn();
      // As a lane's turn: a run never edits a file an undo is putting back.
      while (restores.turnBlocked()) await new Promise((r) => setTimeout(r, 50));
      return workspace();
    },
    gate,
    base: currentBase,
    // A job is not a task (replaceable-parts §8 fixes ids per task): its picks read config.json's ids, as material does.
    taskDeps: { ...taskDeps, profileFor: async (a, f, t) => taskDeps.profileFor!(a, f, t, (await config.load()).policies) },
    scoped,
    scopes: async () => {
      const c = await validConfig();
      if (!c) return [];
      if (!scoped()) return [MAIN_SCOPE];
      return (await scopeStoreFor(baseOf(c)).list()).filter((sc) => !sc.archived).map((sc) => sc.id);
    },
    scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
    // A scoped run reaches its own scope's linked folders, checked as a task's turn (hatches). None without (D0).
    ...(hasLinkedFolders(harness)
      ? { linked: { access: async (sc: string) => linked_()?.access.access(sc), section: async (sc: string) => (await linked_()?.access.section(sc)) ?? "" } }
      : {}),
    engine: async () => (await config.load()).engineId ?? "",
    // Settings › Jobs, read at each trigger: a change applies from the next one, without a restart.
    settings: (id) => jobSettings?.[id],
    changed: jobsChanged,
    // Needs-you results in the base's shared store (Task 8), and the Dock badge.
    attention: async (b) => sharedAttention?.forBase(b, true) ?? null,
    needsYouChanged: () => void refreshJobBadge(),
    // A recipe's tools (tools spec §7): only with tools (D0). toolsHost is set before "ready", so before this runs.
    ...(toolsHost ? { tools: recipeTools(toolsHost) } : {}),
  });
}

/**
 * What a recipe run needs of the tools host (tools spec §7): its registry, the run's trailer on its calls, the job's
 * limits, the run's last tool call (trace notes, such as an AI round's, skipped) and the AI step's brief.
 */
function recipeTools(t: ToolsHost): NonNullable<JobsHostDeps["tools"]> {
  return {
    registry: t.registry,
    withRunTrailer: (trailer, fn) => t.withRunTrailer(trailer, fn),
    limits: (job) => jobLimits(harness, job),
    lastCall: async (run) => lastCallOf(await t.trace(run)),
    readAiBrief: (p) => fs.readFile(resolveInHarness(harness, p), "utf8"),
  };
}

/**
 * `single` mode (Decision 12): the gate (tasks 1, the jobs' cap beside), today's TurnController through its `tasks` cap,
 * and the jobs host on the runtime's workspace.
 */
function buildSingleJobs(c: AppConfig): JobsHost {
  const gate = singleGate(c.engineId, c.parallel);
  gate.setBeforeStart(singleBeforeStart(c.engineId, singleMainSlot));
  single = { gate, turns: singleTurns(gate, turns, emit) };
  return buildJobsHost(gate, async () => {
    const rt = await runtime.get();
    const parts = rt ? singleParts.get(rt) : undefined;
    if (!parts) throw new Error("The engine isn't installed");
    return parts.workspace;
  });
}

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
 * Board mode's waiting tasks (parallel spec §9.2, Decisions 10–11): an item in the base's shared Attention store, the
 * Dock badge (with the plugins' count) and, when Settings › General asks and the window isn't focused, a notification
 * whose click shows that task. Only a count and the task's label leave the board (P4).
 */
function buildTaskAttention(): TaskAttention {
  const attention = new TaskAttention({
    store: async () => {
      const base = await currentBase().catch(() => null);
      return base && sharedAttention ? sharedAttention.forBase(base, true) : null;
    },
    badge: setDockBadge,
    notify: ({ title, body }, id) => {
      if (!Notification.isSupported()) return;
      const n = keepNotification(new Notification({ title, body }), notifications);
      n.on("click", () => {
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
        void host?.board.focus(id).catch((err: unknown) => console.error("Could not show the waiting task", err));
      });
      n.show();
    },
    notifyOn: async () => (await config.load()).notifyWaiting === true,
    windowFocused: () => (window && !window.isDestroyed() ? window.isFocused() : false),
    otherCount: () => pluginBadge + jobBadge,
  });
  taskAttention = attention;
  return attention;
}

/** What the linked-folder channels need (hatches spec §3.2); built only for a harness with linked folders. */
function linkedIpcDeps(): LinkedIpcDeps {
  // Made once: the turns' scope access (linked_) shares these deps, so the prune runs once and one signing writes.
  if (linkedDeps) return linkedDeps;
  const userData = app.getPath("userData");
  // Histories unlinked over 30 days ago go to the Trash first: no link handler runs before, so a relink never races it.
  const ready = pruneUnlinked(userData, new Date(), (d) => shell.trashItem(d)).catch((err: unknown) =>
    console.error("Could not prune the linked folders' histories", err),
  );
  linkedDeps = {
    linkedFolders: harness.linkedFolders ?? {},
    store: scopeStore,
    // Links are signed per profile id (never its folder's path, so a move keeps them); "" without profiles.
    profile: async () => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      return profilesOn() ? (c.profile ?? "") : "";
    },
    // With profiles, every other profile's registry: a folder another profile changes or tracks counts.
    otherStores: async () => {
      const c = await validConfig();
      if (!c || !profilesCtl) return [];
      const out: { profile: string; store: ScopeStore }[] = [];
      for (const p of (await profilesCtl.state()).list) {
        const b = baseFor({ folder: c.folder, profile: p.id }, true);
        if (b !== null && p.id !== c.profile) out.push({ profile: p.id, store: scopeStoreFor(b) });
      }
      return out;
    },
    context: async () => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      return { home: os.homedir(), folder: baseOf(c), ...(profilesOn() ? { root: c.folder } : {}) };
    },
    references: async () => {
      const c = await validConfig();
      return c ? (await workReferences(c, baseOf(c))).map((r) => r.path) : [];
    },
    pick: async () => {
      if (!window || window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    userData,
    signing: linkedSigning(userData),
    now: () => new Date(),
    ready,
    changed: async () => {
      await scopesChanged();
      // AGENTS.md lists the open scope's folders: rewritten now when no task is open, else between tasks (never lost).
      void linked_()?.instructions.changed();
    },
    unsupported: () => linkedUnsupported,
    // Scope settings opening checks git again (Decision 13), as the scope's opening does.
    checkGit: async (scope) => linked_()?.access.checkGit(scope),
    dropped: async (scope) => (await linked_()?.access.dropped(scope)) ?? new Map(),
    linkedHistory: async () => {
      const linked = linked_();
      if (!linked) return { uncovered: [], tasks: {} };
      const scope = await tasks.currentScope();
      return linkedHistoryView(await linked.access.entries(scope), scope, harness.linkedFolders ?? {}, openLinked, isGitRepo);
    },
  };
  return linkedDeps;
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
 * The Engine config channels' deps (hatches spec §5.3), made only when they are registered (enginePresets). Approving
 * signs with the links' key, made then if there is none yet, for the same profile id the host checks it with.
 */
function engineIpcDeps(): EngineIpcDeps {
  const host = engineHost_()!;
  const userData = app.getPath("userData");
  return {
    current: (scope) => host.current(scope),
    store: async () => {
      const c = await validConfig();
      if (!c) throw new Error("The folder is not set up");
      return { store: scopeStoreFor(baseOf(c)), profile: profilesOn() ? (c.profile ?? "") : "" };
    },
    secret: () => linkedSecret(userData)(true),
    epochs: (engineEpochs ??= new EngineEpochs(path.join(userData, EPOCHS_FILE))),
    codexLimit: () => harness.engines.includes("codex"),
    activeEngine: async () => (await config.load()).engineId ?? "",
    send: sendToWindow,
  };
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
});
const announceCommits = (history: History) => commitAnnouncements.watch(history);

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
    const cleaned: AppConfig = input.models !== undefined ? { ...input, models: cleanModels(input.models) } : input;
    // Parallel spec §7: the same for the caps; with none valid the key goes (the saved caps stay).
    const { parallel: caps, ...rest } = cleaned;
    const kept = caps !== undefined ? cleanCaps(caps) : undefined;
    const capped: AppConfig = caps === undefined ? cleaned : { ...rest, ...(kept ? { parallel: kept } : {}) };
    // Part 3: Settings › Jobs keeps only the harness's own jobs, each cleaned ({} turns every one back on); without
    // jobs the key goes (D0).
    const { jobs: jobChoices, ...noJobs } = capped;
    const declared = harness.jobs;
    const keptJobs = jobChoices !== undefined && declared && hasJobs(harness) ? cleanJobs(jobChoices, (id) => Object.hasOwn(declared, id)) : undefined;
    const patch: AppConfig = jobChoices === undefined ? capped : { ...noJobs, ...(keptJobs ? { jobs: keptJobs } : {}) };
    const before = await config.load();
    const baseBefore = pluginsCtl ? await currentBase() : null;
    // Spec §9: an engine is only used once its notice is accepted.
    await requireNoticeForChoice(patch.engineId, before.engineId, hasNotice);
    // A new folder: refused while a turn or a restore runs, and turns are refused until it is over; the old
    // folder's task ends and its runtime goes.
    try {
      await saveWithFolderChange(patch.folder, before.folder, { isBusy: hold.folderBusy, guards, interrupt: interruptTasks, dropRuntime }, () =>
        saveConfigPatch(patch, before),
      );
      if (patch.folder !== undefined && patch.folder !== before.folder) {
        // The reader's watches were checked against the old folder.
        documentSessions.closeAll();
        if (before.folder) dropDataStoresUnder(before.folder);
        await settleScopes()
          .then(scopesChanged)
          .catch((err: unknown) => console.error("Could not prepare the scopes", err));
      }
    } finally {
      // Set up now, or another folder: the plugins follow the base, even when something above threw after the save.
      if (pluginsCtl && (await currentBase().catch(() => null)) !== baseBefore) await rebasePlugins();
    }
    // Set up now (or in a new folder): its setup.json is on file before the window can start a task (the interview's).
    await recordSetup(setupCtl, async () => (await validConfig()) !== null);
    // Set up for the first time in this process: the jobs' start runs (Decision 7). Without jobs, nothing.
    void jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
    // The backend starts now that the app is set up, or follows a new folder. Without one, nothing (D0).
    const folderChanged = patch.folder !== undefined && patch.folder !== before.folder;
    void (folderChanged ? backendRebase() : backendReady()).catch((err: unknown) => console.error("Could not start the backend", err));
    if (patch.appearance) applyAppearance(patch.appearance);
    if (patch.textSize) applyTextSize(patch.textSize);
    // Board mode: the person's caps reach the running gate at once (parallel spec §7), under the engine's hold.
    if (host && patch.parallel !== undefined) host.capsChanged((await config.load()).parallel);
    // Settings › Jobs reach the scheduler at once (its next trigger reads them), and the Jobs section and badge follow.
    jobSettings = (await config.load()).jobs;
    if (patch.jobs !== undefined) {
      jobsChanged();
      void refreshJobBadge();
    }
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
    // Board mode: the focused task's own chat, and its turn still running to replay (read last).
    if (host) return { ...(switchedFrom ? { switchedFrom } : {}), ...(await host.loadChat(baseOf(c))) };
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
    // Linked folders: a folder that gained or lost git is marked (Decision 13); AGENTS.md lists the new scope's folders.
    const linked = linked_();
    if (linked && opened) {
      void (async () => {
        if (id !== null) await linked.access.checkGit(id).catch((err: unknown) => console.error("Could not check the linked folders' git", err));
        await linked.instructions.changed();
      })();
    }
    return opened;
  });
  // Linked folders (hatches spec §3.2): only a harness that declares them has these channels, or its key (D0).
  if (hasLinkedFolders(harness)) registerLinkedIpc(handle, linkedIpcDeps());
  // A scope's engine config (hatches spec §5.3): only a harness that declares `enginePresets` has these channels (D0).
  if (hasEnginePresets(harness)) engineIpc = registerEngineIpc(handle, engineIpcDeps());
  if (hasEnginePresets(harness)) void pruneEngineConfig();
  // The harness's backend (hatches spec §4): only a harness that declares one has a supervisor and these channels (D0).
  if (hasBackend(harness)) {
    const backendLog = new BackendLog(app.getPath("userData"));
    backend = backendFor(harness, {
      // On the launcher the MCP servers use; the entry's real path must stay inside the harness folder (B1).
      startProcess: (init, onEvent) =>
        BackendProcess.start({
          launcher: electronLauncher(process.execPath),
          entry: resolveInHarness(harness, harness.backend!),
          cwd: harness.root,
          init,
          log: backendLog,
          onEvent,
        }),
      send: sendToWindow,
      log: backendLog,
      mainLog: (message, err) => console.error(`[backend] ${message}`, err ?? ""),
    });
    if (backend) registerBackendIpc(handle, { supervisor: backend });
  }
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
  // Sidekick (sidekick spec §7): malformed requests are refused before the controller; a bad review sends as typed.
  registerSidekickIpc(handle, () => sidekickCtl);
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
  handle("hh:materialRetry", (scope: unknown, id: unknown) => materialSvc?.retry(scope, id) ?? noMaterial);
  handle("hh:materialRemove", (scope: unknown, id: unknown) => materialSvc?.remove(scope, id) ?? noMaterial);
  handle("hh:materialDecide", (scope: unknown, id: unknown, fragment: unknown, choice: unknown) => materialSvc?.decide(scope, id, fragment, choice) ?? noMaterial);
  handle("hh:materialCite", async (scope: unknown, id: unknown) => (materialSvc ? materialSvc.cite(scope, id) : null));
  handle("hh:materialOpen", (scope: unknown, id: unknown) =>
    openMaterial(materialSvc, scope, id, (file) => shell.openPath(file), (file) => shell.showItemInFolder(file)),
  );
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
  // The reader (document-reader spec §5.3): it only ever reads, inside the folder or a reference folder. Every input
  // is untrusted (documents.ts checks its shape first) and every failure is an answer, never a thrown error.
  handle("hh:readDocument", async (rel: unknown): Promise<DocumentRead> => {
    try {
      const roots = await documentRoots();
      if (!roots) return { ok: false, reason: "not-ready" };
      return await readDocument(rel, roots);
    } catch (err) {
      console.error("Could not read the document", err);
      return { ok: false, reason: "missing" };
    }
  });
  handle("hh:readImage", async (rel: unknown): Promise<string | null> => {
    try {
      const roots = await documentRoots();
      return roots ? await readImage(rel, roots) : null;
    } catch {
      return null;
    }
  });
  handle("hh:documentsExist", async (paths: unknown): Promise<boolean[]> => {
    if (!Array.isArray(paths)) return [];
    // Too many to check: none counts as there (one answer per path, as the window expects).
    if (paths.length > MAX_EXIST_PATHS) return paths.map(() => false);
    try {
      const roots = await documentRoots();
      return roots ? await documentsExist(paths, roots) : paths.map(() => false);
    } catch {
      return paths.map(() => false);
    }
  });
  handleFrom("hh:watchDocument", async (sender, rel): Promise<number | null> => {
    try {
      const roots = await documentRoots();
      return roots ? await documentSessions.watch(sender.id, rel, roots) : null;
    } catch {
      return null;
    }
  });
  handleFrom("hh:unwatchDocument", (sender, id) => documentSessions.unwatch(sender.id, id));
  // Reviews (review spec §5.6): every answer is data; nothing reaches the service unless the agent may edit the folder (D0).
  handleAll(reviewHandlers(reviews, () => harness.permissions.edit === "folder"));
  // File timelines (file-timeline spec §6.3): every harness (Q1); every answer is data.
  handleAll(fileHandlers(fileTimelines));
  handleAll(contextHandlers(contextSvc));
  // Language on demand (plan 5b): every answer is data; the state is pushed on hh:language.
  if (translation) handleAll(languageHandlers(translation));
  // Cancels the turn and stops the task operation (a closing turn never goes on to the next task).
  handle("hh:cancel", () => tasks.cancel());
  const historyGroups = async () => {
    const history = await currentHistory();
    return history ? historyView(await history.tasks()) : [];
  };
  /**
   * The groups "Undo this task" acts on: the panel's, and with tracked linked folders theirs too (a task or a later
   * task that changed only a linked folder, hatches spec §3.4). Without linked folders, exactly the panel's (D0).
   */
  const undoGroups = async (taskId: string) => {
    const main = await historyGroups();
    if (!linked_()) return main;
    const refs = await linkedHistoriesOf(main.find((g) => g.taskId === taskId)?.scopeId);
    if (refs.length === 0) return main;
    return mergeTaskGroups(main, await Promise.all(refs.map(async (r) => ({ key: r.key, groups: historyView(await r.history.tasks()) }))));
  };
  // Every go-back (one file, the whole folder, one task) asks first with main's native dialog (go-back.ts).
  // Restore commits carry no task: going back may undo several tasks, so it belongs to none of them.
  // A restore changes tracked files with no data event: the settings may have changed.
  const goBacks = goBackHandlers<WebContents>({
    confirm: confirmGoBack,
    blocked: () => quitting || tasks.isBusy() || hold.restoreHeld() !== null,
    groups: historyGroups,
    restorePoint: (sha) => restoreWith((history) => history.restore(sha, RESTORE_POINT)).then(afterRestore),
    taskGroups: undoGroups,
    restoreTask: (taskId) => {
      // Something was restored: the settings may have changed, even when a linked folder then failed.
      let touched = false;
      return restoreWith(async (history) => {
        const group = (await history.tasks()).find((g) => g.taskId === taskId);
        // Its tracked linked folders too (hatches spec §3.4); none without linked folders (D0).
        const linkedRefs = await linkedHistoriesOf(group?.scopeId);
        if (!group?.start && linkedRefs.length === 0) throw new Error("Nothing to go back to");
        if (group?.start) {
          await history.restore(group.start, RESTORE_TASK);
          touched = true;
        }
        if (linkedRefs.length === 0) return;
        touched = true;
        let restored: number;
        try {
          restored = await restoreLinkedTask(linkedRefs, taskId, RESTORE_TASK);
        } catch (err) {
          // A failure there is logged and fails the undo (the window's generic failure).
          console.error("Undo covered the work folder but not its linked folders", err);
          throw err;
        }
        if (!group?.start && restored === 0) throw new Error("Nothing to go back to");
      }).then(afterRestore, (err: unknown) => {
        if (touched) afterRestore();
        throw err;
      });
    },
    file: fileTimelines,
  });
  // Every go-back but "Undo this task" as master registers it; that one also undoes by paths below.
  for (const channel of Object.keys(goBacks) as (keyof typeof goBacks)[]) if (channel !== "hh:restoreTask") handleFrom(channel, goBacks[channel]);
  // The panel's rows; with tracked linked folders, a task that changed only one of them too (hatches spec §3.4), so it
  // can be undone. Without linked folders, exactly the work folder's (D0); a linked folder that can't be read adds none.
  handle("hh:historyTasks", async () => {
    const main = await historyGroups();
    if (!linked_()) return main;
    try {
      const refs = await linkedHistoriesOf(undefined);
      if (refs.length === 0) return main;
      return linkedOnlyRows(main, await Promise.all(refs.map(async (r) => ({ key: r.key, groups: historyView(await r.history.tasks()) }))));
    } catch (err) {
      console.error("Could not read the linked folders' history", err);
      return main;
    }
  });
  handleFrom("hh:restoreTask", async (sender, taskId: unknown, includeShared?: unknown) => {
    // Board mode (Decision 12): only the task's own paths (its shared ones after the person's confirm), refused while
    // its own lane runs, or a running turn touched one of them (P2). Other lanes go on meanwhile.
    // `single` mode the same (part 3 Decision 12): a job's commits sit between the task's, and a job run is undone alone.
    const byPaths = undoByPaths();
    // Plain mode: the whole folder back to the task's start, after main's native confirmation (go-back.ts).
    if (!byPaths) return goBacks["hh:restoreTask"](sender, taskId);
    const { id, includeShared: withShared } = restoreTaskArgs(taskId, includeShared);
    const task = (await undoGroups(id)).find((g) => g.taskId === id);
    if (!task) return { refused: { reason: "nothing" as const } };
    if (quitting || hold.restoreHeld() !== null) throw new Error("Going back can't run now");
    // Main's native dialog too; by paths no later task is undone, so none is listed.
    if (!(await confirmGoBack(sender, { kind: "task", task, later: [] }))) return CANCELLED;
    let result: Awaited<ReturnType<typeof restoreTaskWithLinked>> | null = null;
    await restores.run(
      currentHistory,
      async (history: History) => {
        // With tracked linked folders, each of them by paths too (hatches spec §3.4); without, today's (D0).
        const linkedRefs = await linkedHistoriesOf(task.scopeId);
        result =
          linkedRefs.length > 0
            ? await restoreTaskWithLinked(history, linkedRefs, id, { running: byPaths.running, linkedRunning: byPaths.linkedRunning, includeShared: withShared })
            : await restoreTaskByPaths(history, id, { running: byPaths.running, includeShared: withShared });
      },
      { busy: () => byPaths.busy(id) },
    );
    const r = result!;
    // A refusal is an answer, not an error: the window says why, naming the file (spec §5.3). A partial undo (linked
    // folders) restored some folders: the settings may have changed.
    if (!r.ok) {
      if (r.reason === "partial") afterRestore();
      return { refused: undoRefusalOf(r) };
    }
    afterRestore();
    return { ok: true };
  });
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
    // A step the person runs in Terminal (OpenCode's provider picker) is never run by the app.
    if (runsInTerminal(engine, step)) return { ok: false };
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
      const cmd = fakeSetupResult(hooks, engineId) ? { command: [], env: {} } : await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) });
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
    // The 30-day spend reads every line, not only the latest 500 (OpenCode; spec §4).
    const reportsCost = !isMockEngine(hooks, c.engineId) && getEngine(c.engineId).reportsCost === true;
    if (ids && c.profile) {
      const logs = await Promise.all(ids.map(async (id) => [id, engineOnly(recentUsage(await new UsageLog(profileDir(c.folder, id)).load(Infinity), 500))] as const));
      const folders = ids.map((id) => profileDir(c.folder, id));
      return withSpent(profilesUsage(Object.fromEntries(logs), c.profile, primary), folders, c.engineId, reportsCost);
    }
    return withSpent(summarizeUsage(engineOnly(recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 500)), primary), [baseOf(c)], c.engineId, reportsCost);
  });
  handle("hh:revealSharedConfig", () => shell.showItemInFolder(shared.path));
  // Installing by hand: copy the official command (chosen here by engine id) and open Terminal,
  // where the user pastes it. Nothing is run for them.
  handle("hh:copyInstallCommand", (engineId: string) => clipboard.writeText(installCommandOf(engineFor(engineId))));
  handle("hh:copySetupCommand", async (engineId: string, step: unknown) => {
    if (step !== "login" && step !== "logout") throw new Error("Unknown setup step");
    await copySetupStep(engineFor(engineId), step, {
      copy: (text) => clipboard.writeText(text),
      forgetVerified: async (id) => {
        await shared.update(id, { verifiedAt: null });
      },
    });
  });
  handle("hh:openTerminal", async () => {
    const terminal = terminalCommand(process.platform);
    if (!terminal) throw new Error("No Terminal app to open here");
    await new Promise<void>((resolve, reject) => execFile(terminal.command, terminal.args, (err) => (err ? reject(err) : resolve())));
  });
  handle("hh:resetSharedConfig", async () => {
    // A reset drops the engine set-up: a translation run must not keep using it.
    await translation?.stop().catch((err: unknown) => console.error("Could not stop the translation", err));
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
      ...(pluginStateRoot ? { pluginStateRoot } : {}),
      ops: { trash: (p) => shell.trashItem(p) },
    };
    // Checked and set with no await in between, so two requests can't both start a move.
    if (moving) return { ok: false, error: "busy" };
    let pluginsStopped = false;
    let backendStopped = false;
    const run = guardedMove({
      guards,
      isBusy: hold.folderBusy,
      precheck: () => precheckMove(c.folder, to, deps),
      quitting: () => quitting,
      // Board mode: each open task's checkpoint, one at a time, then the queues pause until the move ends (Decision 15).
      checkpoint: () => (host ? host.board.checkpointAllBeforeMove() : plainTasks.checkpointBeforeMove()),
      holdHistory: (held) => (historyHeld = held),
      flush: async () => {
        await flushTurns();
        // The file indexes waiting to be written go with the history, not after it.
        await flushFileIndexes();
      },
      // The plugins work on the old folder too: stopped with the runtime, started again after (rebase, below).
      closeRuntime: async () => {
        await closeRuntime();
        pluginsStopped = true;
        await pluginsCtl?.stop().catch((err: unknown) => pluginLog("Could not stop the plugins before the move", err));
        // The backend works in the old folder too: stopped with the runtime, started again after (below).
        backendStopped = backend !== null;
        await backend?.stop().catch((err: unknown) => console.error("Could not stop the backend before the move", err));
      },
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
      // Done, refused or failed (guardedMove may return before its checkpoint): the queues go on.
      host?.board.moveEnded();
      // Moved or not, the plugins start again in whichever folder is the app's now.
      if (pluginsStopped) await rebasePlugins();
      // Moved or not, the backend starts again in whichever folder is the app's now (never while quitting).
      if (backendStopped) void backendRebase().catch((err: unknown) => console.error("Could not start the backend after the move", err));
      // The reader's watches were checked against the folder as it was.
      documentSessions.closeAll();
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
  // Read now: once closed, the window's webContents can no longer be asked.
  const contentsId = win.webContents.id;
  win.on("closed", () => {
    if (window === win) window = null;
    documentSessions.closeOwner(contentsId);
  });
  // The agent may have edited attention.json (no listener fires for it): the inbox is read again when the window comes back.
  const plugins = pluginsCtl;
  if (plugins) {
    // Every app window, once a plugin with panels has started: the panel-only handler, the request filter and the
    // frame guard (D0: none without plugins, none while no plugin with panels has run).
    pluginPanels.window(win);
    win.on("focus", () => {
      void plugins.attention.view().then(
        (view) => sendToWindow("hh:attention", view),
        (err: unknown) => pluginLog("Could not read the Attention inbox", err),
      );
    });
  }
  // A reload starts a new page with no watches of its own: the old page's go.
  win.webContents.on("did-navigate", () => documentSessions.closeOwner(contentsId));
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
        // Board mode: a refusal (a lane runs a turn) throws, so the change stays stale for the next gap.
        if (host) return host.refreshInstructions();
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      changed: (state) => sendToWindow("hh:settings", state),
    });
  }
  // Sidekick is core (sidekick spec D1): every harness gets the controller; it does nothing while off.
  sidekickCtl = new SidekickController({
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
    protocol.registerSchemesAsPrivileged(hasTools(harness) ? [PLUGIN_SCHEME, TOOL_SCHEME] : [PLUGIN_SCHEME]);
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
      changed: (view) => sendToWindow("hh:plugins", view),
      attentionChanged: (view) => {
        sendToWindow("hh:attention", view);
        pluginBadge = view.badge;
        refreshDockBadge();
      },
      surfaceChanged: (view) => sendToWindow("hh:pluginSurface", view),
      panelsNeeded: () => pluginPanels.needed(),
      dataChanged: (plugin, collections) => sendToWindow("hh:pluginData", { plugin, collections }),
      log: pluginLog,
    });
  }
  // Settings › Connections (tools spec §9): only a harness that declares secrets (D0: no channel, no controller).
  if (hasSecrets(harness)) registerConnectionsIpc(handle, connections());
  // Tools (tools spec §4, §5): only a harness that declares them. D0: otherwise no scheme, no window, no IPC handler,
  // no `tools` server and no trace.
  if (hasTools(harness)) {
    // Before "ready". Electron takes one call: with plugins, theirs above registers this scheme too.
    if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0) protocol.registerSchemesAsPrivileged([TOOL_SCHEME]);
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
      changed: (state) => sendToWindow("hh:profiles", state),
      blocked: hold.profileChangeBlocked,
    });
  }
  materialSvc = await buildMaterial();
  materialJobs = materialSvc ? buildMaterialJobs(materialSvc) : null;
  translation = buildTranslation();
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
    // Development builds: the harness's logo in the Dock, else Human Harness's (packages/shell/resources).
    if (process.platform === "darwin" && !app.isPackaged) {
      const icon = devDockIcon(
        [() => (harness.logo ? resolveInHarness(harness, harness.logo) : undefined), () => path.join(shellResources, "hh-logo.png")],
        (file) => nativeImage.createFromPath(file),
      );
      if (icon) app.dock?.setIcon(icon);
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
      const board = buildBoardHost(await config.load());
      host = board;
      tasks = board.board;
    }
    // Jobs (part 3): beside the board's lanes, or beside the single task (Decision 12). Without jobs, nothing (D0).
    if (hasJobs(harness)) {
      const board = host;
      jobsHost = board
        ? buildJobsHost(board.gate, async () => {
            const ws = await board.workspace();
            if (!ws) throw new Error("The engine isn't installed");
            return ws;
          })
        : buildSingleJobs(await config.load());
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
    // The test prompt cleans up (its CLI, its temporary folder) before the app goes; bounded wait.
    const testStopped = Promise.race([guards.close(), new Promise<void>((r) => setTimeout(r, QUIT_TEST_WAIT_MS))]);
    const setupStopped = setupRun ? stopSetupProcess(setupRun) : Promise.resolve();
    void (async () => {
      // A folder move under way finishes (or undoes itself) first: it is never cut short on purpose.
      await moving?.catch(() => undefined);
      await Promise.all([setupStopped, testStopped]);
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
    })().finally(() => app.quit());
  });
}
