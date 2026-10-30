// The view models the core sends the window and the window sends back (replaceable parts §5): data only.
import type { Effort, ModelChoice, ModelSpec, ModelsConfig } from "@humanharness/engines";
import type {
  ActionCost,
  BlockAnswer,
  ChoiceOption,
  DataKey,
  DataRecord,
  DocumentKind,
  InputField,
  InputIssue,
  InputSpec,
  Language,
  RespondResult,
  ScopeMode,
  SettingFieldView,
  SettingsView,
  Tier,
} from "@humanharness/harness-sdk";
import type {
  ActivityKind,
  DocumentCard,
  EngineError,
  Event,
  LimitWindow,
  TaskNotice,
  ToolCallView,
} from "@humanharness/engines";
import type {
  CollectionDiff,
  DataChange,
  DataQuery,
  DataQueryResult,
  FileChange,
  FileDiffView,
  ScopeEntry,
  SyncProvider,
  SyncStatus,
  TimelineAuthor,
  TimelineEntry,
  TimelineKind,
} from "@humanharness/workspace";
import type { AnswerPick, Review, ReviewSummary } from "@humanharness/harness-sdk/review";
import type { GeneratedStrings } from "@humanharness/i18n";
import type { HarnessClient } from "./client";
import type { TEXT_SIZES } from "./shared";

export type { DataKey, DataQuery, DataQueryResult, DataRecord };

export type Appearance = "system" | "light" | "dark";

export type TextSize = keyof typeof TEXT_SIZES;
/** The reader's look (document-reader spec §5.2): global app preferences. */
export interface ReaderPrefs {
  font?: "sans" | "serif";
  size?: "normal" | "large";
}

export interface AppConfig {
  language?: Language;
  folder?: string;
  engineId?: string;
  /** Settings → General → Appearance. Absent means follow the system. */
  appearance?: Appearance;
  /** Settings → General → Text size. Absent means normal. */
  textSize?: TextSize;
  /** The reader's font and text size. Absent until the person changes one (D0). */
  reader?: ReaderPrefs;
  /** Settings › Modelos: each task's tier or custom model, and the tier tables per engine. Cleaned when read. */
  models?: ModelsConfig;
  /** The person said they keep their own copy of the folder: the backup notice stays hidden (Settings › General undoes it). */
  backupDismissed?: boolean;
  /** The person answered the language offer on Home (spec §3): it never shows again. */
  languageOffered?: boolean;
  /** Harnesses with profiles: the active profile's id (profiles spec §4). Only the main process changes it. */
  profile?: string;
  /** Settings › General: the person's caps (parallel spec §7). Absent: the manifest's. Cleaned when read. */
  parallel?: { tasks?: number; jobs?: number };
  /** Settings › General: an OS notification when a task waits for the person. Absent: off. */
  notifyWaiting?: boolean;
  /** Settings › Jobs, by job id: turned off, and the person's daily token cap (over the manifest's). Cleaned when read. */
  jobs?: Record<string, JobSettings>;
}

/** One job's Settings › Jobs entry (parallel spec §8). Absent fields: on, the manifest's cap. */
export interface JobSettings {
  off?: boolean;
  dailyTokens?: number;
}

/** Caps on turns running at once (parallel spec §7). */
export interface ParallelCaps {
  tasks: number;
  jobs: number;
}

/** The harness declares `parallel` (spec §3): several open tasks, the inbox. Absent: one task at a time (D7). */
export interface ParallelInfo {
  /** In force now: the person's (Settings › General) or the manifest's. */
  caps: ParallelCaps;
  /** The manifest's suggestion. */
  suggested: ParallelCaps;
  /** The core inbox and its button show (manifest `inbox`, default true). */
  inbox: boolean;
  /** An OS notification when a task starts waiting (Settings › General; off by default). */
  notifyWaiting: boolean;
  /** Why the caps are held at 1, when they are: the engine isn't shown to run two sessions at once (OpenCode, PT-S5 unverified). */
  heldReason?: "engine";
}

/** One open task as the inbox and a harness's own panel see it (parallel spec §9.1). No paths, no chat content. */
export interface TaskSummary {
  id: string;
  scope: string;
  action: string | null;
  label: string;
  state: "running" | "waiting" | "queued" | "closing" | "checkpoint";
  /** message: the agent finished its turn · answer: an open choices/input block · phase: a phase proposal. */
  waitingFor?: "message" | "answer" | "phase";
  phase?: string;
  startedAt: string;
  tokens: number;
  /** Paths (relative to the folder, as the chat's notice names them) another task also changed (spec §5.3). */
  conflict?: string[];
  /** The focused task (the one the window shows). */
  focused?: true;
}

/** What `tasks.list` answers: the open tasks, the queue pause, and the caps. */
export interface TasksState {
  tasks: TaskSummary[];
  paused?: { reason: "out-of-quota" | "folder-move"; resetsAt?: string };
  caps: ParallelCaps;
}

/** One job × scope (parallel spec §9.1 `JobSummary`). No chat content: its last result's one-line summary only. */
export interface JobSummary {
  id: string;
  label: string;
  /** null: an app-wide job. */
  scope: string | null;
  last?: {
    status: "ok" | "needs-you" | "failed";
    summary: string;
    at: string;
    action?: string;
    /** The run's id, for its steps (tools spec §8.2); only when the harness has tools. */
    run?: string;
  };
  /** The next `every` run, when one is armed. */
  next?: string;
  paused?: "daily-cap" | "off";
  manual: boolean;
  running: boolean;
}

/** The harness declares jobs (spec §3). Absent: no Jobs tab, an empty Jobs section (D0). */
export interface JobsInfo {
  jobs: { id: string; label: string; every?: string; dailyTokens?: number; manual: boolean }[];
}

export interface EngineOption {
  id: string;
  name: string;
  status: "allowed" | "pending";
  /** Company that runs the service (legal notice). */
  provider: string;
  requires: string;
  dataLocation: string;
  trainsOnData: string;
  termsUrl: string;
  privacyUrl: string;
  /** Whether the engine reports plan-limit windows (Claude) or only tokens (Codex). */
  reportsLimits: boolean;
  /** The engine reports each turn's cost in USD (OpenCode). Absent for the others. */
  reportsCost?: boolean;
  /** The person picks the provider inside the engine (OpenCode): the notice says its terms are theirs. */
  userProvider?: boolean;
  /** The engine's guide to choosing a provider. */
  providersUrl?: string;
  /** Steps the person runs in Terminal, with the command to paste. */
  terminalSteps?: { login?: string; logout?: string };
  /** The provider's page of plans (Settings › Uso); never for a mock engine. */
  plansUrl?: string;
  /** The official install command, shown before the app runs it. */
  installCommand?: string;
  installDocsUrl?: string;
  /** The engine's logo as a data: URL (the main process reads the file). */
  logo?: string;
  /** A faked engine in `humanharness dev --mock`, shown as the test engine. */
  mock?: boolean;
}

