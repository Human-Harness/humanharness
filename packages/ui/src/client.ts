import type { Effort, ModelChoice, ModelSpec, ModelsConfig } from "@humanharness/engines";
import type { ActionCost, ChoiceOption, Language, LocalizedText, Tier } from "@humanharness/harness-sdk";
import type { ActivityKind, EngineError, Event, LimitWindow } from "@humanharness/runtime";

export type Appearance = "system" | "light" | "dark";

export interface AppConfig {
  language?: Language;
  folder?: string;
  engineId?: string;
  /** Settings → General → Appearance. Absent means follow the system. */
  appearance?: Appearance;
  /** Settings › Modelos: each task's tier or custom model, and the tier tables per engine. Cleaned when read. */
  models?: ModelsConfig;
}

export interface EngineOption {
  id: string;
  name: string;
  status: "allowed" | "pending";
  /** Company that runs the service (legal notice). */
  provider: string;
  requires: LocalizedText;
  dataLocation: LocalizedText;
  trainsOnData: LocalizedText;
  termsUrl: string;
  privacyUrl: string;
  /** Whether the engine reports plan-limit windows (Claude) or only tokens (Codex). */
  reportsLimits: boolean;
  /** The official install command, shown before the app runs it. */
  installCommand?: string;
  installDocsUrl?: string;
  /** The engine's logo as a data: URL (the main process reads the file). */
  logo?: string;
}

export interface ActionOption {
  label: LocalizedText;
  /** One line under the label on the topic card. */
  description?: LocalizedText;
  cost: ActionCost;
  /** The tier the harness recommends for the action. */
  tier?: Tier;
}

/** A read-only reference folder, as the work screen shows it ("~/…" for paths in the home folder). */
export interface ReferenceView {
  id: string;
  label: LocalizedText;
  path: string;
}

export interface AppState {
  harness: {
    id: string;
    name: LocalizedText;
    languages: Language[];
    tagline?: LocalizedText;
    /** The harness logo as a data: URL; absent means the Human Harness H. */
    logo?: string;
    /** Who made the harness (manifest `author`), for "made by … with Human Harness". */
    author: string;
    /** Donation link (manifest `donate`), for the Support button. */
    donate?: string;
    version: string;
  };
  config: AppConfig;
  /** Absolute suggested folder (e.g. ~/Documents/Demo). */
  suggestedFolder: string;
  engines: EngineOption[];
  /** The harness's declared actions, by id. */
  actions: Record<string, ActionOption>;
  /** The guided path: action ids in order. */
  path?: string[];
  /** Folders the agent can read but never change. */
  references?: ReferenceView[];
  /** Settings › Modelos. */
  models?: ModelsView;
}

/** What Settings › Modelos needs (resources spec §7). */
export interface ModelsView {
  /** The tier the harness recommends, by task key (action id, or "questions"). */
  recommended: Record<string, Tier>;
  /** The core's tables, by engine id. */
  defaults: Record<string, Record<Tier, ModelSpec>>;
  /** What each engine offers: model ids (empty: only the engine's default) and efforts. */
  offered: Record<string, { models: ModelChoice[]; efforts: Effort[] }>;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: { name: string; data: unknown }[];
  activities: { kind: ActivityKind; detail: string }[];
  at: string;
  error?: EngineError;
  /** User entries: the manifest action that started the turn. */
  action?: string;
  /** Assistant entries: tokens the engine reported for the turn. */
  usage?: TurnUsage;
  /** Assistant entries: plan-limit windows reported during the turn. */
  limits?: LimitWindow[];
  /** Assistant entries: latest data of each state-only block emitted during the turn. */
  state?: Record<string, unknown>;
  /** The engine the app was set to when the entry was saved. */
  engine?: string;
  /** The task the entry belongs to (flow mode shows one task at a time). */
  task?: string;
}

export interface ChatLoad {
  entries: ChatEntry[];
  /** Set when the folder's last session ran on another engine: that chat was archived. */
  switchedFrom?: string;
}

export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
}

