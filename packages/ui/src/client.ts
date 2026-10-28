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
import type { ActivityKind, DocumentCard, EngineError, Event, LimitWindow } from "@humanharness/runtime";
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

export type { DataKey, DataQuery, DataQueryResult, DataRecord };

export type Appearance = "system" | "light" | "dark";

/** Settings › General › Text size: the whole window is zoomed by this factor (chrome, chat and the harness's blocks alike). */
export const TEXT_SIZES = { normal: 1, large: 1.15, larger: 1.3, largest: 1.5 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
const TEXT_SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZE_ORDER as string[]).includes(value);
}

/** One size bigger or smaller (staying put at either end), or back to normal: what ⌘+, ⌘− and ⌘0 do. */
export function stepTextSize(current: TextSize | undefined, step: "in" | "out" | "reset"): TextSize {
  if (step === "reset") return "normal";
  const i = TEXT_SIZE_ORDER.indexOf(current ?? "normal");
  return TEXT_SIZE_ORDER[Math.min(Math.max(i + (step === "in" ? 1 : -1), 0), TEXT_SIZE_ORDER.length - 1)];
}

/** The reader's look (document-reader spec §5.2): global app preferences. */
export interface ReaderPrefs {
  font?: "sans" | "serif";
  size?: "normal" | "large";
}

/** The valid part of saved reading preferences; null when nothing is valid. */
export function cleanReaderPrefs(value: unknown): ReaderPrefs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: ReaderPrefs = {
    ...(v.font === "sans" || v.font === "serif" ? { font: v.font } : {}),
    ...(v.size === "normal" || v.size === "large" ? { size: v.size } : {}),
  };
  return Object.keys(out).length > 0 ? out : null;
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
  /** Harnesses with profiles: the active profile's id (profiles spec §4). Only the main process changes it. */
  profile?: string;
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
  kind: "phase" | "wrap-up";
  phase?: string;
  by?: "agent" | "person" | "app";
  back?: true;
}

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
  /** The harness's modes, by id (task-modes spec). Absent: none (D0). */
  modes?: Record<string, ModeView>;
  /** The harness's setup steps, in order (setup-steps spec). Absent: none (D0). */
  setup?: SetupStepView[];
  /** The harness's profiles (manifest `profiles`): what to call one and its form. Absent: one implicit profile (D4). */
  profiles?: ProfilesInfo;
  /** The harness takes the person's material (manifest `material`). Absent: none (D0). */
  material?: MaterialInfo;
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
  /** The `.md` files this turn added or changed (document-reader spec §5.1). Absent: none. */
  documents?: DocumentCard[];
}

/** A piece of an answer: a run of text, or one of the entry's `blocks` (by index). */
export type AnswerPart = { text: string } | { block: number };

/**
 * `parts` with a text delta added: it extends the text run at the end, or starts one. A run never starts
 * with whitespace alone, so trimming the runs at the end never removes one.
 */
export function addText(parts: AnswerPart[], delta: string): AnswerPart[] {
  const last = parts.at(-1);
  if (last && "text" in last) return [...parts.slice(0, -1), { text: last.text + delta }];
  return delta.trim() ? [...parts, { text: delta.trimStart() }] : parts;
}

/** `parts` with a paragraph break: only inside a text run (a block already separates what comes after it). */
export function addParagraph(parts: AnswerPart[]): AnswerPart[] {
  const last = parts.at(-1);
  return last && "text" in last ? [...parts.slice(0, -1), { text: `${last.text}\n\n` }] : parts;
}

/** The text runs trimmed, as the entry saves them. */
export function finishParts(parts: AnswerPart[]): AnswerPart[] {
  return parts.map((p) => ("text" in p ? { text: p.text.trim() } : p));
}