export interface ActionOption {
  label: string;
  /** One line under the label on the topic card. */
  description?: string;
  cost: ActionCost;
  /** The tier the harness recommends for the action. */
  tier?: Tier;
  /** Harnesses with scopes: "none" runs app-wide; anything else needs an open scope. */
  scope?: ScopeMode;
  /** The modes its task may work in, and how it starts (task-modes spec §3). Absent without modes (D0). */
  modes?: string[];
  defaultMode?: string;
  /** Its phases (task-phases spec §3), as the stepper shows them; never a brief. Absent without phases (D0). */
  phases?: PhaseView[];
  /** Its time box: the lengths offered and the one picked when the person picks none. Absent without one (D0). */
  timeBox?: { options: number[]; default: number | null };
  /** An interview step's action (setup-steps spec §3): no topic card; the setup screen and Settings start it. Absent otherwise (D0). */
  setup?: true;
}

/** A read-only reference folder, as the work screen shows it ("~/…" for paths in the home folder). */
export interface ReferenceView {
  id: string;
  label: string;
  path: string;
}

/** A synced drive (spec 3d §2), and how the folder is kept if the computer is lost (types only: nothing of the workspace runs here). */
export type { SyncProvider, SyncStatus };
/** A synced place on this computer, and the harness's folder inside it. */
export interface SyncLocationView {
  provider: SyncProvider;
  path: string;
  /** Which account of the provider (`ana@example.com`, `Personal`), when its folder name says. */
  account?: string;
  /** `<path>/<the harness's suggested folder name>`: what the first-launch step offers. */
  suggested: string;
}

/** Why moving the folder failed; each has its own card (spec 3d §2 "Errors"). */
export type MoveError = "busy" | "exists" | "inside" | "unsuitable" | "no-space" | "no-permission" | "mismatch" | "failed";

/**
 * How a move ended: the new app state, the old folder when it was kept (it changed after the copy, or couldn't
 * go to the Trash) and whether the history stayed behind (it follows at the next start); or why it failed,
 * with the state as it is now.
 */
export type MoveResult =
  | { ok: true; state: AppState; leftBehind?: string; historyLeftBehind?: boolean }
  | { ok: false; error: MoveError; state?: AppState };

/** A mode as the window shows it (task-modes spec §3): never its brief or the agent's hint. */
export interface ModeView {
  label: string;
  description?: string;
  minTier?: Tier;
}

/** A phase as the window shows it (task-phases spec §6): never its brief. */
export interface PhaseView {
  id: string;
  label: string;
  auto?: true;
  close?: true;
  /** The modes allowed in it (modes spec §7): absent or "any", all the action's; "none"; or a list. */
  modes?: "any" | "none" | string[];
}

/**
 * A turn the main process starts on its own is about to run (task-phases spec §4.4, §5): a phase change (`phase`, who
 * moved, `back` when it went back) or the time box's wrap-up. The window draws its line, then the turn's events follow.
 */
export interface TaskTurnNotice {
  task: string;
  /** `context`: an "Add now" turn (context-panel spec §4.1), with the path it asks the agent to read. */
  kind: "phase" | "wrap-up" | "context";
  phase?: string;
  by?: "agent" | "person" | "app";
  back?: true;
  /** `kind: "context"` only: the folder-relative path. */
  path?: string;
}

/** What one part of a task's first message is (context-panel spec §3.1). `scope-instructions` waits for the hatches spec. */
export type ContextItemKind =
  | "instructions"
  | "scope-instructions"
  | "brief"
  | "notes-index"
  | "app-notes-index"
  | "data"
  | "material"
  | "pinned"
  | "pinned-title"
  /** A board-mode task's linked folders (hatches Decision 6): its first message lists them. */
  | "linked-folders"
  /** Data a pre-step prepared (tools spec §6.4): pre-step results in the first message, one item per block. */
  | "prepared";

/** One part of what the app loaded into a task, with its approximate size. */
export interface ContextItem {
  /** `instructions`, `brief`, `brief:<n>`, `notes`, `app-notes`, `data:<collection>`, `material`, `pin:<scope>:<path>`. */
  id: string;
  kind: ContextItemKind;
  /** English, for harness views and logs; the core's panel draws its own text from the other fields. */
  label: string;
  /** Relative to the folder, forward slashes, when the item is a file. */
  path?: string;
  /** Estimate: characters / 4, rounded to 100. */
  tokens: number;
  /** A brief that arrived after the start (a mode switch, a phase change). */
  at?: string;
  /** Notes in an index; rows of a collection. */
  count?: number;
  /** The notes an index lists, newest first (at most 50): what "Exclude" acts on. */
  notes?: { path: string; title: string }[];
  /** A pin's scope (`_app` for the whole app). */
  scope?: string;
  /** Before a compaction: the engine may have summarized it. */
  compacted?: true;
}

/** A file, note or tool the agent used during the task (§3.2): one entry per path or tool. */
export interface ContextRead {
  kind: "read" | "tool";
  /** The relative path, a file name (outside the folder) or "<server> · <tool>". */
  label: string;
  /** Relative to the folder; absent for tools and for files outside it. */
  path?: string;
  firstAt: string;
  count: number;
  compacted?: true;
}

/** A pinned file as the panel shows it (§4.2). */
export interface PinView {
  scope: string;
  path: string;
  at: string;
  /** Enters whole, as title only (over the budget or over 1 MB), or is skipped. */
  state: "full" | "title" | "missing" | "binary";
  tokens: number;
}

/** An excluded note (§4.3). `title` when the note is still there. */
export interface ExcludedView {
  scope: string;
  note: string;
  at: string;
  title?: string;
}

/** What the panel shows for the open task (§5.1). */
export interface TaskContext {
  task: string;
  /** The task's scope: `main` without scopes. */
  scope: string;
  scoped: boolean;
  start: ContextItem[];
  /** The first turn's real input tokens, once it ended. */
  startTokens?: number;
  reads: ContextRead[];
  compacted: boolean;
  pins: PinView[];
  excluded: ExcludedView[];
  /** Tokens of pinned text a new task gets whole. */
  budget: number;
}

/** `bad-name`: the path has a backtick, a line break or another control character, so it can't sit in a prompt or a commit. */
export type ContextRefusal =
  | "no-task"
  | "busy"
  | "outside"
  | "bad-name"
  | "binary"
  | "missing"
  | "unknown-scope"
  | "not-a-note"
  | "full"
  | "not-ready"
  | "failed";
export type ContextResult = { ok: true } | { ok: false; reason: ContextRefusal };
export type ContextGetResult = { ok: true; context: TaskContext } | { ok: false; reason: ContextRefusal };
export type ContextPick = { ok: true; path: string } | { ok: false; reason: "cancelled" | ContextRefusal };

/**
 * How a phase pick went (spec §4.2): a change turn runs ("turn"), only the state changed ("quiet"), it already was the
 * phase ("same"), or the close phase's Finish closes the task ("closing"). Refusals: no task waits ("no-task"), or the
 * action has no such phase ("unknown").
 */
export type PhaseResult = { ok: true; changed: "turn" | "quiet" | "same" | "closing" } | { ok: false; reason: "no-task" | "unknown" };