/** A file a task added, changed or deleted. */
export interface HistoryFileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** One row of the History panel: a task's commits, or the "Earlier" group (`taskId: null`). */
export interface HistoryTaskView {
  taskId: string | null;
  actionId: string | null;
  /** What "Go back to before this task" restores; null when there is nothing before it. */
  start: string | null;
  end: string;
  /** ISO date of the task's last commit. */
  date: string;
  /** The title of the note the task saved, if any. */
  noteTitle?: string;
  changes: HistoryFileChange[];
  /** Newest first. */
  entries: HistoryItem[];
}

/** Why a folder can't be the harness folder. */
export type FolderProblem = "not-absolute" | "root" | "home" | "too-broad" | "protected";

/** A folder the user picked, and why it can't be used (null when it can). */
export interface FolderPick {
  folder: string;
  problem: FolderProblem | null;
}

export interface EngineStatus {
  engineId: string;
  installed: boolean;
  version: string | null;
  minVersion: string;
  outdated: boolean;
  /** Null when the CLI has no status check (or it wasn't run because the CLI is outdated). */
  loggedIn: boolean | null;
  noticeAccepted: boolean;
  /** A test prompt has succeeded on this computer. */
  verified: boolean;
}

export type EngineProblem = "notice" | "not-installed" | "outdated" | "logged-out" | "untested";

/** The first thing left to do before the engine can run turns, or null when it is ready. */
export function engineProblem(s: EngineStatus): EngineProblem | null {
  if (!s.noticeAccepted) return "notice";
  if (!s.installed) return "not-installed";
  if (s.outdated) return "outdated";
  if (s.loggedIn === false) return "logged-out";
  if (!s.verified) return "untested";
  return null;
}

export type SetupStep = "install" | "update" | "login" | "logout";

/** Output of a running install, update or login: its lines, and the first web address it printed. */
export type SetupOutput =
  | { kind: "line"; text: string }
  | { kind: "url"; url: string }
  /** A step started or ended (any window may be showing it, or reopen it later). */
  | { kind: "start"; engineId: string; step: SetupStep }
  | ({ kind: "end"; engineId: string; step: SetupStep } & SetupResult);

/** How a setup step ended. `cancelled`: the user stopped it; `timedOut`: it ran too long and was stopped. */
export interface SetupResult {
  ok: boolean;
  cancelled?: boolean;
  timedOut?: boolean;
}

/** The setup step running now in the main process, so a reopened screen can show it. */
export interface RunningSetup {
  engineId: string;
  step: SetupStep;
  /** The first web address the step printed (the sign-in page). */
  url?: string;
}

/** Result of the test prompt. `recorded: false`: it passed, but ~/.humanharness/engines.json couldn't be written. */
export interface TestResult {
  ok: boolean;
  error?: EngineError;
  recorded?: boolean;
}

export interface UsageSummary {
  /** Latest plan-limit windows that haven't reset yet; null when the engine never reported any. */
  limits: LimitWindow[] | null;
  /** Typical share (0..1) of the five-hour window each action used, from the local log. */
  estimates: Record<string, number>;
}

export interface SendOptions {
  /**
   * The manifest action this message starts: a new task, whose first message is the action's brief (the
   * message is what the chat shows). Heavy actions may ask first.
   */
  action?: string;
}

/**
 * Where the current task is: running a turn, waiting for the person, closing (asking for its note), or
 * saving a checkpoint note before the context reaches its cap.
 */
export type TaskStatus = "running" | "waiting" | "closing" | "checkpoint";
/** How an action's last task ended: its note was saved, the closing turn brought none, or it was interrupted. */
export type ActionStatus = "done" | "unsaved" | "unfinished";

export interface CurrentTaskView {
  id: string;
  /** Absent for a free question. */
  action?: string;
  status: TaskStatus;
  /** Context in use by the task's session, and the task's cap (the side panel's meter). */
  context?: { used: number; cap: number };
  /** The plan lacked `model`: the task runs one tier down (`tier`), or on the engine's default model (no `tier`). */
  fallback?: { model: string; tier?: Tier };
}

/** A note in `.harness/notes/`, for the side panel and "Lo que quedó claro". */
export interface NoteView {
  slug: string;
  title: string;
  action?: string;
  date: string;
  summary: string[];
  decisions: string[];
  /** Relative to the folder: `.harness/notes/<slug>.md`. */
  path: string;
}

export interface TaskView {
  current: CurrentTaskView | null;
  actions: Record<string, ActionStatus>;
  /** Newest first. */
  notes: NoteView[];
}

