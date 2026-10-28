import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProfile } from "@humanharness/engines";
import { BLOCK_ID, MODE_ID, PHASE_ID, PLUGIN_ID } from "@humanharness/harness-sdk";
import type { Session } from "@humanharness/runtime";
import type { ActionStatus, TaskStatus } from "@humanharness/ui/client";
import { MAIN_SCOPE, isScopeDir, isScopeId, tasksFile } from "@humanharness/workspace";
import { cleanProfile } from "./models";

/** The input block the task waits an answer for (input-blocks spec §4): its id, its block's name, when it was shown. */
export interface PendingInput {
  blockId: string;
  block: string;
  shownAt: string;
}

/** Who moved the task into a phase (task-phases spec §4.4). */
export type PhaseBy = "agent" | "person" | "app";
/** One entry of the phase log: the phase entered, when, and by whom. */
export interface PhaseLogEntry {
  id: string;
  at: string;
  by: PhaseBy;
}
/** The task's time box (spec §5): minutes chosen, time folded in, and since when the clock runs (absent: paused). */
export interface TimeBoxState {
  minutes: number;
  usedMs: number;
  runningSince?: string;
  /** The wrap-up ran: it never runs again, even after "+5 min". */
  wrappedUp?: true;
  /** The 100% step ran; "+5 min" clears it so it runs again at the new end. */
  ended?: true;
}

/** The task in progress: one engine session from its first turn to its note. */
export interface CurrentTask {
  id: string;
  /** The manifest action; absent for a free question. */
  action?: string;
  /** The question that started a free-question task, whole up to QUESTION_MAX characters. */
  question?: string;
  /** The question was longer than QUESTION_MAX and was cut: a resumed session is told so. */
  questionCut?: boolean;
  status: TaskStatus;
  /** The engine session, once the engine started it. */
  session?: Session;
  startedAt: string;
  /** Turns finished so far. */
  turns: number;
  /** The agent's note for this task was written. */
  noteSaved?: boolean;
  /** The model, effort and cap the task runs on, resolved when it started (resources spec §5). */
  profile?: ModelProfile;
  /** Context in use by the task's session after its last turn, and the window when the engine said. */
  context?: { used: number; size?: number };
  /** A checkpoint ran since the last compaction (spec §6). */
  checkpointed?: boolean;
  /** A checkpoint wrote this task's note; the closing turn still updates it. */
  checkpointNote?: boolean;
  /** `turns` when the last checkpoint note was written: a turn after it isn't in that note. */
  checkpointTurns?: number;
  /** The engine session was lost (the folder moved): the next turn starts a new one from the notes. */
  resume?: boolean;
  /** The scope the task runs in (`_app` for app-wide work). Absent in a harness without scopes (spec D2). */
  scope?: string;
  /** The question the task waits on: the last input block shown (spec D5). Absent in a harness with none (D0). */
  pendingInput?: PendingInput;
  /** The mode the task works in now (task-modes spec §5.5). Absent: none picked yet, or a harness without modes (D0). */
  mode?: string;
  /** Every mode the task used, in first-use order: the closing note lists them. */
  modes?: string[];
  /** The task runs below its mode's `minTier`: the person chose to continue (spec §5.3). */
  belowMinTier?: true;
  /** The phase the task is in now (task-phases spec §6). Absent: an action without phases (D0). */
  phase?: { id: string; startedAt: string };
  /** Every phase change, oldest first, at most PHASE_LOG_MAX. */
  phases?: PhaseLogEntry[];
  /** The agent asked to move and the person hasn't answered (spec §4.1). */
  phaseProposal?: { to: string; reason: string };
  /** The time box chosen at the start (spec §5). */
  timeBox?: TimeBoxState;
  /** A mode the current phase doesn't allow, kept to come back (modes spec §7). Never next to `mode`. */
  suspendedMode?: string;
  /** The plugin whose prepared task this is (plugins spec §5.3): its commits carry `Plugin: <id>`. */
  plugin?: string;
  /** Tokens the task's turns used so far (parallel spec §9.1 `TaskSummary.tokens`). Board mode only: kept in `lanes`. */
  tokens?: number;
  /** Paths another task also changed (spec §5.3), newest notice last, at most CONFLICT_MAX. Board mode only. */
  conflict?: string[];
}