export interface AppState {
  harness: {
    id: string;
    name: string;
    tagline?: string;
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
  /** `humanharness dev --mock`: a fake engine replays recordings (development only). */
  mock?: boolean;
  engines: EngineOption[];
  /** The harness's declared actions, by id. */
  actions: Record<string, ActionOption>;
  /** The guided path: action ids in order. */
  path?: string[];
  /** The harness's unit of work (manifest `scopes`): what to call it. Absent: no scopes (spec D2). */
  scopes?: { label: string; plural: string };
  /** The blocks the person answers, by name: how the core form draws each (input-blocks spec §5). Absent: none (D0). */
  inputs?: Record<string, InputSpec>;
  /** The harness's settings (manifest `settings`): its own Settings tab. Absent: no tab (harness-settings D0). */
  settings?: SettingsView;
  /** Sidekick, the core's prompt coach (sidekick spec). Absent: no Sidekick UI (tests, older mains). */
  sidekick?: SidekickInfo;
  /** The harness's modes, by id (task-modes spec). Absent: none (D0). */
  modes?: Record<string, ModeView>;
  /** The harness's setup steps, in order (setup-steps spec). Absent: none (D0). */
  setup?: SetupStepView[];
  /** The harness's profiles (manifest `profiles`): what to call one and its form. Absent: one implicit profile (D4). */
  profiles?: ProfilesInfo;
  /** The harness takes the person's material (manifest `material`). Absent: none (D0). */
  material?: MaterialInfo;
  /** The harness takes plugins (manifest `plugins`). Absent: no Plugins tab, no inbox (plugins D0). */
  plugins?: PluginsInfo;
  /** Parallel tasks (parallel spec). Absent: one task at a time, no task inbox (D7). */
  parallel?: ParallelInfo;
  /** Background jobs (parallel spec §3, part 3). Absent: none (D0). */
  jobs?: JobsInfo;
  /** The harness's document kinds (manifest `documents`): the reader's template check. Absent: none (D0). */
  documents?: { kinds: Record<string, DocumentKind> };
  /** The harness's agent may edit the folder: documents can be reviewed (review spec). Absent: no review UI (D0). */
  review?: true;
  /** Folders the agent can read but never change. */
  references?: ReferenceView[];
  /** Settings › Modelos. */
  models?: ModelsView;
  /** The configured folder's backup status (null before a folder is chosen) and the synced places. */
  backup?: { status: SyncStatus | null; locations: SyncLocationView[] };
  /** The hatches the harness declares (hatches spec). Absent: none (D0). */
  hatches?: HatchesState;
  /** The harness declares secrets (tools spec §9). Absent: none (D0). */
  connections?: ConnectionsInfo;
  /** The harness declares tools (tools spec §5). Absent: none (D0). */
  tools?: ToolsInfo;
}

/** What Settings › Modelos needs (resources spec §7). */
export interface ModelsView {
  /** The tier the harness recommends, by task key (action id, or "questions"). */
  recommended: Record<string, Tier>;
  /** The core's tables, by engine id. */
  defaults: Record<string, Record<Tier, ModelSpec>>;
  /** What each engine offers: model ids (empty: only the engine's default) and efforts. */
  offered: Record<string, { models: ModelChoice[]; efforts: Effort[] }>;
  /** The pinned-files budget the harness suggests (context-panel spec §4.2); Settings › Models offers it. */
  pinnedTokens: number;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What the provider charged for the turn, in USD (OpenCode). Absent when the engine reports no cost. */
  costUsd?: number;
}

/** A block in the chat. Input blocks carry the id the app gave them and, once answered, the answer (input-blocks spec §8). */
export interface ChatBlock {
  name: string;
  data: unknown;
  id?: string;
  input?: BlockAnswer;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: ChatBlock[];
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
  /** A mode switch the person picked (task-modes spec §5.4): this user entry is a system line, and this is the mode's id. */
  mode?: string;
  /** The task entered this phase (task-phases spec §4.4): this user entry is a separator line, and this is the phase's id. */
  phase?: string;
  /** The time box's wrap-up (spec §5): this user entry is a system line. */
  timeUp?: true;
  /** Assistant entries: text runs and blocks in the order they arrived. Older entries lack it: text, then blocks. */
  parts?: AnswerPart[];
  /**
   * A line the app added to a task's chat, never the agent's reply (board mode only, parallel spec §5.3): drawn as a
   * system line, and skipped wherever the chat looks for the latest reply. Saved with empty `text`, so an app that
   * doesn't know it shows nothing.
   */
  notice?: ChatNotice;
  /** The `.md` files this turn added or changed (document-reader spec §5.1). Absent: none. */
  documents?: DocumentCard[];
  /** Assistant entries: the tool calls during the turn (tools spec §8.2). Absent: none. */
  tools?: ToolCallView[];
}

/** A line the app added to a task's chat (board mode): see the runtime's `TaskNotice`. */
export type ChatNotice = TaskNotice;

/**
 * Why board mode refused "Undo this task" (parallel spec §5.3): a running task is changing `path`, `path` has changes
 * the history hasn't saved, a later task (`by: "task"`) or a change outside any task (`by: "outside"`) also changed
 * `path`, the task is too far back, or there is nothing to take back.
 */
export type UndoRefusal =
  | { reason: "running" | "uncommitted"; path: string }
  | { reason: "later"; path: string; by: "task" | "outside" }
  | { reason: "too-far" | "nothing" }
  /**
   * Linked folders (hatches spec §3.4): some folders were restored, then another refused (a running turn wrote there
   * meanwhile). `workFolder`: the work folder was restored; `restored`/`notRestored`: linked folders' keys; `cause`:
   * why the first of `notRestored` refused (its path `<key>/…`).
   */
  | { reason: "partial"; workFolder: boolean; restored: string[]; notRestored: string[]; cause: Exclude<UndoRefusal, { reason: "partial" }> };

/** A piece of an answer: a run of text, or one of the entry's `blocks` (by index). */
export type AnswerPart = { text: string } | { block: number };

export interface ChatLoad {
  entries: ChatEntry[];
  /** Set when the folder's last session ran on another engine: that chat was archived. */
  switchedFrom?: string;
  /** Board mode: the focused task's turn still running, to replay (parallel spec Decision 6). Its user line is in `entries`. */
  live?: { user: { text: string; at: string }; events: Event[] };
}

export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
  /** The task's phase when the commit was made (its `Phase:` trailer). */
  phase?: string;
}

/** A file a task added, changed or deleted. */
export type HistoryFileChange = FileChange;

/**
 * One row of the History panel: a task's commits, or the group of commits outside any task (`taskId: null`:
 * "Outside a task", which holds the restores too).
 */
export interface HistoryTaskView {
  taskId: string | null;
  actionId: string | null;
  /** The scope the task ran in (harnesses with scopes). */
  scopeId?: string;
  /** The job this row is a run of (its commits' `Job:` trailer), only for job runs. */
  jobId?: string;
  /** What "Undo this task" restores; null when there is nothing before it. */
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

/** `hh:readDocument` (document-reader spec §5.3). Main never writes; a refusal is data. */
export type DocumentRead =
  | { ok: true; text: string; mtime: string; size: number }
  | { ok: false; reason: "outside" | "missing" | "not-markdown" | "too-large" | "not-ready"; size?: number };

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
  /** Typical share (0..1) of the `primary` window each task key (action id, or "questions") used lately, from the local log. */
  estimates: Record<string, number>;
  /** Typical total tokens per task of each task key lately, for every engine. */
  tokens: Record<string, number>;
  /** Harnesses with scopes: tokens used per scope id, over the whole log. */
  scopes?: Record<string, number>;
  /** Harnesses with profiles: tokens used per profile id, over each profile's whole log (profiles spec §4). */
  profiles?: Record<string, number>;
  /**
   * Harnesses with material: tokens the material's AI stages used, over the whole log (with profiles, the active
   * profile's: each processes its own). Absent when none ran.
   */
  material?: number;
  /** Tokens of Sidekick's turns (sidekick spec §8; with profiles, the active profile's); absent when it never ran. */
  sidekick?: number;
  /** Tokens of background job runs (parallel spec §10; with profiles, the active profile's); absent when none ran. */
  jobs?: number;
  /** USD the engine reported over the last 30 days (OpenCode; every profile's turns). Absent when no turn reported a cost. */
  spentUsd?: number;
  /** The window kind estimates measure (the engine's `limits.primary`); absent when the engine reports no limits. */
  primary?: string;
}