/** The entry's answer in order; an entry saved before `parts` existed shows its text, then its blocks. */
export function partsOf(entry: Pick<ChatEntry, "text" | "blocks" | "parts">): AnswerPart[] {
  if (entry.parts) return entry.parts;
  return [...(entry.text ? [{ text: entry.text }] : []), ...entry.blocks.map((_, block) => ({ block }))];
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
  /** The task's phase when the commit was made (its `Phase:` trailer). */
  phase?: string;
}

/** A file a task added, changed or deleted. */
export type HistoryFileChange = FileChange;

// The history's commit subjects (raw git data, English; the History panel shows them through i18n keys).
export { BEFORE_MESSAGE, DATA_CHANGE_PREFIX, FILE_RESTORE_PREFIX, NOTE, RESTORE_POINT, RESTORE_TASK, START, STOPPED_PREFIX, TURN_PREFIX, UNDO_PREFIX } from "@humanharness/workspace/subjects";

/**
 * One row of the History panel: a task's commits, or the group of commits outside any task (`taskId: null`:
 * "Outside a task", which holds the restores too).
 */
export interface HistoryTaskView {
  taskId: string | null;
  actionId: string | null;
  /** The scope the task ran in (harnesses with scopes). */
  scopeId?: string;
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

/** A scope as the window sees it (spec §3.4). */
export type ScopeView = ScopeEntry;

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
  kind: "form" | "interview" | "component";
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

export type MaterialResult = { ok: true } | { ok: false; reason: "not-ready" | "unknown-scope" | "unknown-source" | "invalid" | "fetch" };
export type MaterialAddResult =
  | { ok: true; added: string[]; refused: { name: string; message: string }[] }
  | { ok: false; reason: "not-ready" | "unknown-scope" | "fetch" };

export interface MaterialClient {
  /** Null without material. */
  list(scope: string): Promise<MaterialView | null>;
  /** Opens the main process's file dialog, then takes in each file picked. */
  add(scope: string): Promise<MaterialAddResult>;
  addLink(scope: string, url: string): Promise<MaterialAddResult>;
  confirm(scope: string, id: string, choice: { pageRange?: [number, number]; sheets?: string[] | "summary" }): Promise<MaterialResult>;
  setGrounding(scope: string, mode: "strict" | "mixed"): Promise<MaterialResult>;
  /** Try again: a source whose AI stage failed goes back to that stage. */
  retry(scope: string, id: string): Promise<MaterialResult>;
  /**
   * The person's answer to a question (`fragment` null: about the whole source). `use` on a source waiting for a full
   * review goes on without it.
   */
  decide(scope: string, id: string, fragment: string | null, choice: MaterialChoice): Promise<MaterialResult>;
  /** Removes a source: its original goes to the system Trash, its fragments go (also Cancel on a waiting one). */
  remove(scope: string, id: string): Promise<MaterialResult>;
  /** Opens the original of a source or a fragment's source. */
  open(scope: string, id: string): Promise<MaterialResult>;
  /** A citation's label, "<source>, <location>"; null: no such fragment in the scope (the text stays as it is). */
  cite(scope: string, id: string): Promise<{ label: string } | null>;
  onChange(listener: (view: MaterialView) => void): () => void;
}

export { hearsDataChange } from "./data-change";

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
  restore(sha: string): Promise<void>;
  /** The history grouped by task, newest first; the group of commits outside any task last. */
  historyTasks(): Promise<HistoryTaskView[]>;
  /** Makes the folder look as it did before the task started (later tasks are undone too); recorded outside any task. */
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
  /** Copies the command for a step the person runs in Terminal (`terminalSteps`). */
  copySetupCommand(engineId: string, step: "login" | "logout"): Promise<void>;
  /** Opens the Terminal app (it runs nothing). */
  openTerminal(): Promise<void>;
  /** Shows ~/.humanharness/engines.json in Finder. */
  revealSharedConfig(): Promise<void>;
  /** Starts ~/.humanharness/engines.json over, keeping a dated copy of the old one. */
  resetSharedConfig(): Promise<void>;
  getUsage(): Promise<UsageSummary>;
  /** Shows the configured folder in Finder. */
  revealFolder(): Promise<void>;
  /** Moves the folder and its history to `to` (an absolute path that doesn't exist yet). Refused while a turn or a restore runs. */
  moveFolder(to: string): Promise<MoveResult>;
  /** The current task, how each action ended, and the notes. */
  getTasks(): Promise<TaskView>;
  onTasks(listener: (view: TaskView) => void): () => void;
  /**
   * The person picked an option of a `choices` block: a follow-up, another topic, or the next one on the path.
   * `task` is the task the block was shown for; a block of an earlier task is refused.
   */
  choose(option: ChoiceOption, task: string): Promise<void>;
  /**
   * The person's answer to input block `blockId` (input-blocks spec §4). Resolves with the refusal and its field
   * errors, or with the chat's line once the answer is taken; the agent's turn then arrives as events.
   */
  respond(blockId: string, value: Record<string, unknown>): Promise<RespondResult>;
  /**
   * The person picks a mode for the open task (task-modes spec §5): resolves with a refusal (with the tiers when the
   * mode asks for more) or with how the switch goes on; the switch's turn then arrives as events. `choice` answers the
   * tier question.
   */
  chooseMode(mode: string, choice?: ModeChoice): Promise<ModeResult>;
  /**
   * Every switch `chooseMode` started, whoever called it (the window's mode bar and blocks, or the harness's own UI),
   * told when its result arrives and before the switch's turn: the chat draws the "Switched to" line and that turn.
   */
  onModeSwitch(listener: (s: ModeSwitch) => void): () => void;
  /**
   * The person moves the open task `taskId` to phase `phaseId` (task-phases spec §4.2): resolves with a refusal or with
   * how the change goes on. A change turn then arrives as an `onTaskTurn` notice and its events.
   */
  setPhase(taskId: string, phaseId: string): Promise<PhaseResult>;
  /** Closes the open task now with the core closing turn (the stepper's Finish). False when it was stopped first. */
  finishTask(): Promise<boolean>;
  /** The time box's clock (spec §5): pause and resume; false when there was nothing to do. */
  pauseTask(): Promise<boolean>;
  resumeTask(): Promise<boolean>;
  /** "+5 min". */
  extendTimeBox(): Promise<boolean>;
  /** A turn the app starts on its own (a phase change, the wrap-up) is about to run: draw its line first. */
  onTaskTurn(listener: (n: TaskTurnNotice) => void): () => void;
  /** Opens a file inside the reference folders or the user's folder in its default app. False when refused or missing. */
  openPath(path: string): Promise<boolean>;
  /** Shows a file inside the reference folders or the user's folder in Finder (any kind of file). False when refused or missing. */
  revealPath(path: string): Promise<boolean>;
  /** A Markdown document inside the folder or a reference folder (document-reader spec §5.3). Never writes. */
  readDocument(path: string): Promise<DocumentRead>;
  /** A local image (png, jpeg, gif, webp) inside the folder or a reference folder, as a data: URL; null when refused. */
  readImage(path: string): Promise<string | null>;
  /** Whether each path is still there (a card of a moved or deleted file is struck through). */
  documentsExist(paths: string[]): Promise<boolean[]>;
  /** Calls `listener` after each change to the document; returns the unsubscribe. */
  watchDocument(path: string, listener: () => void): () => void;
  /** Opens a document in the reader panel, at the heading `anchor` when given (the harness's own UI may call it). */
  openDocument(path: string, anchor?: string): void;
  /** Every `openDocument`, whoever called it: the chat opens the panel. */
  onOpenDocument(listener: (path: string, anchor?: string) => void): () => void;
  /** Document reviews (review spec §5.6). Calls answer with data; only useful when `AppState.review` is set. */
  documents: {
    /** The record, its summary and the blob of the version read, for the reader. */
    view(path: string): Promise<ReviewView>;
    /** A harness view's summary of one document; null without a record or when it can't be read. */
    review(path: string): Promise<ReviewSummary | null>;
    summaries(paths: string[]): Promise<(ReviewSummary | null)[]>;
    answer(path: string, id: string, pick: AnswerPick): Promise<ReviewResult>;
    comment(path: string, input: CommentInput): Promise<ReviewResult>;
    /** Edits a draft, or deletes it with null. */
    editDraft(path: string, id: string, text: string | null): Promise<ReviewResult>;
    reopen(path: string, id: string): Promise<ReviewResult>;
    send(path: string): Promise<ReviewSendResult>;
    /** Approves the version shown: `blob` is the view's (a document changed since is refused with "changed"). */
    approve(path: string, blob: string, opts?: ApproveOptions): Promise<ReviewResult>;
    approvedText(path: string): Promise<ApprovedText>;
    /** Any review record or approval changed (`path`: its document). Returns the unsubscribe. */
    onChange(listener: (path: string) => void): () => void;
    /** Opens the document in the reader in focus mode (§6.2). */
    focus(path: string): void;
    /** Every `focus(path)`, whoever called it: the chat listens. */
    onFocus(listener: (path: string) => void): () => void;
  };
  /** Focus mode (§6.2): the chat sets it; a harness view listens to pause its own interruptions. */
  focus: {
    current(): FocusState;
    onChange(listener: (state: FocusState) => void): () => void;
    /** The core's chat only. */
    set(state: FocusState): void;
  };
  /** File timelines (file-timeline spec §6.3). Every call answers with data; the core always confirms a go-back. */
  files: {
    /** The file's entries, newest first. */
    timeline(path: string): Promise<FileTimelineResult>;
    /** What changed between two commits, or from a commit to the file now ("current"); `from` null: nothing before. */
    diff(path: string, from: string | null, to: string | "current"): Promise<FileDiffResult>;
    /** Brings the file back to `commit` (an entry's `to`) after the core's confirmation; nothing else changes. */
    restore(path: string, commit: string): Promise<FileRestoreResult>;
    /** A commit touched `path`: its timeline has a new entry. Returns the unsubscribe. */
    onChange(path: string, listener: () => void): () => void;
    /** The core's chat only: answers the confirmation every `restore` shows. Returns the unregister. */
    hostConfirm(confirm: (prompt: FileRestorePrompt) => Promise<boolean>): () => void;
  };
  /** Harnesses with scopes (spec §3.4). There is no delete: archive instead. */
  scopes: {
    list(): Promise<ScopeView[]>;
    create(title: string): Promise<ScopeView>;
    rename(id: string, title: string): Promise<ScopeView>;
    /** Archiving the open scope closes it first. */
    archive(id: string): Promise<void>;
    unarchive(id: string): Promise<void>;
    /** Opens a scope (null: none), closing the open task first; false when that close was stopped. */
    open(id: string | null): Promise<boolean>;
    current(): Promise<string | null>;
    onChange(listener: (view: ScopesView) => void): () => void;
  };
  /** The harness's data (spec §4.5), as the person: the same checks as the agent's tools. `settings` is read-only here: use `settings`. */
  data: {
    get(collection: string, key?: DataKey, options?: DataOptions): Promise<DataRecord | null>;
    query(collection: string, query?: DataQuery, options?: DataOptions): Promise<DataQueryResult>;
    put(collection: string, record: DataRecord, options?: DataOptions): Promise<DataRecord>;
    patch(collection: string, key: DataKey | undefined, patch: DataRecord, options?: DataOptions): Promise<DataRecord>;
    delete(collection: string, key?: DataKey, options?: DataOptions): Promise<boolean>;
    /** Every write to `collection` (in `scope`; null: any scope), from any writer. App-wide collections ignore the scope. */
    subscribe(collection: string, scope: string | null, listener: (change: DataChangeView) => void): () => void;
  };
  /** What a task changed in the harness's data ("what changed in this session", spec §4.5). */
  dataDiff(taskId: string): Promise<DataDiffView[]>;
  /** The harness's settings (harness-settings spec §4). A harness with none answers no values and refuses changes. */
  settings: {
    /** Every field's value (the default when unchanged) and the fields waiting for the next task. */
    get(): Promise<SettingsState>;
    /** Saves one field now, as the person. Refusals come back as data. */
    set(field: string, value: unknown): Promise<SettingsResult>;
    /** Every field back to its default. */
    reset(): Promise<SettingsResult>;
    onChange(listener: (state: SettingsState) => void): () => void;
  };
  /** The harness's setup steps (setup-steps spec). A harness with none answers no steps and refuses every change. */
  setupSteps: {
    get(): Promise<SetupStepsState>;
    /** A form step's current values: the record's fields it asks for, or the settings' values. */
    values(id: string): Promise<Record<string, unknown>>;
    /** A form step's Next: saved through the same checks as any write. Refusals come back as data. */
    submit(id: string, value: Record<string, unknown>): Promise<SetupStepResult>;
    /** An interview's end (its task closed, its record valid) or a component's `done()`. */
    complete(id: string): Promise<SetupStepResult>;
    skip(id: string): Promise<SetupStepResult>;
    /** The setup screen reached "All set". */
    finish(): Promise<SetupStepsState>;
    /** Settings showed the list: steps a harness update added count from now on. */
    acknowledge(): Promise<SetupStepsState>;
    onChange(listener: (state: SetupStepsState) => void): () => void;
  };
  /** The harness's profiles (profiles spec §5). A harness with none answers none and refuses every change. */
  profiles: {
    get(): Promise<ProfilesState>;
    /** A new profile from the form's fields; it becomes the active one (the open task closes first). */
    create(values: Record<string, unknown>): Promise<ProfileResult>;
    /** Switches to a profile (the open task closes first). */
    open(id: string): Promise<ProfileResult>;
    /**
     * Saves the edit form's fields to the active profile's record, as the person. A field sent with no value is cleared;
     * refusals come back by field (`errors`).
     */
    edit(values: Record<string, unknown>): Promise<ProfileResult>;
    archive(id: string): Promise<ProfileResult>;
    unarchive(id: string): Promise<ProfileResult>;
    /** Puts a profile's folder and history in the system Trash. Never the active one. */
    delete(id: string): Promise<ProfileResult>;
    onChange(listener: (state: ProfilesState) => void): () => void;
  };
  /** The person's material (material spec §10). A harness without material answers null and "not-ready". */
  material: MaterialClient;
  /** The text size changed from the keyboard (⌘+, ⌘−, ⌘0), already saved. */
  onTextSize(listener: (size: TextSize) => void): () => void;
}

/** A config with everything a turn needs (appearance and text size stay optional). */
export type ConfiguredApp = AppConfig & Required<Pick<AppConfig, "language" | "folder" | "engineId">>;

export function isConfigured(config: AppConfig): config is ConfiguredApp {
  return Boolean(config.language && config.folder && config.engineId);
}

export type { DocumentCard } from "@humanharness/runtime";
export type { BlockAnswer, ChoiceOption, Event, EngineError, InputField, InputIssue, InputSpec, LimitWindow, RespondResult, SettingFieldView, SettingsView };

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
/** What the core's confirmation says before a file goes back (§5). */
export interface FileRestorePrompt {
  path: string;
  author: TimelineAuthor;
  at: string;
  kind: TimelineKind;
  version?: number;
}
export type FileRestorePromptResult = { ok: true; prompt: FileRestorePrompt } | { ok: false; reason: FileRefusal };
export type FileRestoreAnswer = { ok: true } | { ok: false; reason: FileRefusal };
/** `client.files.restore`'s answer: done, the person said no (or no core is there to ask), or refused. */
export type FileRestoreResult = "restored" | "cancelled" | { refused: FileRefusal };