/** `<folder>/.harness/tasks.json`: the current task and how each action ended. Replaces the runtime's session.json. */
export interface TasksFile {
  version: 1;
  /** The engine that ran the last task. */
  engine?: string;
  current: CurrentTask | null;
  /** How each action ended in `main`: every action of a harness without scopes (spec D2). */
  actions: Record<string, ActionStatus>;
  /** Harnesses with scopes: the open scope; absent when none is open. */
  open?: string;
  /** Harnesses with scopes: how each action ended in every scope other than `main` (`_app` included). */
  scopes?: Record<string, Record<string, ActionStatus>>;
  /** Board mode (parallel spec §6): every open task. Absent in a harness without `parallel` (D0); `current` stays null then. */
  lanes?: CurrentTask[];
  /** Board mode: the task the window shows; null or absent: the start view. */
  focus?: string | null;
}

export const emptyTasks = (): TasksFile => ({ version: 1, current: null, actions: {} });

/** How much of a free question tasks.json keeps (a resumed session gets it back): generous, but bounded. */
export const QUESTION_MAX = 20_000;

/** The question as tasks.json keeps it: whole up to QUESTION_MAX, otherwise cut and marked. */
export function keptQuestion(text: string): { question: string; questionCut?: true } {
  return text.length > QUESTION_MAX ? { question: text.slice(0, QUESTION_MAX), questionCut: true } : { question: text };
}

/** How many modes tasks.json keeps for a task: a bound on a hand-edited file. */
export const MODES_MAX = 50;

/** How many phase changes tasks.json keeps for a task: a bound on a hand-edited file. */
export const PHASE_LOG_MAX = 200;
/** The longest time box a task can reach with "+5 min": a bound on a hand-edited file. */
export const TIME_BOX_MINUTES_MAX = 24 * 60;
const PHASE_BY: readonly string[] = ["agent", "person", "app"];

/** How many open tasks tasks.json keeps (board mode): a bound on a hand-edited file. */
export const LANES_MAX = 32;
/** How many conflicting paths a lane keeps, newest last. */
export const CONFLICT_MAX = 20;
/** A lane's id is its task id, its slot key and an IPC argument (parallel threat model P1): at most this long. */
export const LANE_ID_MAX = 200;
const CONFLICT_PATH_MAX = 1024;

/** What the manifest declares, when known: mode ids, and each action's phase ids. */
export interface Known {
  modes?: ReadonlySet<string>;
  phases?: ReadonlyMap<string, readonly string[]>;
}

const ACTION_STATUSES: readonly string[] = ["done", "unsaved", "unfinished"];
const TASK_STATUSES: readonly string[] = ["running", "waiting", "closing", "checkpoint"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * An engine session id: UUIDs (Claude, Codex, Gemini) and the fake agent's `fake-acp-session-2`.
 * Never a leading `-` or whitespace, so it can't read as a CLI flag.
 */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function cleanSession(s: unknown): Session | undefined {
  if (!isObject(s) || typeof s.id !== "string" || !SESSION_ID.test(s.id) || typeof s.started !== "boolean") return undefined;
  return { id: s.id, started: s.started };
}

function cleanTimeBox(t: unknown): TimeBoxState | undefined {
  if (!isObject(t)) return undefined;
  const { minutes, usedMs, runningSince } = t;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > TIME_BOX_MINUTES_MAX) return undefined;
  if (typeof usedMs !== "number" || !Number.isFinite(usedMs) || usedMs < 0) return undefined;
  const since = typeof runningSince === "string" && Number.isFinite(Date.parse(runningSince)) ? runningSince : undefined;
  return {
    minutes,
    usedMs,
    ...(since ? { runningSince: since } : {}),
    ...(t.wrappedUp === true ? { wrappedUp: true as const } : {}),
    ...(t.ended === true ? { ended: true as const } : {}),
  };
}

const BLOCK_NAME = /^[a-z][a-z0-9_]*$/;

/** The pending input of task `taskId`: a block id of another task (a hand-edited file) is dropped. */
function cleanPending(p: unknown, taskId: string): PendingInput | undefined {
  if (!isObject(p) || typeof p.blockId !== "string" || !BLOCK_ID.test(p.blockId) || !p.blockId.startsWith(`${taskId}:`)) return undefined;
  if (typeof p.block !== "string" || !BLOCK_NAME.test(p.block) || typeof p.shownAt !== "string") return undefined;
  return { blockId: p.blockId, block: p.block, shownAt: p.shownAt };
}