export interface SendOptions {
  /**
   * The manifest action this message starts: a new task, whose first message is the action's brief (the
   * message is what the chat shows). Heavy actions may ask first.
   */
  action?: string;
  /** Harnesses with scopes: run in this scope (it opens first). Default: the open one. */
  scope?: string;
  /** With `action`: the mode the person picked for the new task (`defaultMode: "ask"`, task-modes spec §3). */
  mode?: string;
  /** With `action`: the time box's length in minutes, one of the action's options (task-phases spec §5); null: no limit. */
  timeBox?: number | null;
}

/**
 * Where the current task is: running a turn, waiting for the person, closing (asking for its note), or
 * saving a checkpoint note before the context reaches its cap.
 */
export type TaskStatus = "running" | "waiting" | "closing" | "checkpoint";
/** How an action's last task ended: its note was saved, the closing turn brought none, or it was interrupted. */
export type ActionStatus = "done" | "unsaved" | "unfinished";

/**
 * The task's time box as the window sees it (task-phases spec §5): minutes chosen, the whole box and the time used in ms
 * (a test minute may be short), measured `at`; the window counts down from there unless `paused`. `wrappedUp`: the
 * wrap-up ran; `ended`: the time is up.
 */
export interface TimeBoxView {
  minutes: number;
  totalMs: number;
  usedMs: number;
  at: string;
  paused: boolean;
  wrappedUp?: true;
  ended?: true;
}

export interface CurrentTaskView {
  id: string;
  /** Absent for a free question. */
  action?: string;
  /** The scope the task runs in (harnesses with scopes). */
  scope?: string;
  status: TaskStatus;
  /** Context in use by the task's session, and the task's cap (the side panel's meter). */
  context?: { used: number; cap: number };
  /** The plan lacked `model`: the task runs one tier down (`tier`), or on the engine's default model (no `tier`). */
  fallback?: { model: string; tier?: Tier };
  /** The id of the input block the task waits an answer for (input-blocks spec §4). */
  pendingInput?: string;
  /** Task modes (task-modes spec §5.5), only for a task whose action has them: the mode now and those used. */
  mode?: string;
  modes?: string[];
  /** The tier the task counts as (a custom profile: its nearest), so the window can ask before a switch (§5.3). */
  tier?: Tier;
  /** It runs below its mode's `minTier`: the person chose to continue. */
  belowMinTier?: true;
  /** Task phases (task-phases spec §6), only for a task whose action has them: the phase now, its log, the agent's proposal. */
  phase?: string;
  phases?: { id: string; at: string; by: "agent" | "person" | "app" }[];
  phaseProposal?: { to: string; reason: string };
  timeBox?: TimeBoxView;
  /** The task runs without its scope's engine config (hatches spec §5.3): not approved (or changed since), or refused. */
  engineNotice?: "unapproved" | "refused";
}

/** A note in `.harness/notes/`, for the side panel and "What's clear so far". */
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
  /** Harnesses with scopes: the open scope (null when none is open). Absent without scopes. */
  scope?: string | null;
}

/**
 * How the person's pick of a mode for the open task went (task-modes spec §5). `switched`: a turn in the new mode runs
 * now ("turn"), the mode was set with no turn because the session is gone ("quiet"), the task closes and a new one
 * starts in that mode ("new-task"), or it already was the mode ("same"). Refusals: no task waits ("no-task"), the action
 * doesn't list the mode ("unknown"), the mode asks for more than the task's tier ("tier", with both tiers), or the
 * current phase doesn't allow it ("phase").
 */
export type ModeResult =
  | { ok: true; switched: "turn" | "quiet" | "new-task" | "same" }
  | { ok: false; reason: "no-task" | "unknown" | "tier" | "phase"; required?: Tier; current?: Tier };

/** A switch `chooseMode` started (task-modes spec §5), whoever asked for it: a "same" answer is none. */
export interface ModeSwitch {
  mode: string;
  switched: "turn" | "quiet" | "new-task";
}

/** The answer to the tier question (spec §5.3): continue at the task's tier, or start a new task at the mode's. */
export interface ModeChoice {
  belowTier?: "continue" | "new-task";
}

/** A scope as the window sees it (spec §3.4). Its linked folders come only through `scopes.linked` (signed ones). */
export type ScopeView = Omit<ScopeEntry, "linked" | "engineApproval">;

/** A scope's linked folder as the window sees it (hatches spec §3.2). */
export interface LinkedView {
  key: string;
  label: string;
  path: string;
  mode: "read" | "write";
  tracked: boolean;
  gitChanged?: true;
  /** The agent doesn't get this folder now, and why (the checks a turn runs): the person unlinks and links it again. */
  dropped?: LinkDroppedView;
}
/** Why a stored link is left out of turns: a refusal of today's picker, or a folder moved, under a reference, or of a new mode. */
export type LinkDroppedView = Exclude<LinkRefusalView, "one-only" | "too-many"> | "moved" | "mode-changed";
/** Why a link was refused: a key of en.json `hatches.refused`. */
export type LinkRefusalView =
  | "engine-home" | "home" | "system" | "too-broad" | "protected" | "main-folder" | "other-scope-write" | "nested"
  | "already-linked" | "not-git" | "not-folder" | "unsafe-name" | "reference" | "one-only" | "too-many";
/** What the History panel shows of the open scope's linked folders (hatches spec §3.4). */
export interface LinkedHistoryView {
  /**
   * Write folders the app's history doesn't cover: the panel says undo doesn't cover them, because they have their own
   * git, or (`noGit`) they have none and the app's history doesn't track them (they lost it).
   */
  uncovered: { key: string; label: string; noGit?: true }[];
  /** Per task id: what it changed in each tracked folder. */
  tasks: Record<string, { key: string; label: string; changes: HistoryFileChange[] }[]>;
}
/** The hatches a harness declares (hatches spec). Absent from AppState without any (D0). */
export interface HatchesState {
  linkedFolders?: Record<string, { label: string; mode: "read" | "write"; history: "auto" | "own"; many: boolean }>;
  /** The harness declares a backend (hatches spec §4). Absent without one (D0). */
  backend?: true;
  /** The harness declares `enginePresets` (hatches spec §5): scope settings show "Engine config". Absent without (D0). */
  enginePresets?: true;
}