/** The action to start after `current` on the guided path: the next one, or else the first one not done yet. */
export function nextInPath(path: string[], current: string | undefined, statuses: Record<string, ActionStatus>): string | null {
  const i = current ? path.indexOf(current) : -1;
  if (i >= 0 && i + 1 < path.length) return path[i + 1];
  return path.find((id) => id !== current && statuses[id] !== "done") ?? null;
}

/**
 * Files "Open" may hand to the system: text, data and images. Never apps, scripts or installers
 * (`.app`, `.command`, `.sh`, `.pkg`…), which the system would run instead of showing, nor pages,
 * SVGs and JavaScript or TypeScript sources, which may open in a browser or a script runner (macOS
 * may even take `.ts` for a video). Anything else can only be shown in Finder.
 */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv",
  ".css",
  ".png", ".jpg", ".jpeg", ".gif", ".pdf",
]);

/** Whether the app opens this file (by its extension); the rest can only be shown in Finder. */
export function canOpenFile(file: string): boolean {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && OPENABLE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Everything the renderer can ask the main process. Implemented by the preload as `window.hh`. */
export interface HarnessClient {
  getState(): Promise<AppState>;
  /** Null when the user cancelled the dialog. */
  pickFolder(defaultPath: string): Promise<FolderPick | null>;
  saveConfig(patch: AppConfig): Promise<AppState>;
  loadChat(): Promise<ChatLoad>;
  send(message: string, options?: SendOptions): Promise<void>;
  cancel(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
  history(): Promise<HistoryItem[]>;
  restore(sha: string): Promise<void>;
  /** The history grouped by task, newest first; the "Earlier" group last. */
  historyTasks(): Promise<HistoryTaskView[]>;
  /** Makes the folder look as it did before the task started; recorded as a new entry of that task. */
  restoreTask(taskId: string): Promise<void>;
  engineStatus(engineId: string): Promise<EngineStatus>;
  acceptNotice(engineId: string): Promise<void>;
  /** Runs the official install, update, login or logout; resolves when it exits. */
  runSetup(engineId: string, step: SetupStep): Promise<SetupResult>;
  /** Types one line into the running login (e.g. a code the sign-in page shows). */
  setupInput(text: string): Promise<void>;
  cancelSetup(): Promise<void>;
  onSetupOutput(listener: (output: SetupOutput) => void): () => void;
  /** The setup step running now, if any. */
  getSetup(): Promise<RunningSetup | null>;
  /** Sends a tiny prompt to check the engine works; marks it verified when it does. */
  testEngine(engineId: string): Promise<TestResult>;
  /** Copies the engine's official install command, for the user to paste in Terminal. */
  copyInstallCommand(engineId: string): Promise<void>;
  /** Opens the Terminal app (it runs nothing). */
  openTerminal(): Promise<void>;
  /** Shows ~/.humanharness/engines.json in Finder. */
  revealSharedConfig(): Promise<void>;
  /** Starts ~/.humanharness/engines.json over, keeping a dated copy of the old one. */
  resetSharedConfig(): Promise<void>;
  getUsage(): Promise<UsageSummary>;
  /** Shows the configured folder in Finder. */
  revealFolder(): Promise<void>;
  /** The current task, how each action ended, and the notes. */
  getTasks(): Promise<TaskView>;
  onTasks(listener: (view: TaskView) => void): () => void;
  /**
   * The person picked an option of a `choices` block: a follow-up, another topic, or the next one on the path.
   * `task` is the task the block was shown for; a block of an earlier task is refused.
   */
  choose(option: ChoiceOption, task: string): Promise<void>;
  /** Opens a file inside the reference folders or the user's folder in its default app. False when refused or missing. */
  openPath(path: string): Promise<boolean>;
  /** Shows a file inside the reference folders or the user's folder in Finder (any kind of file). False when refused or missing. */
  revealPath(path: string): Promise<boolean>;
}

/** A config with everything a turn needs (appearance stays optional). */
export type ConfiguredApp = AppConfig & Required<Pick<AppConfig, "language" | "folder" | "engineId">>;

export function isConfigured(config: AppConfig): config is ConfiguredApp {
  return Boolean(config.language && config.folder && config.engineId);
}

export type { ChoiceOption, Event, EngineError, LimitWindow };