/** Built field by field: nothing from the file reaches the engine unchecked. */
function cleanCurrent(c: unknown, known: Known = {}): CurrentTask | null {
  if (!isObject(c) || typeof c.id !== "string" || !TASK_STATUSES.includes(c.status as string)) return null;
  const session = cleanSession(c.session);
  const profile = cleanProfile(c.profile);
  const pending = cleanPending(c.pendingInput, c.id);
  const tokens = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const ctx = isObject(c.context) && tokens(c.context.used) ? { used: c.context.used, ...(tokens(c.context.size) ? { size: c.context.size } : {}) } : undefined;
  // A mode the manifest no longer declares is dropped (task-modes spec §6); `known` absent: the shape alone.
  const isMode = (v: unknown): v is string => typeof v === "string" && MODE_ID.test(v) && (!known.modes || known.modes.has(v));
  const mode = isMode(c.mode) ? c.mode : undefined;
  const modes = Array.isArray(c.modes) ? [...new Set(c.modes.filter(isMode))].slice(0, MODES_MAX) : [];
  // A phase the action no longer declares is dropped (task-phases spec §6); `known.phases` absent: the shape alone.
  const action = typeof c.action === "string" ? c.action : undefined;
  const declared = known.phases ? ((action !== undefined ? known.phases.get(action) : undefined) ?? []) : undefined;
  const isPhase = (v: unknown): v is string => typeof v === "string" && PHASE_ID.test(v) && (!declared || declared.includes(v));
  const phase = isObject(c.phase) && isPhase(c.phase.id) && typeof c.phase.startedAt === "string" ? { id: c.phase.id, startedAt: c.phase.startedAt } : undefined;
  const log = Array.isArray(c.phases)
    ? c.phases
        .filter((e): e is PhaseLogEntry => isObject(e) && isPhase(e.id) && typeof e.at === "string" && PHASE_BY.includes(e.by as string))
        .map((e) => ({ id: e.id, at: e.at, by: e.by }))
        .slice(-PHASE_LOG_MAX)
    : [];
  const p = c.phaseProposal;
  const proposal = phase && isObject(p) && isPhase(p.to) && typeof p.reason === "string" ? { to: p.to, reason: p.reason.slice(0, 300) } : undefined;
  const timeBox = cleanTimeBox(c.timeBox);
  return {
    id: c.id,
    ...(typeof c.action === "string" ? { action: c.action } : {}),
    ...(typeof c.question === "string" ? keptQuestion(c.question) : {}),
    ...(c.questionCut === true && typeof c.question === "string" ? { questionCut: true } : {}),
    status: c.status as TaskStatus,
    ...(session ? { session } : {}),
    startedAt: typeof c.startedAt === "string" ? c.startedAt : "",
    turns: typeof c.turns === "number" && Number.isFinite(c.turns) ? c.turns : 0,
    ...(typeof c.noteSaved === "boolean" ? { noteSaved: c.noteSaved } : {}),
    ...(profile ? { profile } : {}),
    ...(ctx ? { context: ctx } : {}),
    ...(typeof c.checkpointed === "boolean" ? { checkpointed: c.checkpointed } : {}),
    ...(typeof c.checkpointNote === "boolean" ? { checkpointNote: c.checkpointNote } : {}),
    ...(typeof c.checkpointTurns === "number" && Number.isFinite(c.checkpointTurns) ? { checkpointTurns: c.checkpointTurns } : {}),
    ...(c.resume === true ? { resume: true } : {}),
    ...(isScopeDir(c.scope) ? { scope: c.scope } : {}),
    ...(pending ? { pendingInput: pending } : {}),
    ...(mode ? { mode } : {}),
    ...(modes.length > 0 ? { modes } : {}),
    ...(mode && c.belowMinTier === true ? { belowMinTier: true as const } : {}),
    ...(phase ? { phase } : {}),
    ...(log.length > 0 ? { phases: log } : {}),
    ...(proposal ? { phaseProposal: proposal } : {}),
    ...(timeBox ? { timeBox } : {}),
    ...(!mode && isMode(c.suspendedMode) ? { suspendedMode: c.suspendedMode } : {}),
    ...(typeof c.plugin === "string" && PLUGIN_ID.test(c.plugin) ? { plugin: c.plugin } : {}),
  };
}

const isLaneId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= LANE_ID_MAX;

/**
 * Board mode's open tasks (parallel spec §6): each entry cleaned as `current` is, plus `tokens` and `conflict`.
 * Entries that don't read as a task, a repeated id (the first wins) and any past LANES_MAX are dropped.
 */
export function cleanLanes(raw: unknown, known: Known = {}): CurrentTask[] {
  if (!Array.isArray(raw)) return [];
  const out: CurrentTask[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= LANES_MAX) break;
    if (!isObject(entry) || !isLaneId(entry.id) || seen.has(entry.id)) continue;
    const task = cleanCurrent(entry, known);
    if (!task) continue;
    seen.add(task.id);
    const { tokens, conflict } = entry;
    const paths = Array.isArray(conflict)
      ? [...new Set(conflict.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= CONFLICT_PATH_MAX))].slice(-CONFLICT_MAX)
      : [];
    out.push({
      ...task,
      ...(typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 ? { tokens } : {}),
      ...(paths.length > 0 ? { conflict: paths } : {}),
    });
  }
  return out;
}