/** A hook or MCP server of a scope's engine config: it runs a command on the person's computer (spec §5.3). */
export interface EngineRunsCommandView {
  kind: "hook" | "server";
  /** A hook's event (and matcher), a server's name as the engine sees it (`scope-<name>`). */
  label: string;
  command: string;
  args: string[];
  /** "" for the scope's own config, else the action whose layer it is. */
  layer: string;
  /** The file it comes from, relative to the scope's engine folder (`codex.toml` hooks run on Codex only). */
  file: string;
  /** It runs a package runner (`npx`, `uvx`) or the like: it may load code the approval doesn't cover. */
  loadsOtherCode?: true;
  /** A server's environment variables, names and values (absent when it sets none). */
  env?: Record<string, string>;
}
/** A skill of a scope's engine config, with what its frontmatter asks for while it runs. */
export interface EngineSkillView {
  name: string;
  description: string;
  /** `allowed-tools`: tools it may use without asking while it runs. */
  allowedTools: string[];
  model?: string;
  /** `context: fork`: it runs in a context of its own. */
  fork?: true;
  /** The other files in its folder (scripts, references), relative to it. */
  files: string[];
}
/** What the scope settings' "Engine config" shows of a scope's engine folder (hatches spec §5.3). */
export interface EngineConfigView {
  scope: string;
  base: "isolated" | "global";
  /** Decision 14: the harness supports Codex ("On Codex, your own Codex config always applies"). */
  codexLimit: boolean;
  /** Decision 10: the active engine's id (`claude`, `codex`, `opencode`…); absent before one is chosen. */
  engine?: string;
  /** Shown first: hooks, then servers; the scope's own, then each action layer's. */
  runsCommands: EngineRunsCommandView[];
  instructions: { layer: string; text: string }[];
  skills: EngineSkillView[];
  /** `ignored`: the keys the app drops from the agent's file (`permissionMode`). */
  agents: {
    name: string;
    description: string;
    ignored: string[];
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    skills?: string[];
    /** `project` or `local`. */
    memory?: string;
  }[];
  /** codex.toml's keys, dotted, each with its value as JSON (its hooks are in `runsCommands`). */
  codexKeys: { key: string; value: string }[];
  /** Keys dropped rather than refused, each led by its file (`settings.json: defaultMode`). */
  ignored: string[];
  /** settings.json's permission rules per layer ("" the scope's own); only layers with any. */
  permissions: { layer: string; allow: string[]; deny: string[]; ask: string[] }[];
  /** Files outside the engine folder its commands name: they join the hash (absolute). */
  scripts: string[];
  /** The scripts among `scripts` that load other code (imports, a package runner): not covered by the approval. */
  loadsOtherCode: string[];
  /** A config with any can't be approved. */
  refusals: { file: string; message: string }[];
  /** What `approve` takes back: main computes it again and approves only when equal. */
  hash: string;
  /** The person approved exactly this (the app's signature holds). */
  approved: boolean;
  approvedAt?: string;
  /** Approved before, but the folder no longer hashes to what was approved. */
  changed?: true;
}
/** `changed`: the folder no longer hashes to what was shown; `refused`: it holds refusals. */
export type EngineApproveResult = { ok: true; view: EngineConfigView } | { ok: false; reason: "changed" | "refused" };
export type BackendState = "stopped" | "starting" | "running" | "failed";
/** The open scope and the registry, sent whenever either changes. */
export interface ScopesView {
  open: string | null;
  list: ScopeView[];
}

/** A write to the harness's data, from anyone (spec §4.5). */
export type DataChangeView = DataChange;
/** What a task changed in one collection of one scope. */
export type DataDiffView = CollectionDiff;

/** Default: the open scope. App-wide collections ignore it. */
export interface DataOptions {
  scope?: string;
}

/** The harness's settings as the window sees them (harness-settings spec §4). */
export interface SettingsState {
  /** Every field's value: the stored one, else its default. */
  values: Record<string, unknown>;
  /** Fields the agent reads whose new value waits for the next task (D4). */
  pending: string[];
}

/** How a settings change ended: the new state, or why it was refused (`message` absent: something went wrong). */
export type SettingsResult = { ok: true; state: SettingsState } | { ok: false; message?: string };

/** A harness setup step's state (setup-steps spec §4): done, skipped, or not done yet. */
export type SetupStepStatus = "done" | "skipped" | "missing";

/** The harness's setup steps now: each one's status, and the required ones that keep Home on "Set up" (manifest order). */
export interface SetupStepsState {
  steps: Record<string, SetupStepStatus>;
  blocking: string[];
}

/**
 * How a step's submit, completion or skip went: the new state, or why not. `unknown`: no such step (or the wrong call for
 * its kind); `not-ready`: the app isn't set up, is closing, or can't read its setup.json; `open`: the interview's task is still open; `incomplete`:
 * its collection holds no valid record; `required`: a required step can't be skipped; `invalid`: the form's fields were
 * refused (`errors`, by field; "" for the whole form).
 */
export type SetupStepResult =
  | { ok: true; state: SetupStepsState }
  | { ok: false; reason: "unknown" | "not-ready" | "open" | "incomplete" | "required" | "invalid"; errors?: InputIssue[] };

/** A harness setup step as the window draws it (setup-steps spec §3): never an action's brief. */
export interface SetupStepView {
  id: string;
  kind: "form" | "interview" | "component" | "connect";
  label: string;
  /** One line under the step's heading. */
  description?: string;
  required: boolean;
  /** form: the fields the core form draws. */
  form?: InputSpec;
  /** interview: the action its task runs, and that action's cost hint. */
  action?: string;
  cost?: ActionCost;
  /** component: the name the harness registers its component under. */
  component?: string;
  /** connect: the secrets it asks for, in the step's order (ids, labels, help; never a value). */
  secrets?: { id: string; label: string; help?: string }[];
}

/** What a harness's own setup step component gets (setup-steps spec §3 `component`). */
export interface SetupStepProps {
  client: HarnessClient;
  /** The profile the step runs for; null in a harness without profiles. */
  profile: ProfileView | null;
  /** The step is done: the app marks it and moves on. */
  done(): void;
  /** Skip it; refused (the screen says so) for a required step. */
  skip(): void;
}

/** One profile as the window sees it (profiles spec §4): the registry's entry. */
export interface ProfileView {
  id: string;
  title: string;
  /** One of the avatar colours, or anything else (drawn neutral). */
  color?: string;
  createdAt: string;
  archived: boolean;
}

/** The profiles now: the active one (null while none is) and every registered one, archived included, in creation order. */
export interface ProfilesState {
  active: string | null;
  list: ProfileView[];
}

/**
 * Why a profile change was refused. `not-ready`: the app's folder isn't set; `busy`: a turn, a restore, a move, an engine
 * change or another switch runs; `open`: the open task's closing turn was stopped; `invalid`: the form's fields
 * (`errors`); `unknown`: no such profile (or an archived one, to open); `active`: not on the active profile; `failed`:
 * anything else (a disk error, a Trash that refused).
 */
export type ProfileRefusal = "not-ready" | "busy" | "open" | "invalid" | "unknown" | "active" | "failed";

/** What the window needs of the manifest's `profiles` (spec §3): the name of one, and the add and edit form. */
export interface ProfilesInfo {
  label: string;
  form: InputSpec;
}

/**
 * How a profile change went: the app state as it is now (the active profile, the folder it works in), or why not.
 * `made`: a create whose switch failed after the profile was made names it (it exists, not active).
 */
export type ProfileResult = { ok: true; state: AppState } | { ok: false; reason: ProfileRefusal; errors?: InputIssue[]; made?: string };

/** A source of the person's material as the window shows it (material spec §11). */
export interface MaterialSourceView {
  id: string;
  name: string;
  url?: string;
  status: "pending" | "converting" | "validating" | "needs-person" | "ready" | "refused" | "removed";
  stage?: "review" | "repair" | "label";
  notice?: "warn" | "max" | "rows" | "full-review" | "no-text-pages";
  refusal?: string;
  pages: number;
  rows?: number;
  pageRange?: [number, number];
  estimate: number;
  issues: string[];
  fixes: string[];
  fragments: number;
  verdict?: "good" | "usable-with-fixes" | "not-usable";
  failed: boolean;
  /** Questions for the person (§6.2 `ask`): about one fragment, or the whole source. */
  asks: { fragment?: string; question: string; choices: MaterialChoice[] }[];
}

/** An answer to a material question: a fragment's (`keep`, `drop`, `program`) or a whole source's (`use`, `remove`). */
export type MaterialChoice = "keep" | "drop" | "program" | "use" | "remove";

/** One scope's material now (`hh:materialStatus`). */
export interface MaterialView {
  scope: string;
  sources: MaterialSourceView[];
  grounding: { mode: "strict" | "mixed"; canChange: boolean };
  /** The engine's provider, for the privacy line (§13.3). */
  provider: string;
  /** The engine's usage window now, when it reports one (§7). */
  window: { kind: string; utilization: number } | null;
  /** Items with no fragment yet; absent without `items`. */
  uncovered?: string[];
}

/** What the harness takes (manifest `material`). Absent: no material (D0). */
export interface MaterialInfo {
  accepts: string[];
  items: boolean;
  grounding: { default: "strict" | "mixed"; personCanChange: boolean };
  /** A source this many pages long or more goes on only with a range shorter than this (§7 `MAX_PAGES`). */
  maxPages: number;
}

/** A translation run (language spec §5): its language, batches done of all, and how it stands. */
export interface LanguageRun {
  tag: Language;
  done: number;
  total: number;
  status: "running" | "done" | "failed" | "cancelled";
  /** `failed` only: the engine's quota, or anything else. */
  reason?: "quota" | "engine";
}

/** What Settings › General, the offer card and the picker need (spec §3, §6). */
export interface LanguageState {
  /** The saved language: the AI writes in it, the screens show its cached translation. */
  language: Language;
  /** Languages with a cache; `complete`: every key translated (or given up) for this app's English. */
  cached: { tag: Language; complete: boolean }[];
  /** Keys of the saved language still in English that a run would send; 0 for English. */
  missing: number;
  /** Whether a translation can run now, else why not (spec §3: no ready engine, mock mode). */
  canTranslate: true | "no-engine" | "mock";
  /** The engine that would translate (the notice names it). */
  engineName?: string;
  run: LanguageRun | null;
}

export type { GeneratedStrings };
export type LanguageChoose =
  | { ok: true; language: Language; strings: GeneratedStrings }
  | { ok: false; reason: "needs-translation" | "invalid" | "busy" | "failed" };
export type LanguageStart = { ok: true } | { ok: false; reason: "invalid" | "busy" | "no-engine" | "mock" | "failed" };

export type MaterialResult = { ok: true } | { ok: false; reason: "not-ready" | "unknown-scope" | "unknown-source" | "invalid" | "fetch" };
export type MaterialAddResult =
  | { ok: true; added: string[]; refused: { name: string; message: string }[] }
  | { ok: false; reason: "not-ready" | "unknown-scope" | "fetch" };

/** A config with everything a turn needs (appearance and text size stay optional). */
export type ConfiguredApp = AppConfig & Required<Pick<AppConfig, "language" | "folder" | "engineId">>;

export type { BlockAnswer, ChoiceOption, InputField, InputIssue, InputSpec, RespondResult, SettingFieldView, SettingsView };

// ── Sidekick (sidekick spec; plan 2026-10-27 part 1) ──

/** The sidekick that speaks. Part 1's one: `{ id: "sidekick", name: "Sidekick", mark: "spark" }`. */
export interface SidekickInfo {
  id: string;
  name: string;
  /** Its mark: "spark" names the core's SVG mark; else a short text (an emoji). */
  mark: string;
}

export interface SidekickSettings {
  on: boolean;
  /** The pre-send moment (spec §8 "the three moments, each on its own"). */
  preSend: boolean;
  /** Longest wait before the prompt goes out as typed, in seconds; "always" waits up to 60 s. */
  wait: 6 | 10 | "always";
  /** Sidekick's tokens per task. */
  cap: 20_000 | 50_000 | "none";
  /** The off-state intro was answered. */
  introSeen: boolean;
  /** The after-reply moment (spec §4.2). */
  afterReply: boolean;
  /** The heads-ups (spec §4.3). */
  headsUps: boolean;
  /** The harness's presets were offered once (spec §2a.7). */
  presetsOffered: boolean;
  /** Muted kinds per sidekick id (spec §6.3). */
  muted: Record<string, string[]>;
  /** The newest event the last learning turn read (spec §6.4); absent until it first ran. */
  learnedAt?: string;
  /** The day of the last daily card (YYYY-MM-DD); absent until the first one. */
  lastDaily?: string;
}

/** An item of "What Sidekick learned" (spec §6.4). `person`: written or edited by the person; learning never changes it. */
export interface SidekickLearned {
  id: string;
  text: string;
  level: "you" | "harness";
  source: "learned" | "person";
  kind?: string;
}
export type SidekickSettingsPatch = Partial<SidekickSettings>;
export type SidekickSetResult = { ok: true; settings: SidekickSettings } | { ok: false; message: string };

export type SidekickFlagKind = "vague" | "missing-context" | "two-asks" | "off-phase";
export interface SidekickFlagView {
  kind: SidekickFlagKind;
  match: string;
  span: [number, number];
}
export interface SidekickIssue {
  kind: SidekickFlagKind | "other";
  text: string;
  span?: [number, number];
}

/** A suggestion (spec §4.1 step 4). */
export interface SidekickCard {
  id: string;
  /** The prompt as typed. */
  prompt: string;
  /** About a block answer's free text (spec §4.1): its Send anyway sends the form, not the composer. */
  block?: true;
  flags: SidekickFlagView[];
  issues: SidekickIssue[];
  rewrite?: string;
  queued?: string[];
  confidence: number;
  at: string;
  /** Which moment it belongs to; and who speaks (spec §7 "every card names who speaks"). */
  moment: SidekickCardMoment;
  speaker: SidekickInfo;
  /** The kind its threshold and muting use: the first issue's (or flag's) kind; "gap", "next"… for other moments. */
  kind: string;
  /** "You took N of your last M <kind> suggestions" (spec §4.1 step 4); absent with fewer than 3. */
  why?: { used: number; of: number };
  /** After the reply (spec §4.2): a gap, the next prompt (Put in composer), a repeated ask; a mentor's lesson ("Worth knowing"). */
  after?: { gap?: { title: string; text: string }; next?: string; repeated?: { topic: string; decision: string }; lesson?: string };
  /** A process-guard's card (spec §2a.2): what the phase left (or the document) is missing. */
  guard?: { missing: string[] };
  /** The daily card (spec §2a.2 daily-summary): yesterday in a few plain sentences. */
  text?: string;
  /** A heads-up (spec §4.3): the context near full, an ask that keeps coming back, prompts drifting off the phase. */
  headsUp?: SidekickHeadsUp;
}