function statuses(raw: unknown): Record<string, ActionStatus> {
  const out: Record<string, ActionStatus> = {};
  if (isObject(raw)) {
    for (const [id, status] of Object.entries(raw)) {
      if (typeof status === "string" && ACTION_STATUSES.includes(status)) out[id] = status as ActionStatus;
    }
  }
  return out;
}

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown, known: Known = {}): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  let scopes: Record<string, Record<string, ActionStatus>> | undefined;
  if (isObject(raw.scopes)) {
    scopes = {};
    for (const [id, v] of Object.entries(raw.scopes)) if (isScopeDir(id) && id !== MAIN_SCOPE) scopes[id] = statuses(v);
  }
  return {
    version: 1,
    ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}),
    current: cleanCurrent(raw.current, known),
    actions: statuses(raw.actions),
    ...(isScopeId(raw.open) ? { open: raw.open } : {}),
    ...(scopes ? { scopes } : {}),
    // Board mode only: a file without the key reads without it (D0), so it saves back unchanged.
    ...("lanes" in raw ? { lanes: cleanLanes(raw.lanes, known) } : {}),
    ...(raw.focus === null || isLaneId(raw.focus) ? { focus: raw.focus } : {}),
  };
}

/** The scope a task runs in: `main` when it has none (a harness without scopes). */
export const scopeOfTask = (c: Pick<CurrentTask, "scope">): string => c.scope ?? MAIN_SCOPE;

/** How each action ended in `scope`; `main`'s are the `actions` field. */
export function statusesIn(s: TasksFile, scope: string): Record<string, ActionStatus> {
  return scope === MAIN_SCOPE ? s.actions : (s.scopes?.[scope] ?? {});
}

/** `s` with `action` marked `status` in `scope`. */
export function withStatus(s: TasksFile, scope: string, action: string, status: ActionStatus): TasksFile {
  if (scope === MAIN_SCOPE) return { ...s, actions: { ...s.actions, [action]: status } };
  return { ...s, scopes: { ...s.scopes, [scope]: { ...statusesIn(s, scope), [action]: status } } };
}

/**
 * The open task ends without a note: its action gets `outcome` (unfinished by default), unless the task
 * saved its note anyway (a checkpoint's note counts) or an earlier task already got it done.
 */
export function interrupted(state: TasksFile, outcome: ActionStatus = "unfinished"): TasksFile {
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const scope = scopeOfTask(c);
  const status: ActionStatus = c.noteSaved || c.checkpointNote || statusesIn(state, scope)[c.action] === "done" ? "done" : outcome;
  return { ...withStatus(state, scope, c.action, status), current: null };
}

/**
 * Board mode's start after a quit (parallel Decision 16): every open lane ends without a note, each as `interrupted`
 * ends `current`, oldest first. A file without lanes (D0) is returned as is.
 */
export function interruptedLanes(state: TasksFile, outcome: ActionStatus = "unfinished"): TasksFile {
  if (!state.lanes) return state;
  let s: TasksFile = state;
  for (const lane of state.lanes) s = interrupted({ ...s, current: lane }, outcome);
  return { ...s, current: state.current, lanes: [], ...("focus" in state ? { focus: null } : {}) };
}

export class TaskStore {
  readonly file: string;
  /** The manifest's mode ids and each action's phase ids, when given: what tasks.json names outside them is dropped. */
  private readonly known: Known;

  constructor(folder: string, opts: { modes?: readonly string[]; phases?: Record<string, readonly string[]> } = {}) {
    this.file = tasksFile(folder);
    this.known = {
      ...(opts.modes ? { modes: new Set(opts.modes) } : {}),
      ...(opts.phases ? { phases: new Map(Object.entries(opts.phases)) } : {}),
    };
  }

  /** A missing file reads as empty; one that isn't JSON is set aside as `tasks.json.corrupt-<time>`; other errors are thrown. */
  async load(): Promise<TasksFile> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyTasks();
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return emptyTasks();
    }
    return clean(raw, this.known);
  }

  /** Atomic: temp file + rename. */
  async save(state: TasksFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** After an engine change: the open task ends (its session belongs to the old engine) and the file no longer names that engine. */
  async forgetEngine(): Promise<void> {
    const { engine: _old, ...rest } = interrupted(await this.load());
    await this.save(rest);
  }
}