/** Context near full → Finish task; a repeated ask → Save as decision; off-phase drift → Finish task (plan Decision 7). */
export type SidekickHeadsUp = { kind: "context"; share: number } | { kind: "repeated"; topic: string; decision: string } | { kind: "off-phase"; phase?: string };

export type SidekickCardMoment = "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place";

/** Off · Watching · Reading your prompt… · Has a suggestion · Past its cap (spec §7). */
export type SidekickStatus = "off" | "watching" | "reading" | "suggestion" | "capped";

export interface SidekickState {
  info: SidekickInfo;
  settings: SidekickSettings;
  status: SidekickStatus;
  /** Tokens toward the cap in the open task (input + output + cache writes). */
  spent: number;
  /** The cap in tokens; null for no cap. */
  cap: number | null;
  /** The tier Sidekick's turns run at (Settings › Models), or "custom". */
  tier: string;
  card: SidekickCard | null;
  /** The open task's waiting cards other than the live pre-send one (after the reply). */
  cards: SidekickCard[];
  /** Sidekick's tokens in the last 7 days. */
  week: number;
  /** The last review could not finish: the prompt went as typed (spec §5 "Errors"). */
  notice?: "failed" | "timeout";
  /** The current task's earlier cards, one line each ("Earlier · used"). */
  past: { id: string; kind: string; outcome: SidekickOutcome | "muted" | "timeout"; speaker: string }[];
  /** "N of M suggestions used" over the last 7 days (spec §8). */
  used: { used: number; of: number };
  /** The person's sidekicks by order (Settings names the tab "Sidekicks" with two or more); absent from older mains. */
  sidekicks?: SidekickInfo[];
  /** The harness's places (spec §2a.5), for a custom purpose's moments; absent when it has none. */
  places?: { id: string; label: string }[];
}

/**
 * What the composer does with a review: `send` the prompt as typed (no flags, a clean verdict, Sidekick off or past
 * its cap), show the `card`, send as typed after a `timeout` or an `error`, or nothing (`cancelled`: the person
 * sent at once or the review was replaced).
 */
export type SidekickReview = { kind: "send" } | { kind: "card"; card: SidekickCard } | { kind: "timeout" } | { kind: "error" } | { kind: "cancelled" };
/** What the document-review flow does before approving (spec §2a.2): approve, or show the card next to Approve. */
export type SidekickApproveCheck = { kind: "approve" } | { kind: "card"; card: SidekickCard };
/** A harness place's answer (spec §2a.5, plan Decision 13): free text, at most 600 characters. */
export type SidekickPlaceAnswer = { ok: true; text: string; speaker: SidekickInfo } | { ok: false };
/** A sidekick's purpose as the UI shows it: a core purpose id, or `custom` with its text and moments. */
export interface SidekickPurposeView {
  id: string;
  text?: string;
  moments?: string[];
}
/** A ready-made sidekick the harness offers (spec §2a.7); `adopted` once the person added it. */
export interface SidekickPreset {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  adopted: boolean;
}
/** Where an imported sidekick came from: pasted text, or files with the hash of what was read. */
export type SidekickSource = { kind: "paste" } | { kind: "files"; paths: string[]; hash: string; tag?: string };
export type SidekickImportInput = { kind: "paste"; text: string } | { kind: "files"; token: string } | { kind: "original"; sidekickId: string };
/** A pick for an import: a token for the paths the app kept (used once by importDraft) and the files' names to show. */
export interface SidekickPick {
  token: string;
  files: string[];
}
/** An imported sidekick before it is saved. */
export interface SidekickDraft {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  source: SidekickSource;
}
/** A sidekick to save: an import's draft, or the editor's full definition. */
export interface SidekickDraftDef {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  source?: SidekickSource;
  tier?: "light" | "standard" | "deep";
  preset?: string;
  defaultOn?: boolean;
}
/** A sidekick in one scope (spec §2a.4): on or off there, its purpose text there, and the places it answers there. */
export interface SidekickInScope {
  id: string;
  name: string;
  mark: string;
  on: boolean;
  purposeText?: string;
  places?: string[];
}
/** A stored sidekick as Settings shows and edits it: its full definition and its place in the order. */
export interface SidekickView extends SidekickDraftDef {
  id: string;
  order: number;
}
/**
 * Why an import gave no draft: a file in an engine's settings folder, too many files, one too big (paste too), not
 * plain text, unreadable, nothing pasted, no engine set up (or its notice not accepted), the turn failed or gave
 * nothing usable, a newer import replaced it, or the pick's token is unknown, used or too old (choose the files again).
 */
export type SidekickImportFailure = "engine-settings" | "too-many" | "too-big" | "type" | "unreadable" | "empty" | "unavailable" | "failed" | "cancelled" | "expired";
export type SidekickImportResult =
  | { ok: true; draft: SidekickDraft; learned: { text: string; level: "you" | "harness" }[]; skipped: string[] }
  | { ok: false; reason: SidekickImportFailure; file?: string };
/** An imported sidekick's files: as read, changed since, gone (or now refused); `none` when it wasn't imported from files. */
export type SidekickOriginal = "unchanged" | "changed" | "gone" | "none";
export type SidekickOutcome = "used" | "edited" | "sent-anyway" | "dismissed";

/** Plugins (plugins spec §7): the harness takes them; `local`: the person may add their own from a folder. */
export interface PluginsInfo {
  local: boolean;
}

/** A harness secret as Settings › Connections shows it (tools spec §9): never its value. */
export interface ConnectionView {
  id: string;
  label: string;
  help?: string;
  set: boolean;
  /** A connect step names a test for this key: Test connection is offered (slice 2). Absent otherwise (D0). */
  test?: true;
  /** The last Test connection's outcome; absent until one ran, and again once the key is replaced or deleted. */
  lastTest?: ConnectionLastTest;
}
/** When the last test ran, whether it worked, and, when it didn't, the error with the stored keys hidden. */
export interface ConnectionLastTest {
  at: string;
  ok: boolean;
  message?: string;
}
export interface ConnectionsView {
  connections: ConnectionView[];
}
export type ConnectionResult = { ok: true } | { ok: false; message: string };
/** The harness declares secrets (tools spec §9). Absent from AppState without (D0). */
export interface ConnectionsInfo {
  count: number;
}
export type ToolCallResult = { ok: true; result: unknown } | { ok: false; error: string };
/** The harness declares tools. Absent without (D0). `off`: why every call fails now (not built, a problem, or crashes). */
export interface ToolsInfo {
  ids: string[];
  off?: string;
}
export type PluginStatus = "on" | "off" | "review" | "crashed" | "error";
export interface PluginRow {
  id: string;
  name: string;
  version: string;
  origin: "bundled" | "local" | "dev";
  folder?: string;
  status: PluginStatus;
  /** Its code changed since the person last opened its detail (no new permissions). */
  updated?: true;
  lastSync?: string;
  lastError?: string;
  /** Why it can't load or start. */
  error?: string;
}
export interface PluginsView {
  local: boolean;
  plugins: PluginRow[];
}
/** One line of the permission review, as plain data the UI words (never markup, B12). */
export type PluginLine = { kind: "hosts"; hosts: string[] } | { kind: "exec"; command: string; readOnly: boolean; wide: boolean } | { kind: "secrets"; labels: string[] } | { kind: "tasks" };
export interface PluginReview {
  id: string;
  name: string;
  version: string;
  folder: string;
  /** The dist this review shows; Approve sends it back, and a plugin that changed since is refused. */
  distHash: string;
  lines: PluginLine[];
  /** What this version adds to the approved permissions. */
  added?: { kind: string; value: string }[];
}
export type PluginPick = { ok: true; token: string; review: PluginReview } | { ok: false; message: string } | { ok: false; cancelled: true };
/** With both `message` and `review`: refused because the plugin changed since the review; `review` is the current one. */
/** `started`: only from Start of a prepared task, failing after the task manager took it (a turn may have run). */
export type PluginResult = { ok: true } | { ok: false; message: string; started?: true } | { ok: false; review: PluginReview; message?: string };
export interface PluginWorkHours {
  days: number[];
  from: string;
  to: string;
  timezone: string;
}
export interface PluginDetail {
  row: PluginRow;
  review: PluginReview;
  settings?: SettingsView;
  values: Record<string, unknown>;
  workHours?: PluginWorkHours;
  /** Which keys are stored: never their values (B6). */
  secrets: { id: string; label: string; help?: string; stored: boolean }[];
  sources: { id: string; ttl: number; running: boolean; lastOk?: string; lastError?: string }[];
  errors: { at: string; source?: string; message: string }[];
  notify: boolean;
}
export interface PluginTestResult {
  source: string;
  ok: boolean;
  writes?: number;
  error?: string;
}
export interface AttentionItemView {
  plugin: string;
  pluginName: string;
  key: string;
  severity: "info" | "warn" | "action";
  title: string;
  body?: string;
  at: string;
  read: boolean;
  hasTarget: boolean;
}
export interface AttentionView {
  items: AttentionItemView[];
  badge: number;
  show: boolean;
}
/** A running plugin's panel in a slot (plugins part 2): served from `url` into a sandboxed frame. */
export interface PluginPanelView {
  plugin: string;
  pluginName: string;
  id: string;
  title: string;
  slot: string;
  url: string;
}
/** A chip the core draws as text; a click opens `panel` (the plugin's first) when there is one. */
export interface PluginChipView {
  plugin: string;
  pluginName: string;
  id: string;
  slot: string;
  text: string;
  severity: "info" | "warn" | "action";
  panel?: string;
}
/** The one prepared task waiting for the person's Start (P6, P13): `prompt` is exactly the task's question. */
export interface PreparedTaskView {
  token: string;
  plugin: string;
  pluginName: string;
  title: string;
  prompt: string;
  tier: "light" | "standard" | "deep";
  /** "app": runs app-wide (`scope: "none"`); "open": needs the open scope. */
  scope: "open" | "app";
  expiresAt: string;
}
export interface PluginSurfaceView {
  panels: PluginPanelView[];
  chips: PluginChipView[];
  prepared?: PreparedTaskView;
  /** Per plugin, bumped when its dist changed in dev: the renderer remounts its frames. */
  reloads: Record<string, number>;
}
export type PanelCall = "data.query" | "settings.get" | "refresh" | "requestAction";
export type PanelAnswer = { ok: true; value: unknown } | { ok: false; error: string };
export type AttentionTarget = { kind: "panel"; plugin: string; panel: string; focus?: string } | { kind: "prepared" } | { kind: "none" };
/** A run of `plugin` wrote `collections` (plugins part 2, Decision 8). */
export interface PluginDataChange {
  plugin: string;
  collections: string[];
}

/** Why a review action did nothing (review spec; errors over IPC are data). */
export type ReviewRefusal =
  | "outside"
  | "missing"
  | "not-markdown"
  | "too-large"
  | "broken"
  | "not-ready"
  | "blocked"
  | "busy"
  | "unknown"
  | "not-found"
  | "bad-input"
  | "full"
  | "locked"
  | "changed"
  | "unsent"
  | "reason-required"
  | "nothing-to-send";
/** `count`: the unsent items (`unsent`) or the open blocking questions (`reason-required`). */
export type ReviewFailure = { ok: false; reason: ReviewRefusal; count?: number };
/**
 * The reader's view of a document's review. `review` null: no record yet (§6.1 "reading only"). `blob`: the version
 * read, which an approval passes back (a document changed since is refused with "changed").
 */
export type ReviewView = { ok: true; review: Review | null; blob: string; summary: ReviewSummary } | ReviewFailure;
/** "Approve" (§5.4), with the blob of the version shown: a reason when a blocking question is open; drop unsent items. */
export interface ApproveOptions {
  reason?: string;
  discard?: boolean;
}
export type ReviewResult = { ok: true; id?: string; applied?: boolean } | ReviewFailure;
/** `to`: the round went to the task that waits ("open") or starts a "Review <title>" task ("new"). */
export type ReviewSendResult = { ok: true; sent: number; to: "open" | "new" } | ReviewFailure;
export type ApprovedText = { ok: true; text: string } | ReviewFailure;
/** A comment on a rendered selection (§5.2): the selected text, the slug of the heading above it, the comment. */
export interface CommentInput {
  selected: string;
  heading: string | null;
  text: string;
}
/** Focus mode (§6.2): on or off, and the document read. */
export interface FocusState {
  on: boolean;
  path?: string;
}
export type { AnswerPick, Review, ReviewComment, ReviewSummary } from "@humanharness/harness-sdk/review";

export type { DiffPart, FileDiffView, LineChange, MdBlockType, MdDiffBlock, TimelineAuthor, TimelineEntry, TimelineKind } from "@humanharness/workspace";

/** Why a file-timeline call did nothing (file-timeline spec; errors over IPC are data). */
export type FileRefusal = "not-ready" | "outside" | "untracked" | "bad-input" | "not-found" | "deleted" | "busy" | "unsafe" | "failed";
export type FileTimelineResult = { ok: true; entries: TimelineEntry[] } | { ok: false; reason: FileRefusal };
export type FileDiffResult = FileDiffView | { ok: false; reason: FileRefusal };
/** What main's native confirmation says before a file goes back (§5). */
export interface FileRestorePrompt {
  path: string;
  author: TimelineAuthor;
  at: string;
  kind: TimelineKind;
  version?: number;
}
export type FileRestorePromptResult = { ok: true; prompt: FileRestorePrompt } | { ok: false; reason: FileRefusal };
/** `hh:fileRestore`'s answer; `cancelled`: the person said no to main's confirmation. */
export type FileRestoreAnswer = { ok: true } | { ok: false; reason: FileRefusal | "cancelled" };
/** `client.files.restore`'s answer: done, the person said no, or refused. */
export type FileRestoreResult = "restored" | "cancelled" | { refused: FileRefusal };
/** A whole-folder or task go-back (`restore`, `restoreTask`): done, or the person said no to main's confirmation. */
export type GoBackResult = { ok: true } | { ok: false; reason: "cancelled" };
