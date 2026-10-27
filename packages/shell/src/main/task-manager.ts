import { randomUUID } from "node:crypto";
import type { ModelProfile } from "@humanharness/engines";
import {
  type BlockAnswer,
  type ChoiceOption,
  type HarnessPhase,
  type HarnessTimeBox,
  type InputBlock,
  type InputIssue,
  type Language,
  type PhaseRequest,
  type RespondResult,
  type SavedNote,
  type ScopeMode,
  type Tier,
  answerDisplay,
  answerMessage,
  answerRecords,
  defaultModeOf,
  parseAnswer,
  phaseModes,
  saveNoteSchema,
  setPhaseSchema,
  tierBelow,
} from "@humanharness/harness-sdk";
import { type Event, type Session, fail } from "@humanharness/runtime";
import {
  type ActionStatus,
  type CurrentTaskView,
  type ModeChoice,
  type ModeResult,
  type NoteView,
  type PhaseResult,
  type TaskStatus,
  type TaskTurnNotice,
  type TaskView,
  type TimeBoxView,
  nextInPath,
} from "@humanharness/ui/client";
import { APP_SCOPE, type HistoryTrailer, MAIN_SCOPE, NOTE_PREFIX, type Note, type NoteMeta, buildNotesIndex, isScopeId, noteSlug } from "@humanharness/workspace";
import {
  CHECKPOINT_PROMPT,
  type ModeText,
  type PhaseText,
  QUESTION_PROMPT,
  closePrompt,
  fillPrompt,
  interviewSection,
  modePrompt,
  modeSection,
  oneLine,
  phasePrompt,
  phaseSection,
  phasesSection,
  recommendSection,
  resumeMessage,
  wrapUpPrompt,
} from "./task-prompts";
import {
  type CurrentTask,
  PHASE_LOG_MAX,
  type PendingInput,
  type PhaseBy,
  TIME_BOX_MINUTES_MAX,
  type TasksFile,
  type TimeBoxState,
  interrupted,
  keptQuestion,
  scopeOfTask,
  statusesIn,
  withStatus,
} from "./task-store";
import { EXTEND_MINUTES, MINUTE_MS, formatTimeLeft, nextDue, paused, remainingMs, running, usedMs } from "./time-box";
import { type TurnOptions, isHeld, takesInputs } from "./turn-controller";

type Done = Extract<Event, { type: "done" }>;

/** The turn never started (the app is closing, another turn runs, the app isn't set up): nothing ran. */
class TurnNotStarted extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

export interface TaskDeps {
  /** tasks.json of the configured folder. */
  store: { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void> };
  turns: { send(message: string, options: TurnOptions): Promise<void>; isBusy(): boolean; cancel(): void };
  /**
   * The harness's actions: their labels (English strings), where each runs with scopes, their modes (task-modes spec
   * §3), their phases and time box (task-phases spec §3).
   */
  actions: Record<string, { label: string; scope?: ScopeMode; modes?: string[]; defaultMode?: string; phases?: HarnessPhase[]; timeBox?: HarnessTimeBox }>;
  /** The harness declares scopes (spec D1). Absent or false: one implicit `main` scope and today's layout (D2). */
  scoped?: boolean;
  /** Whether `id` is a registered scope. Absent: any valid id is taken. */
  scopeExists?(id: string): Promise<boolean>;
  /** The guided path: action ids in order. */
  path: string[];
  /** The text of the action's brief (its prompt file). */
  readPrompt(action: string): Promise<string>;
  language(): Promise<Language>;
  engine(): Promise<string>;
  /** The notes of `scope` (the flat notes folder in a harness without scopes), newest first. */
  notes(scope?: string): Promise<Note[]>;
  /** Writes a note; `scope` is passed only in a harness with scopes. */
  writeNote(slug: string, note: SavedNote, meta: NoteMeta, scope?: string): Promise<void>;
  /** Whether the note `<slug>.md` exists in `scope`'s notes (readable or not). Defaults to the slugs of `notes(scope)`. */
  noteExists?(slug: string, scope?: string): Promise<boolean>;
  /** The data tables a new session's first message carries after the notes (spec §4.4); "" for none. */
  dataContext?(scope: string, action: string | undefined): Promise<string>;
  /** The scope's material section, after the data (material spec §9 Load); "" for none. Absent without material (D0). */
  materialContext?(scope: string): Promise<string>;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. */
  endSession(): Promise<void>;
  /** Records the folder in the local history (a note was written), tagged with the task it belongs to. */
  saveHistory?(message: string, trailer?: HistoryTrailer): Promise<void>;
  /** The task view changed: tell the window. */
  changed(view: TaskView): void;
  /**
   * Sends an event to the window (the path turns use). The manager sends a cancelled `done` when an
   * operation stops before its turn reached the window, so the window drops the turn it shows.
   */
  emit?(e: Event): void;
  /**
   * The model profile a new task runs on, resolved once when it starts (resources spec §5). `floor`: a mode's `minTier`
   * the new task must reach (task-modes spec §5.3), passed only when there is one. Absent: the engine's defaults.
   */
  profileFor?(action: string | undefined, floor?: Tier): Promise<ModelProfile>;
  /** The profile to retry a first turn with after `model-unavailable`, or null when none is left (spec §5.3). */
  fallbackFor?(profile: ModelProfile, tried: string[]): Promise<ModelProfile | null>;
  /**
   * A stored profile (tasks.json) fitted again to what its engine offers now, before a resumed task runs
   * on it: an effort the engine stopped offering never reaches argv or CODEX_CONFIG. Absent: used as stored.
   */
  fitProfile?(profile: ModelProfile): Promise<ModelProfile>;
  /** A compaction was detected in `task`'s session (usage.jsonl `kind: "compaction"`). Failures are logged. */
  recordCompaction?(task: CurrentTask): Promise<void>;
  /** The harness's blocks the person answers, by name (input-blocks spec). Absent or empty: none (spec D0). */
  inputBlocks?: Record<string, InputBlock>;
  /** Puts an answer on its block in the chat of `chat` (input-blocks spec §8). False (logged): no unanswered block had that id. */
  markAnswered?(chat: string, answer: BlockAnswer): Promise<boolean>;
  /** Writes an answer's records to a data collection, as the person, in `scope` (spec §6 `saveTo`). Throws a refusal. */
  saveAnswer?(collection: string, records: Record<string, unknown>[], scope: string): Promise<void>;
  /**
   * No task's session runs now: one just ended (closed, interrupted, failed), or a new one is about to start. The
   * harness's settings rewrite AGENTS.md here (harness-settings spec D4). Failures are logged. Absent: nothing (D0).
   */
  betweenTasks?(): Promise<void>;
  /** The harness's modes (task-modes spec §3): label, minimum tier, the agent's hint. Absent or empty: none (D0). */
  modes?: Record<string, { label: string; minTier?: Tier; recommend?: string }>;
  /** The text of a mode's brief (its file). */
  readModeBrief?(mode: string): Promise<string>;
  /** A mode's settings as sentences with the person's values (harness-settings spec §6). Absent: none. */
  modeSettings?(mode: string): Promise<string[]>;
  /** The tier a profile counts as (a custom one: its nearest, spec §5.3). Absent: tiers are never compared. */
  tierOf?(profile: ModelProfile): Promise<Tier>;
  /** The text of a phase's brief (its file); only asked for a phase that has one. */
  readPhaseBrief?(action: string, phase: string): Promise<string>;
  /** A turn the app starts on its own is about to run (task-phases spec §4.4, §5): tell the window before its events. */
  taskTurn?(notice: TaskTurnNotice): void;
  /** How long a time-box minute lasts. Absent: a real minute. Tests and mock mode pass a short one. */
  minuteMs?: number;
  /** Each interview step's action and the collection it writes (setup-steps spec §3). Absent or empty: none (D0). */
  interviews?: Record<string, string>;
  /** The time box's timer. Absent: setTimeout and clearTimeout. */
  timer?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  now?: () => Date;
  newId?: () => string;
}

/** A `required` action was started with no scope open (spec §3.3): nothing was closed or started. */
export class ScopeRequired extends Error {
  constructor() {
    super("Open a scope first");
    this.name = "ScopeRequired";
  }
}

/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"). */
export const APP_INDEX_TOKENS = 500;

/** The error the caller sees: the turn's own reason when it never started. */
const unwrap = (err: unknown) => (err instanceof TurnNotStarted ? err.reason : err);

const noteView = (n: Note): NoteView => ({
  slug: n.slug,
  title: n.title,
  ...(n.action ? { action: n.action } : {}),
  date: n.date,
  summary: n.summary,
  decisions: n.decisions,
  path: n.path,
});

/** Share of the task's cap at which the checkpoint runs (spec D4). */
export const CHECKPOINT_AT = 0.8;
/** Claude doesn't report compactions: the context falling by more than this share means one happened. */
const COMPACTED_DROP = 0.5;

/** The context reached 80% of the task's cap and no checkpoint ran since the last compaction (spec §6). */
export function needsCheckpoint(c: CurrentTask): boolean {
  return c.profile !== undefined && c.context !== undefined && c.checkpointed !== true && c.context.used >= CHECKPOINT_AT * c.profile.cap;
}

/** The open task as the window sees it: no session, no prompt, just what the screen shows. `tier` only for a task with modes. */
const currentView = (c: CurrentTask, tier?: Tier, timeBox?: TimeBoxView): CurrentTaskView => ({
  id: c.id,
  ...(c.action ? { action: c.action } : {}),
  ...(c.scope ? { scope: c.scope } : {}),
  status: c.status,
  ...(c.profile && c.context ? { context: { used: c.context.used, cap: c.profile.cap } } : {}),
  ...(c.profile?.fallbackFrom
    ? { fallback: { model: c.profile.fallbackFrom, ...(c.profile.model !== undefined && c.profile.tier !== "custom" ? { tier: c.profile.tier } : {}) } }
    : {}),
  ...(c.pendingInput ? { pendingInput: c.pendingInput.blockId } : {}),
  ...(c.mode ? { mode: c.mode } : {}),
  ...(c.modes ? { modes: c.modes } : {}),
  ...(tier ? { tier } : {}),
  ...(c.belowMinTier ? { belowMinTier: true as const } : {}),
  ...(c.phase ? { phase: c.phase.id } : {}),
  ...(c.phases ? { phases: c.phases } : {}),
  ...(c.phaseProposal ? { phaseProposal: c.phaseProposal } : {}),
  ...(timeBox ? { timeBox } : {}),
});

/** How much of the last checkpoint's summary a mode switch carries (spec §10.1): `save_note`'s own limits. */
const SO_FAR_POINTS = 5;
const SO_FAR_CHARS = 400;
/** setTimeout's longest delay: a longer wait fires early and is armed again. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * What entering a phase does, worked out before anything changes (a brief that can't be read changes nothing): the change
 * turn's message (null: no turn) and the task's mode fields afterwards (modes spec §7; absent: unchanged).
 */
interface PhasePlan {
  message: string | null;
  modes?: { mode?: string; modes?: string[]; suspendedMode?: string; belowMinTier?: true };
}

/**
 * The app-driven flow (spec §4.2): one engine session per task. idle → running → waiting; a message
 * while waiting follows up in the same session; picking "next" or another topic closes the task with
 * one quiet turn asking for `save_note`, writes the note and starts the next task in a fresh session
 * whose first message carries the notes index. Cancel, a failed first turn and interruptions end the
 * task as unfinished.
 */
export class TaskManager {
  /** Task operations (each may run several turns), one after another. */
  private ops: Promise<unknown> = Promise.resolve();
  /** Changes to tasks.json, one after another. */
  private writes: Promise<unknown> = Promise.resolve();
  private running = false;
  /** The person cancelled during the running operation: no further turn of it starts. */
  private cancelRequested = false;
  /** The app is closing: no new operation, no further turn. */
  private closed = false;
  /** A `done` of the running operation reached the window: the turn it showed has ended there. */
  private windowDone = false;
  /** The task whose turn runs now: a session reported outside it is ignored. */
  private turnTask: string | null = null;
  /** Counts the turns that started (a `done` came or the send returned): `respond` knows whether its turn ran. */
  private turnsStarted = 0;
  /** How the last turn that started ended: `respond` reopens its question when the answer's turn failed. */
  private lastDone: Done | null = null;
  /** The agent's last `set_phase` in the turn that just ran (spec §4.1); `afterRun` reads it once. */
  private lastPhaseAsk: PhaseRequest | null = null;
  /** How long a time-box minute lasts. */
  private readonly minute: number;
  /** The time box's timer for the open task's next step, or null. */
  private timer: unknown = null;
  /** A time-box step fired and waits for its turn or runs: no other is armed until it is over. */
  private stepPending = false;
  private readonly timers: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** The slug each free-question task wrote its note under, so a second save replaces its own note. */
  private readonly questionSlugs = new Map<string, string>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: TaskDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? randomUUID;
    this.minute = d.minuteMs ?? MINUTE_MS;
    this.timers = d.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }

  /** A task operation or a turn is under way. */
  isBusy(): boolean {
    return this.running || this.d.turns.isBusy();
  }

  /** Resolves once the running task operation, if any, has finished. */
  async idle(): Promise<void> {
    await this.ops.catch(() => undefined);
  }

  async view(): Promise<TaskView> {
    if (!this.d.scoped) {
      const [state, notes] = await Promise.all([this.d.store.load(), this.d.notes().catch(() => [] as Note[])]);
      const c = state.current;
      return { current: c ? await this.currentViewOf(c) : null, actions: state.actions, notes: notes.map(noteView) };
    }
    const state = await this.d.store.load();
    const c = state.current;
    const scope = this.chatOf(state);
    const own = await this.d.notes(scope).catch(() => [] as Note[]);
    const app = scope === APP_SCOPE ? [] : await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
    return {
      current: c ? await this.currentViewOf(c) : null,
      // The open scope's statuses, over the app-wide actions' own.
      actions: { ...statusesIn(state, APP_SCOPE), ...statusesIn(state, scope) },
      notes: [...own, ...app].map(noteView),
      scope: state.open ?? null,
    };
  }

  /**
   * Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows.
   * `scope`, in a harness with scopes, is opened first (closing the open task, spec §3.3). `mode`: the mode the
   * person picked for it (task-modes "ask"); one the action doesn't list is refused before anything closes. `timeBox`:
   * the minutes picked (null: no limit; absent: the action's default, task-phases spec §5); one not offered is refused too.
   */
  start(action: string, display?: string, scope?: string, mode?: string, opts: { timeBox?: number | null } = {}): Promise<void> {
    return this.op(() => this.startNow(action, display, scope, mode, undefined, opts));
  }

  /** A message from the person: a follow-up of the waiting task, or a new free-question task. `scope` as in `start`. */
  ask(text: string, display?: string, scope?: string): Promise<void> {
    return this.op(async () => {
      if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
      return this.askNow(text, display);
    });
  }

  /** An option of a `choices` block shown for task `task`; a block of an earlier task is refused. */
  choose(option: ChoiceOption, task: string): Promise<void> {
    return this.op(() => this.chooseNow(option, task));
  }

  /**
   * The person's answer to input block `blockId` (input-blocks spec §6). `accepted` resolves once the answer is
   * refused (nothing ran, nothing changed) or taken (the chat's line comes with it); `done` once the turn that
   * carries it to the agent has ended. Both reject when the operation can't run (closing, a turn running).
   */
  respond(blockId: string, value: unknown): { accepted: Promise<RespondResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: RespondResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<RespondResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const done = this.op(() => this.respondNow(blockId, value, take)).then(
      () => {
        if (!settled) refuse(new Error("The answer was not taken"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }

  /**
   * The person picks `mode` for the open task (task-modes spec §5). It waits for a running turn to end and never cancels
   * it (§5.2). `accepted` resolves with a refusal or with how the switch goes on, before any turn's events; `done` once
   * its turn has ended. Both reject when the operation can't run (the app is closing). `task`: the open task the caller
   * saw; a pick that waited is refused (`no-task`) when another task is open by the time it runs.
   */
  chooseMode(mode: string, choice: ModeChoice = {}, task?: string): { accepted: Promise<ModeResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: ModeResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<ModeResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const run = () => this.op(() => this.modeNow(mode, choice, take, task));
    // Not busy: it runs now, as any operation does; busy: it waits its turn (§5.2), behind any earlier pick.
    const done = (this.isBusy() ? this.whenFree(run) : run()).then(
      () => {
        if (!settled) refuse(new Error("The mode was not switched"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }

  /**
   * The person moves the open task to phase `to` (task-phases spec §4.2), only while it waits: unlike a mode pick, it
   * never waits for a turn. `accepted` resolves with a refusal or with how the change goes on, before any turn's events;
   * `done` once its turn ended. Both reject when the operation can't run (a turn runs, the app is closing). `task`: the
   * open task the caller saw.
   */
  setPhase(to: string, task?: string): { accepted: Promise<PhaseResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: PhaseResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<PhaseResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const done = this.op(() => this.phaseNow(to, take, task)).then(
      () => {
        if (!settled) refuse(new Error("The phase was not changed"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }

  /**
   * Opens scope `id` (null: none). The open task is closed first, like picking another action (spec §3.3).
   * False when that closing turn was stopped (the scope didn't change). Throws in a harness without scopes.
   */
  switchScope(id: string | null): Promise<boolean> {
    return this.op(() => this.switchNow(id));
  }

  /** The open scope, or null (always null without scopes). */
  async currentScope(): Promise<string | null> {
    return this.d.scoped ? ((await this.d.store.load()).open ?? null) : null;
  }

  /** The scope whose chat the window shows: the open one, `_app` when none is open; `main` without scopes. */
  async chatScope(): Promise<string> {
    return this.chatOf(await this.d.store.load());
  }

  /** The open task and the scope it runs in (`main` without scopes), for requests made on its behalf. */
  async runningTask(): Promise<{ id: string; action?: string; scope: string } | null> {
    const c = (await this.d.store.load()).current;
    return c ? { id: c.id, ...(c.action ? { action: c.action } : {}), scope: scopeOfTask(c) } : null;
  }

  /** The open task's history trailer, for commits made on its behalf (the person's data writes); none without a task. */
  async trailerNow(): Promise<HistoryTrailer | undefined> {
    const c = (await this.d.store.load()).current;
    return c ? this.trailerOf(c) : undefined;
  }

  /**
   * Closes the open task now (the closing turn asks for `save_note`) and starts nothing after it: the terminal
   * runner's `q` (plan 4a `humanharness run`). Like the end of the path, a cancelled closing turn sends nothing.
   * True when no task is open afterwards (closed, with or without a note); false when it was stopped before the
   * closing turn ran and the task is still open.
   */
  finish(): Promise<boolean> {
    return this.op(async () => {
      await this.closeCurrent();
      return (await this.d.store.load()).current === null;
    });
  }

  /** Cancels the running turn; an operation that runs several turns (closing, then the next task) stops. */
  cancel(): void {
    if (this.running) this.cancelRequested = true;
    this.d.turns.cancel();
  }

  /** Stops the time box's clock (spec §5), only while the task waits. False when there is nothing to pause. */
  pauseTimeBox(): Promise<boolean> {
    return this.op(async () => {
      const c = (await this.d.store.load()).current;
      if (!c?.timeBox?.runningSince || c.status !== "waiting") return false;
      const at = this.now();
      await this.updateTimeBox(c.id, (t) => paused(t, at));
      return true;
    });
  }

  /** Starts the time box's clock again. False when there is nothing to resume. */
  resumeTimeBox(): Promise<boolean> {
    return this.op(async () => {
      const c = (await this.d.store.load()).current;
      if (!c?.timeBox || c.timeBox.runningSince) return false;
      const at = this.now();
      await this.updateTimeBox(c.id, (t) => running(t, at));
      return true;
    });
  }

  /** "+5 min" (spec §5): the end runs again later, the wrap-up never again. Works during a turn too. */
  async extendTimeBox(minutes = EXTEND_MINUTES): Promise<boolean> {
    let changed = false;
    await this.update((s) => {
      const box = s.current?.timeBox;
      if (!s.current || !box) return s;
      const { ended: _ended, ...rest } = box;
      changed = true;
      return { ...s, current: { ...s.current, timeBox: { ...rest, minutes: Math.min(TIME_BOX_MINUTES_MAX, box.minutes + minutes) } } };
    });
    return changed;
  }

  /**
   * For quitting: every later operation is refused, the running one starts no further turn, and the time box pauses
   * (no timer is left behind). Resolves once the pause is written; it never rejects.
   */
  close(): Promise<void> {
    this.closed = true;
    this.cancelRequested = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const at = this.now();
    return this.update((s) => (s.current?.timeBox?.runningSince ? { ...s, current: { ...s.current, timeBox: paused(s.current.timeBox, at) } } : s)).catch(
      (err: unknown) => console.error("Could not pause the time box", err),
    );
  }

  /** Ends the open task without a note (engine change, quit, dropped runtime, a task left by an earlier run). */
  interrupt(): Promise<void> {
    return this.queue(async () => {
      const c = (await this.d.store.load()).current;
      if (c) await this.endTask(c.id, "unfinished");
    });
  }

  /**
   * The open task's engine session is gone (the folder moved, spec 3d §2): the task stays open, its stored
   * session and context are dropped, and its next follow-up starts a new session from the notes.
   */
  resumeFromNotes(): Promise<void> {
    return this.queue(() =>
      this.update((s) => {
        if (!s.current) return s;
        const { session: _session, context: _context, checkpointed: _checkpointed, ...rest } = s.current;
        return { ...s, current: { ...rest, resume: true } };
      }),
    );
  }

  /**
   * Before a move (spec 3d §2): the open task, waiting and with no note of its own yet, saves a checkpoint
   * note in its current session, since the move ends that session. A failed or cancelled checkpoint is
   * logged and the move goes on: the task then resumes from the notes there are. Rejects when busy.
   */
  checkpointBeforeMove(): Promise<void> {
    return this.op(async () => {
      const c = await this.storedCurrent();
      // A checkpoint note counts only when no turn ran after it (one from an older file, with no count, doesn't).
      const fresh = c?.checkpointNote === true && c.checkpointTurns === c.turns;
      if (!c || c.status !== "waiting" || c.resume || c.noteSaved || fresh) return;
      if (!(await this.checkpoint(c))) {
        console.error("The checkpoint before the move was cancelled; the task resumes from the notes there are");
        return;
      }
      // No follow-up runs after this checkpoint: the task waits again (a cancelled one already does).
      await this.setStatus(c.id, "waiting");
      if ((await this.d.store.load()).current?.checkpointNote !== true)
        console.error("The checkpoint before the move saved no note; the task resumes from the notes there are");
    });
  }

  /** The engine started the session of the task whose turn runs now; reported at any other time, it is ignored. */
  sessionStarted(session: Session): Promise<void> {
    const id = this.turnTask;
    if (!id) return Promise.resolve();
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, session: { id: session.id, started: session.started } } } : s));
  }

  /**
   * Runs `fn` after the running task operation, if no task is open then (harness-settings spec D4): true when it ran.
   * Queued like `interrupt`, so a new session never starts while `fn` runs; nor does a new runtime, since only a
   * task's turn (inside an operation) creates one.
   */
  whenNoTask(fn: () => Promise<void>): Promise<boolean> {
    return this.queue(async () => {
      // Quitting: nothing new runs, as for operations.
      if (this.closed || (await this.d.store.load()).current) return false;
      await fn();
      return true;
    });
  }

  /** Resolves once no operation or turn runs, or the app is closing (a mode switch waits for the turn, spec §5.2). */
  private async whenIdle(): Promise<void> {
    while (this.isBusy() && !this.closed) {
      await this.idle();
      // A turn the window started outside an operation: look again shortly.
      if (this.isBusy()) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * `read()`'s result once no operation, turn or time-box step runs, read again when one started meanwhile. A caller
   * that acts on the person's typed line (`humanharness run`) waits here first: the time box may have started a turn on
   * its own (the wrap-up, the move to the close part), and that turn may even have closed the task. Quitting: at once.
   */
  async whenSettled<T>(read: () => Promise<T>): Promise<T> {
    const unsettled = () => (this.isBusy() || this.stepPending) && !this.closed;
    for (;;) {
      while (unsettled()) {
        await this.idle();
        // A turn outside an operation, or a step about to start its operation: look again shortly.
        if (unsettled()) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const value = await read();
      if (!unsettled()) return value;
    }
  }

  /** Runs `fn` once idle; another waiter that got there first makes it wait again, so a second pick queues. */
  private async whenFree<T>(fn: () => Promise<T>): Promise<T> {
    do await this.whenIdle();
    while (this.isBusy() && !this.closed);
    return fn();
  }

  private op<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The app is closing"));
    if (this.isBusy()) return Promise.reject(new Error("A turn is already running"));
    this.running = true;
    this.cancelRequested = false;
    this.windowDone = false;
    return this.queue(fn).finally(() => {
      this.running = false;
    });
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(fn, fn);
    this.ops = run.catch(() => undefined);
    return run;
  }

  private known(action: string | undefined): action is string {
    return action !== undefined && Object.hasOwn(this.d.actions, action);
  }

  /** The harness has blocks the person answers: turns number their ids (spec D0 keeps every other harness as is). */
  private hasInputs(): boolean {
    return Object.keys(this.d.inputBlocks ?? {}).length > 0;
  }

  /** Where a new task runs (spec §3.3). Throws ScopeRequired for a required action with no open scope. */
  private scopeFor(state: TasksFile, action: string | undefined): string {
    if (!this.d.scoped) return MAIN_SCOPE;
    if (action !== undefined && this.d.actions[action]?.scope === "none") return APP_SCOPE;
    if (state.open) return state.open;
    if (action !== undefined) throw new ScopeRequired();
    return APP_SCOPE;
  }

  /** The chat the window shows: the open scope's, `_app`'s when none is open; `main` without scopes. */
  private chatOf(state: TasksFile): string {
    return this.d.scoped ? (state.open ?? APP_SCOPE) : MAIN_SCOPE;
  }

  /** The history trailer of a task's commits; `scope` only in a harness with scopes (D2), `phase` only with phases. */
  private trailerOf(c: CurrentTask): HistoryTrailer {
    return {
      task: c.id,
      ...(c.action ? { action: c.action } : {}),
      ...(c.scope ? { scope: c.scope } : {}),
      ...(c.phase ? { phase: c.phase.id } : {}),
    };
  }

  /** What a scoped task's turns carry: its scope (usage, trailer) and the chat on screen. Nothing without scopes (D2). */
  private async scopeOptions(task: CurrentTask): Promise<{ scope?: string; chat?: string }> {
    if (!this.d.scoped) return {};
    return { scope: scopeOfTask(task), chat: this.chatOf(await this.d.store.load()) };
  }

  /**
   * A new session's context (spec §3.3, §4.4): the scope's notes index; in a scope, the app-wide one, trimmed;
   * then the data tables. Without scopes or data, exactly the notes index as before (D2).
   */
  private async contextFor(scope: string, action: string | undefined): Promise<string> {
    const own = buildNotesIndex(await this.d.notes(this.d.scoped ? scope : undefined).catch(() => [] as Note[]));
    const parts = [own];
    if (this.d.scoped && scope !== APP_SCOPE) {
      const app = await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
      // The own index ends with the "open a note" line; the app-wide one says it only when it stands alone.
      parts.push(
        buildNotesIndex(app, {
          budgetTokens: APP_INDEX_TOKENS,
          heading: "## App-wide notes",
          decisionsHeading: "## App-wide decisions",
          ...(own ? { footer: null } : {}),
        }),
      );
    }
    if (this.d.dataContext) {
      parts.push(
        await this.d.dataContext(scope, action).catch((err: unknown) => {
          console.error("Could not load the data for the task", err);
          return "";
        }),
      );
    }
    if (this.d.materialContext) {
      parts.push(
        await this.d.materialContext(scope).catch((err: unknown) => {
          console.error("Could not load the material for the task", err);
          return "";
        }),
      );
    }
    return parts.filter(Boolean).join("\n\n");
  }

  private async switchNow(id: string | null): Promise<boolean> {
    if (!this.d.scoped) throw new Error("This harness has no scopes");
    if (id !== null && (!isScopeId(id) || !((await this.d.scopeExists?.(id)) ?? true))) throw new Error("Unknown scope");
    if (((await this.d.store.load()).open ?? null) === id) return true;
    if (!(await this.closeCurrent())) return false;
    await this.update((s) => {
      const { open: _open, ...rest } = s;
      return id === null ? rest : { ...rest, open: id };
    });
    return true;
  }

  /**
   * `opts.timeBox`: the minutes picked (or `null`, no limit); absent, the action's default. `opts.kept`: the box of the
   * task this one replaces (a mode's tier floor), paused: its minutes may differ from the options (a "+5 min"), and its
   * time used and wrap-up go on.
   */
  private async startNow(
    action: string,
    display?: string,
    scope?: string,
    mode?: string,
    floor?: Tier,
    opts: { timeBox?: number | null; kept?: TimeBoxState } = {},
  ): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    const modes = this.modesOf(action);
    // Checked before anything closes, like the scope below.
    if (mode !== undefined && !modes.includes(mode)) throw new Error("Unknown mode");
    // The time box (spec §5): the one picked, else the action's default; one it doesn't offer is refused before anything closes.
    const offered = this.d.actions[action].timeBox;
    const minutes = opts.timeBox !== undefined ? opts.timeBox : (offered?.default ?? null);
    if (minutes !== null && !opts.kept && !(offered?.options ?? []).includes(minutes)) throw new Error("Unknown time box");
    const first = this.phasesOf(action)[0];
    // How the task starts (spec §3 `defaultMode`): in a mode, asking for a recommendation, or as before (D0). The first
    // phase may allow fewer modes (modes spec §7): a mode it forbids starts suspended; "recommend" waits.
    const startable = first ? phaseModes(this.d.actions[action], first).filter((m) => modes.includes(m)) : modes;
    let start = mode ?? this.startMode(action, modes);
    let suspended: string | undefined;
    if (start === "recommend" && startable.length === 0) start = null;
    else if (start !== null && start !== "recommend" && !startable.includes(start)) {
      suspended = start;
      start = null;
    }
    // Read before anything closes (a scope switch closes too): a mode brief that can't be read starts nothing.
    const text = start !== null && start !== "recommend" ? await this.modeText(start) : null;
    // The task starts in its first phase (task-phases spec §4.4); read before anything closes, like the mode's brief.
    const firstText = first ? await this.phaseText(action, first) : null;
    if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
    // Checked before anything closes: a required action with no open scope starts nothing.
    const where = this.scopeFor(await this.d.store.load(), action);
    if (!(await this.closeCurrent())) return this.stopped();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    let section = "";
    if (start === "recommend") section = recommendSection(startable.map((id) => this.hintOf(id)));
    else if (text) section = modeSection(text, language);
    const inMode = start !== null && start !== "recommend" ? { mode: start, modes: [start] } : {};
    const at = this.now().toISOString();
    const inPhase = first ? { phase: { id: first.id, startedAt: at }, phases: [{ id: first.id, at, by: "app" as const }] } : {};
    const inTimeBox = minutes !== null ? { timeBox: { minutes, usedMs: opts.kept?.usedMs ?? 0, runningSince: at, ...(opts.kept?.wrappedUp ? { wrappedUp: true as const } : {}), ...(opts.kept?.ended ? { ended: true as const } : {}) } } : {};
    // A time box is told to the agent, with or without phases (none: D0).
    const timeLeft = minutes !== null ? formatTimeLeft(minutes * this.minute - (opts.kept?.usedMs ?? 0), this.minute) : "";
    await this.begin(
      { action, ...inMode, ...inPhase, ...(suspended ? { suspendedMode: suspended } : {}), ...inTimeBox },
      where,
      (notesIndex) => {
        const parts = first && firstText ? [phasesSection(this.phaseList(action), first.id), phaseSection(firstText, { language, timeLeft })] : [];
        const box = timeLeft ? [`Time left: ${timeLeft}.`] : [];
        return [fillPrompt(template, { language, notesIndex }), ...this.interviewOf(action), ...(section ? [section] : []), ...parts, ...box].join("\n\n");
      },
      display ?? this.d.actions[action].label,
      floor,
    );
  }

  /** The modes a task of `action` may work in: the action's list, those the harness declares (none: D0). */
  private modesOf(action: string | undefined): string[] {
    const modes = this.d.modes;
    if (!this.known(action) || !modes) return [];
    return (this.d.actions[action].modes ?? []).filter((m) => Object.hasOwn(modes, m));
  }

  /** How a task of `action` starts with no mode picked: its default mode, else "recommend" ("ask" can't ask from here). */
  private startMode(action: string, modes: string[]): string | null {
    if (modes.length === 0) return null;
    const d = defaultModeOf(this.d.actions[action]);
    return d !== null && modes.includes(d) ? d : "recommend";
  }

  /** A mode as the recommendation's list shows it to the agent. */
  private hintOf(id: string): { id: string; label: string; recommend?: string } {
    const m = this.d.modes![id];
    return { id, label: oneLine(m.label), ...(m.recommend ? { recommend: oneLine(m.recommend) } : {}) };
  }

  /** A mode's label, brief and settings' sentences; settings that can't be read leave it with none. */
  private async modeText(mode: string): Promise<ModeText> {
    const brief = this.d.readModeBrief ? await this.d.readModeBrief(mode) : "";
    let settings: string[] = [];
    try {
      settings = (await this.d.modeSettings?.(mode)) ?? [];
    } catch (err) {
      console.error("Could not read the mode's settings; it starts with none", err);
    }
    return { label: oneLine(this.d.modes![mode].label), brief, settings };
  }

  /** The core's section for a task of an interview step's action, or none (setup-steps D0). */
  private interviewOf(action: string): string[] {
    const interviews = this.d.interviews;
    return interviews && Object.hasOwn(interviews, action) ? [interviewSection(interviews[action])] : [];
  }

  /** The phases of `action`; none for a free question or an action without them (D0). */
  private phasesOf(action: string | undefined): HarnessPhase[] {
    return this.known(action) ? (this.d.actions[action].phases ?? []) : [];
  }

  /** The phase the task is in now, as the manifest declares it. */
  private phaseOf(c: Pick<CurrentTask, "action" | "phase">): HarnessPhase | undefined {
    return this.phasesOf(c.action).find((p) => p.id === c.phase?.id);
  }

  /** The action's phases as the list of parts shows them to the agent. */
  private phaseList(action: string | undefined): { id: string; label: string }[] {
    return this.phasesOf(action).map((p) => ({ id: p.id, label: oneLine(p.label) }));
  }

  /** The modes the task may work in now: its action's, narrowed by its phase (modes spec §7). */
  private allowedModes(c: Pick<CurrentTask, "action" | "phase">): string[] {
    const modes = this.modesOf(c.action);
    const phase = this.phaseOf(c);
    // `phaseOf` finds a phase only for a known action.
    return phase ? phaseModes(this.d.actions[c.action!], phase).filter((m) => modes.includes(m)) : modes;
  }

  /**
   * What entering `to` does to the task's mode (modes spec §7), and what the change's message says about it. A mode `to`
   * forbids is suspended. A suspended mode `to` allows comes back, its section riding on the change turn. A task that never
   * worked in a mode gets its `defaultMode` (a mode id) or a recommendation, at the first phase that allows modes (once:
   * not when a phase in the task's log already allowed some). With no `language` (a resumed task) only the fields: no
   * section is built, so no mode brief is read.
   */
  private async modesOnEntry(c: CurrentTask, to: HarnessPhase, language?: Language): Promise<{ sections: string[]; fields?: PhasePlan["modes"] }> {
    const modes = this.modesOf(c.action);
    if (modes.length === 0 || !this.known(c.action)) return { sections: [] };
    const action = this.d.actions[c.action];
    const allowed = phaseModes(action, to).filter((m) => modes.includes(m));
    const used = c.modes ?? [];
    if (c.mode) {
      if (allowed.includes(c.mode)) return { sections: [] };
      return { sections: [], fields: { suspendedMode: c.mode, ...(used.length > 0 ? { modes: used } : {}) } };
    }
    const fresh = !c.suspendedMode && used.length === 0;
    const preferred = fresh ? defaultModeOf(action) : null;
    const comes =
      c.suspendedMode && allowed.includes(c.suspendedMode) ? c.suspendedMode : preferred !== null && allowed.includes(preferred) ? preferred : undefined;
    if (comes) {
      const below = await this.belowMinTier(comes, c.profile);
      return {
        sections: language ? [modeSection(await this.modeText(comes), language)] : [],
        fields: { mode: comes, modes: used.includes(comes) ? used : [...used, comes], ...(below ? { belowMinTier: true as const } : {}) },
      };
    }
    const offered = (c.phases ?? []).some((e) => {
      const p = this.phasesOf(c.action).find((q) => q.id === e.id);
      return p !== undefined && phaseModes(action, p).some((m) => modes.includes(m));
    });
    if (language && fresh && !offered && allowed.length > 0) return { sections: [recommendSection(allowed.map((id) => this.hintOf(id)))] };
    return { sections: [] };
  }

  /** A phase's id, label and brief text ("" without a brief). */
  private async phaseText(action: string, p: HarnessPhase): Promise<PhaseText> {
    const brief = p.brief && this.d.readPhaseBrief ? await this.d.readPhaseBrief(action, p.id) : "";
    return { id: p.id, label: oneLine(p.label), brief };
  }

  /** The time left, as a prompt says it; "" without a time box. */
  private timeLeft(c: Pick<CurrentTask, "timeBox">): string {
    return c.timeBox ? formatTimeLeft(remainingMs(c.timeBox, this.now(), this.minute), this.minute) : "";
  }

  /** The open task as the window sees it; its tier only when its action has modes (D0), its time box measured now. */
  private async currentViewOf(c: CurrentTask): Promise<CurrentTaskView> {
    return currentView(c, this.modesOf(c.action).length > 0 ? await this.tierFor(c) : undefined, c.timeBox ? this.timeBoxView(c.timeBox) : undefined);
  }

  private timeBoxView(t: TimeBoxState): TimeBoxView {
    const now = this.now();
    return {
      minutes: t.minutes,
      totalMs: t.minutes * this.minute,
      usedMs: usedMs(t, now),
      at: now.toISOString(),
      paused: !t.runningSince,
      ...(t.wrappedUp ? { wrappedUp: true as const } : {}),
      ...(t.ended ? { ended: true as const } : {}),
    };
  }

  /** The tier the task counts as, or undefined when it can't be told. */
  private async tierFor(c: Pick<CurrentTask, "profile">): Promise<Tier | undefined> {
    if (!c.profile || !this.d.tierOf) return undefined;
    return this.d.tierOf(c.profile).catch(() => undefined);
  }

  /** `profile` counts below `mode`'s `minTier` (spec §5.3). */
  private async belowMinTier(mode: string, profile: ModelProfile | undefined): Promise<boolean> {
    const min = this.d.modes && Object.hasOwn(this.d.modes, mode) ? this.d.modes[mode].minTier : undefined;
    const tier = min !== undefined ? await this.tierFor({ profile }) : undefined;
    return min !== undefined && tier !== undefined && tierBelow(tier, min);
  }

  /**
   * Checks, in order: a task waits; the action lists the mode; it isn't the current one; the task's tier reaches the
   * mode's `minTier`, or the person chose how to go on (spec §5.3). Then: a new task at the mode's tier, a quiet switch
   * for a lost session, or one turn in the same session. The state changes only once that turn ended well.
   */
  private async modeNow(mode: string, choice: ModeChoice, take: (r: ModeResult) => void, task?: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.status !== "waiting" || (task !== undefined && c.id !== task)) return take({ ok: false, reason: "no-task" });
    if (!this.modesOf(c.action).includes(mode)) return take({ ok: false, reason: "unknown" });
    if (!this.allowedModes(c).includes(mode)) return take({ ok: false, reason: "phase" });
    if (c.mode === mode) return take({ ok: true, switched: "same" });
    const required = this.d.modes![mode].minTier;
    const current = await this.tierFor(c);
    const below = required !== undefined && current !== undefined && tierBelow(current, required);
    if (below && choice.belowTier === undefined) return take({ ok: false, reason: "tier", required, current });
    // Read before anything is taken: a brief that can't be read refuses the switch (and a new task, before the close).
    const text = await this.modeText(mode);
    await this.personWorks(c);
    if (below && choice.belowTier === "new-task") {
      take({ ok: true, switched: "new-task" });
      return this.endsInWindow(async () => {
        // The closing turn saves the note the new task starts from: one turn, where the spec has a checkpoint and a close.
        if (!(await this.closeCurrent())) return this.stopped();
        // The person's time box goes with the task (not the action's default), with the time used and the wrap-up
        // done: no fresh clock. Measured now, after the closing turn; none stays none.
        const box = c.timeBox ? paused((await this.d.store.load()).current?.timeBox ?? c.timeBox, this.now()) : undefined;
        return this.startNow(c.action!, undefined, undefined, mode, required, box ? { timeBox: box.minutes, kept: box } : { timeBox: null });
      });
    }
    if (c.resume) {
      // The session is gone (a folder move): nothing to tell now; the resumed session's first message carries the mode.
      await this.setMode(c.id, mode, below);
      return take({ ok: true, switched: "quiet" });
    }
    take({ ok: true, switched: "turn" });
    return this.endsInWindow(async () => {
      if (needsCheckpoint(c) && !(await this.checkpoint(c))) return this.stopped();
      const language = await this.d.language();
      // Read again: a checkpoint just taken here saved the note this line carries.
      const after = (await this.d.store.load()).current;
      const soFar = (after?.id === c.id ? after : c).checkpointNote ? await this.checkpointSummary(c) : undefined;
      const message = modePrompt(text, { language, ...(soFar ? { soFar } : {}) });
      await this.setStatus(c.id, "running");
      // Checked with no await before the send: a Stop while the status was saved.
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      let done: Done;
      try {
        // `display` always goes with `modeSwitch`: the chat shows the system line, never the mode's prompt.
        done = await this.runTurn(c, message, {
          display: `Switched to ${text.label}`,
          ...(c.action ? { action: c.action } : {}),
          followUp: true,
          mode,
          modeSwitch: true,
        });
      } catch (err) {
        if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
        throw unwrap(err);
      }
      // The mode is the task's once the agent got it: a failed switch can be picked again.
      if (done.ok) await this.setMode(c.id, mode, below);
      return this.afterRun(c.id, done, false);
    });
  }

  /**
   * Runs what follows a taken switch. The window already shows it running (its line, or the new task): a failure
   * before a turn's own `done` reached the window ends it there, as `respondNow` does.
   */
  private async endsInWindow(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.windowFailed(err);
      throw err;
    }
  }

  /** The window shows a turn running that will never end on its own: a failed `done` ends it (once). */
  private windowFailed(err: unknown): void {
    if (this.windowDone) return;
    this.windowDone = true;
    try {
      this.d.emit?.(fail("agent-crashed", err instanceof Error ? err.message : String(err)));
    } catch (emitErr) {
      console.error("Could not send an event to the window", emitErr);
    }
  }

  /** The task works in `mode` now: it joins the modes used (once), and `belowMinTier` says whether it runs below it. */
  private setMode(id: string, mode: string, below: boolean): Promise<void> {
    return this.update((s) => {
      if (s.current?.id !== id) return s;
      const { belowMinTier: _below, suspendedMode: _suspended, ...rest } = s.current;
      const modes = rest.modes?.includes(mode) ? rest.modes : [...(rest.modes ?? []), mode];
      return { ...s, current: { ...rest, mode, modes, ...(below ? { belowMinTier: true as const } : {}) } };
    });
  }

  /**
   * The summary of the task's checkpoint note (spec §10.1), or undefined when it can't be found. Capped like
   * `save_note`'s (5 points of 400 characters): a note edited by hand must not flood the switch's message.
   */
  private async checkpointSummary(c: CurrentTask): Promise<string[] | undefined> {
    const notes = await this.d.notes(this.d.scoped ? scopeOfTask(c) : undefined).catch(() => [] as Note[]);
    return notes
      .find((n) => n.slug === c.action)
      ?.summary.slice(0, SO_FAR_POINTS)
      .map((s) => s.slice(0, SO_FAR_CHARS));
  }

  /** The labels of the modes the task used, for the closing turn. */
  private modeLabels(c: CurrentTask): string[] {
    const modes = this.d.modes;
    return (c.modes ?? []).map((id) => (modes && Object.hasOwn(modes, id) ? oneLine(modes[id].label) : id));
  }

  /** The open task from tasks.json, its profile fitted to the engine's current offer (and saved when it changed). */
  private async storedCurrent(): Promise<CurrentTask | null> {
    const c = (await this.d.store.load()).current;
    if (!c?.profile || !this.d.fitProfile) return c;
    const profile = await this.d.fitProfile(c.profile);
    if (profile.effort === c.profile.effort) return c;
    await this.update((s) => (s.current?.id === c.id ? { ...s, current: { ...s.current, profile } } : s));
    return { ...c, profile };
  }

  private async askNow(text: string, display?: string): Promise<void> {
    const c = await this.storedCurrent();
    if (c?.status === "waiting") {
      if (needsCheckpoint(c) && !(await this.checkpoint(c))) return this.stopped();
      // After the session was lost a new one starts, told what the task is and what the notes hold; the
      // chat still shows what was typed.
      const message = c.resume ? await this.resumeMessageFor(c, text) : text;
      await this.setStatus(c.id, "running");
      // Checked with no await before the send: a Stop while the status was saved.
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      let done: Done;
      try {
        const options = {
          ...(display || c.resume ? { display: display ?? text } : {}),
          ...(c.action ? { action: c.action } : {}),
          followUp: true,
        };
        // A resumed turn opens a new session, like a first turn: a model the plan lacks falls back the same way.
        done = c.resume ? await this.firstTurn(c, message, options) : await this.runTurn(c, message, options);
      } catch (err) {
        if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
        throw unwrap(err);
      }
      if (c.resume && done.ok) {
        await this.update((s) => {
          if (s.current?.id !== c.id) return s;
          const { resume: _resume, ...rest } = s.current;
          return { ...s, current: rest };
        });
      }
      return this.afterRun(c.id, done, false);
    }
    if (c) await this.endTask(c.id, "unfinished");
    const language = await this.d.language();
    await this.begin(
      keptQuestion(text),
      this.scopeFor(await this.d.store.load(), undefined),
      (notesIndex) => fillPrompt(QUESTION_PROMPT, { language, notesIndex, question: text }),
      display ?? text,
    );
  }

  /**
   * Checks, in order: the question is the waiting task's open one; the answer is valid; the checkpoint runs if due
   * (before anything is taken, spec §6); a `saveTo` block's records are written (a refusal takes nothing). Then the
   * question closes, the chat marks the answer, the window gets the line, and the answer goes to the agent as a
   * follow-up. `askNow` then sees `checkpointed` and runs no second one.
   */
  private async respondNow(blockId: string, raw: unknown, take: (r: RespondResult) => void): Promise<void> {
    const refuse = (reason: Exclude<RespondResult, { ok: true }>["reason"], errors: InputIssue[] = []) => take({ ok: false, reason, errors });
    const c = await this.storedCurrent();
    const pending = c?.pendingInput;
    const inputs = this.d.inputBlocks;
    const block = pending && inputs && Object.hasOwn(inputs, pending.block) ? inputs[pending.block] : undefined;
    if (!c || c.status !== "waiting" || !pending || pending.blockId !== blockId || !block) {
      return refuse("stale", [{ path: "", message: "This question is closed" }]);
    }
    const parsed = parseAnswer(block, raw);
    if (!parsed.ok) return refuse("invalid", parsed.errors);
    if (needsCheckpoint(c)) {
      if (!(await this.checkpoint(c))) return refuse("stopped");
      await this.setStatus(c.id, "waiting");
    }
    // A Stop so far takes nothing: the question stays open.
    if (this.cancelRequested) return refuse("stopped");
    // Kept before it is taken (spec §6): a refusal leaves the question open, with nothing written. The write needs
    // no commit of its own: the follow-up's "Before message" commit records it under the task's trailer.
    if (block.saveTo) {
      try {
        const records = answerRecords(pending.block, block, parsed.value);
        if (records.length > 0) {
          if (!this.d.saveAnswer) throw new Error("Answers can't be saved here");
          await this.d.saveAnswer(block.saveTo.collection, records, scopeOfTask(c));
        }
      } catch (err) {
        console.error(`The answer to "${pending.block}" was not saved`, err);
        return refuse("refused", [{ path: "", message: err instanceof Error ? err.message : String(err) }]);
      }
    }
    const language = await this.d.language();
    const display = answerDisplay(pending.block, block, parsed.value, language);
    const answer: BlockAnswer = { blockId, value: parsed.value, answeredAt: this.now().toISOString() };
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { pendingInput: _answered, ...rest } = s.current;
      return { ...s, current: rest };
    });
    // Inside this op, after the checkpoint and before the next turn: nothing can append to the chat file while
    // markAnswered rewrites it.
    await this.markAnswered(answer);
    take({ ok: true, display, value: answer.value, answeredAt: answer.answeredAt });
    const started = this.turnsStarted;
    try {
      await this.askNow(answerMessage({ name: pending.block, blockId, value: parsed.value, display }), display);
      // Never started, or started and failed (a cancel ends the task): the answer goes back through the form, never
      // as a plain retried line that loses its JSON.
      const d = this.lastDone;
      if (this.turnsStarted === started || (d && !d.ok && d.error.code !== "cancelled")) await this.reopen(c.id, pending);
    } catch (err) {
      // An answer the agent never got must not be lost: its question opens again.
      if (this.turnsStarted === started) await this.reopen(c.id, pending);
      // The window already shows the person's line and a running turn: end it there.
      this.windowFailed(err);
      throw err;
    }
  }

  /** The answer goes on its block in the chat on screen (the task's: switching scope closes the task). Logged on failure. */
  private async markAnswered(answer: BlockAnswer): Promise<void> {
    try {
      const marked = await this.d.markAnswered?.(this.chatOf(await this.d.store.load()), answer);
      if (marked === false) console.error(`The chat has no block ${answer.blockId} to mark`);
    } catch (err) {
      console.error("Could not mark the answer in the chat", err);
    }
  }

  /**
   * The answer's turn never started (a Stop, or the send was refused) or failed: its question is pending again
   * (unless the turn showed a newer one), so the form opens again with its draft. The chat keeps its answered mark (the chat log can't unmark): the window shows the pending
   * question's form, not that mark, and the next answer replaces it. Logged on failure.
   */
  private async reopen(id: string, pending: PendingInput): Promise<void> {
    try {
      await this.update((s) => (s.current?.id === id && !s.current.pendingInput ? { ...s, current: { ...s.current, pendingInput: pending } } : s));
    } catch (err) {
      console.error("Could not open the question again", err);
    }
  }

  /** The first message of a resumed task's new session (its old session ends first). */
  private async resumeMessageFor(c: CurrentTask, text: string): Promise<string> {
    await this.endSession();
    const language = await this.d.language();
    let brief: string | undefined;
    try {
      brief = this.known(c.action) ? await this.d.readPrompt(c.action) : undefined;
    } catch (err) {
      // The task still resumes, from the notes alone: a missing brief must not leave it stuck.
      console.error("Could not read the task's brief; it resumes without it", err);
    }
    // The current mode comes back with the task (task-modes spec §6), only with the action's brief.
    let mode: string | undefined;
    if (brief !== undefined && c.mode && this.modesOf(c.action).includes(c.mode)) {
      try {
        mode = modeSection(await this.modeText(c.mode), language);
      } catch (err) {
        console.error("Could not read the mode's brief; the task resumes without it", err);
      }
    }
    // The current part comes back with the task (task-phases spec §6), only with the action's brief.
    let phase: string | undefined;
    const current = this.phaseOf(c);
    if (brief !== undefined && current) {
      try {
        const text = await this.phaseText(c.action!, current);
        phase = [phasesSection(this.phaseList(c.action), current.id), phaseSection(text, { language, timeLeft: this.timeLeft(c) })].join("\n\n");
      } catch (err) {
        console.error("Could not read the phase's brief; the task resumes without it", err);
      }
    }
    return resumeMessage({
      language,
      notesIndex: await this.contextFor(scopeOfTask(c), c.action),
      ...(brief !== undefined ? { brief } : {}),
      ...(mode ? { mode } : {}),
      ...(phase ? { phase } : {}),
      ...(c.timeBox ? { timeLeft: this.timeLeft(c) } : {}),
      ...(c.question ? { question: c.question, ...(c.questionCut ? { questionCut: true } : {}) } : {}),
      message: text,
    });
  }

  /**
   * Precedence: a known `action`, then `next`, then `followUp`. An option with none of them (or only an
   * unknown action) is a follow-up whose text is its label.
   */
  private async chooseNow(option: ChoiceOption, task: string): Promise<void> {
    const state = await this.d.store.load();
    // A click on an older answer's block (the window's view lagged behind): it must not act on the open task.
    if (state.current?.id !== task) throw new Error("That choice belongs to an earlier task");
    const action = this.known(option.action) ? option.action : undefined;
    if (!option.next && !action) return this.askNow(option.followUp ?? option.label, option.label);
    // The path is walked with the open scope's statuses: each scope walks its own (spec §3.3).
    const target = action ?? nextInPath(this.d.path, state.current?.action, statusesIn(state, this.chatOf(state)));
    // Checked before the open task closes: a required action with no open scope must not cost the person that task.
    if (target) this.scopeFor(state, target);
    // Without a target the window shows no new turn (the end of the path just closes).
    if (!(await this.closeCurrent())) return target ? this.stopped() : undefined;
    if (target) await this.startNow(target);
  }

  /** A new task in a fresh session, in `scope`; its first message is built from the session context. */
  private async begin(
    task: {
      action?: string;
      question?: string;
      questionCut?: true;
      mode?: string;
      modes?: string[];
      suspendedMode?: string;
      phase?: { id: string; startedAt: string };
      phases?: { id: string; at: string; by: PhaseBy }[];
      timeBox?: TimeBoxState;
    },
    scope: string,
    message: (notesIndex: string) => string,
    display: string,
    floor?: Tier,
  ): Promise<void> {
    // Cancelled or quitting since the operation began (e.g. right after the closing turn): start nothing.
    if (this.cancelRequested) return this.stopped();
    await this.endSession();
    await this.between();
    const context = await this.contextFor(scope, task.action);
    const engine = await this.d.engine();
    // Resolved once: the task keeps its model, effort and cap to the end (spec D2). A floor only from a mode (task-modes §5.3).
    const profile = floor !== undefined ? await this.d.profileFor?.(task.action, floor) : await this.d.profileFor?.(task.action);
    // A task that starts below its mode's tier starts anyway, marked (spec §5.3: the question comes only with a switch).
    const below = task.mode !== undefined && (await this.belowMinTier(task.mode, profile));
    const current: CurrentTask = {
      id: this.newId(),
      ...task,
      status: "running",
      startedAt: this.now().toISOString(),
      turns: 0,
      ...(profile ? { profile } : {}),
      ...(this.d.scoped ? { scope } : {}),
      ...(below ? { belowMinTier: true as const } : {}),
    };
    await this.update((s) => ({ ...s, engine, current }));
    // Checked again with no await before the send: a Stop while the session ended or the notes were read.
    if (this.cancelRequested) {
      await this.update((s) => (s.current?.id === current.id ? { ...s, current: null } : s));
      return this.stopped();
    }
    let done: Done;
    try {
      done = await this.firstTurn(current, message(context), { display, ...(task.action ? { action: task.action } : {}) });
    } catch (err) {
      // Nothing ran: the task goes away without marking its topic.
      if (err instanceof TurnNotStarted) await this.update((s) => (s.current?.id === current.id ? { ...s, current: null } : s));
      throw unwrap(err);
    }
    await this.afterRun(current.id, done, true);
  }

  /**
   * The task's first turn. When the plan doesn't include its model, it runs again in a fresh session on the
   * next profile down, which the task keeps (spec §5.3). The failed attempt is held from the chat and the
   * window only when there is a fallback; the retry doesn't log the person's message again.
   */
  private async firstTurn(task: CurrentTask, message: string, options: Omit<TurnOptions, "task" | "onEvent" | "profile">): Promise<Done> {
    const tried: string[] = [];
    let current = task;
    for (let attempt = 0; ; attempt++) {
      const fallback = current.profile && this.d.fallbackFor ? await this.d.fallbackFor(current.profile, tried) : null;
      // Checked again with no await before the retry: a Stop while the session ended or the profile was saved.
      if (attempt > 0 && this.cancelRequested) {
        this.stopped();
        return fail("cancelled") as Done;
      }
      const done = await this.runTurn(current, message, {
        ...options,
        ...(fallback ? { holdModelError: true } : {}),
        ...(attempt > 0 ? { skipUserEntry: true } : {}),
      });
      if (done.ok || done.error.code !== "model-unavailable" || !fallback) return done;
      if (this.cancelRequested) {
        // The held failure never reached the window, which still shows the turn running.
        this.stopped();
        return fail("cancelled") as Done;
      }
      if (current.profile?.model) tried.push(current.profile.model);
      await this.endSession();
      current = { ...current, profile: fallback };
      await this.update((s) => (s.current?.id === current.id ? { ...s, current: { ...s.current, profile: fallback } } : s));
    }
  }

  /**
   * Runs one turn of `task`; a valid `save_note` in it becomes the task's note. Throws TurnNotStarted when
   * the turn was refused before it began (no `done` came).
   */
  private async runTurn(task: CurrentTask, message: string, options: Omit<TurnOptions, "task" | "onEvent" | "profile">): Promise<Done> {
    const seen: { done?: Done; note?: SavedNote; used?: number; size?: number; compacted?: boolean; phaseAsk?: PhaseRequest } = {};
    const shownInputs: Promise<void>[] = [];
    this.lastPhaseAsk = null;
    const kind = options.phase ?? "run";
    // A proposal the person didn't take goes as soon as they send anything else (spec §4.1 "ignores it"). A mode
    // switch's turn is a run turn too, so picking a mode drops it as well, by design.
    if (kind === "run" && task.phaseProposal) await this.dropProposal(task.id);
    if (kind === "run") await this.personWorks(task);
    this.turnTask = task.id;
    try {
      const scoped = await this.scopeOptions(task);
      await this.d.turns.send(message, {
        phase: "run",
        // The task's mode (usage.jsonl); a switch's own `mode` in `options` wins. A task with none passes none (D0).
        ...(task.mode ? { mode: task.mode } : {}),
        // The task's phase (usage.jsonl, history): a change turn's is the new one, already saved. None without phases (D0).
        ...(task.phase ? { taskPhase: task.phase.id } : {}),
        ...options,
        ...scoped,
        ...(task.profile ? { profile: task.profile } : {}),
        // Input blocks get ids only in the task's own turns (run, phase change, wrap-up), and only in a harness that has them.
        ...(this.hasInputs() && takesInputs(options.phase) ? { turn: task.turns } : {}),
        task: task.id,
        onEvent: (e) => {
          if (e.type === "done") seen.done = e;
          else if (e.type === "block" && e.name === "save_note") {
            const parsed = saveNoteSchema.safeParse(e.data);
            if (parsed.success) seen.note = parsed.data;
          } else if (e.type === "block" && e.name === "set_phase") {
            // Acted on only after the turn ends (spec §4.1); the last call of the turn wins.
            const parsed = setPhaseSchema.safeParse(e.data);
            if (parsed.success) seen.phaseAsk = parsed.data;
          } else if (e.type === "block" && e.id !== undefined && this.d.inputBlocks && Object.hasOwn(this.d.inputBlocks, e.name)) {
            shownInputs.push(this.showInput(task.id, e.name, e.id));
          } else if (e.type === "context") {
            seen.used = e.used;
            if (e.size !== undefined) seen.size = e.size;
          } else if (e.type === "compaction") seen.compacted = true;
        },
      });
    } catch (err) {
      // The turn never started (another one runs, or the app is closing).
      if (!seen.done) throw new TurnNotStarted(err);
    } finally {
      this.turnTask = null;
    }
    this.turnsStarted++;
    const result: Done = seen.done ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
    this.lastDone = result;
    // Only the task's own work asks to move: never the closing, checkpoint or wrap-up turn.
    if (seen.phaseAsk && (kind === "run" || kind === "phase-change")) this.lastPhaseAsk = seen.phaseAsk;
    await Promise.all(shownInputs);
    // Mirrors TurnController: a quiet turn reaches the window only with a failure other than a cancel,
    // and a held failure never does.
    const d = seen.done;
    if (d && !isHeld(d, options) && (!options.quiet || (!d.ok && d.error.code !== "cancelled"))) this.windowDone = true;
    if (seen.note) await this.saveNote(task, seen.note, options.phase !== "checkpoint");
    if (seen.used !== undefined || seen.compacted) await this.track(task.id, seen);
    return result;
  }

  private async afterRun(id: string, done: Done, first: boolean): Promise<void> {
    const ask = this.lastPhaseAsk;
    this.lastPhaseAsk = null;
    if (!done.ok && (done.error.code === "cancelled" || first)) return this.endTask(id, "unfinished");
    await this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status: "waiting", turns: s.current.turns + 1 } } : s));
    // The agent asked to move (spec §4.1): acted on now that its turn ended well.
    if (ask && done.ok && !this.cancelRequested) await this.phaseAsked(id, ask);
  }

  /**
   * The agent's `set_phase` (spec §4.1), after its turn ended well. With the current phase's `auto`: `to` the next phase
   * moves now, and the close phase's own id closes the task (D5). Anything else: a proposal the person confirms or
   * ignores. An id this action doesn't have is ignored (the `ui` server only knows the harness's ids). A failed move
   * is logged: the agent's turn itself went well.
   */
  private async phaseAsked(id: string, ask: PhaseRequest): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || c.status !== "waiting") return;
    const phases = this.phasesOf(c.action);
    const here = phases.findIndex((p) => p.id === c.phase?.id);
    const to = phases.findIndex((p) => p.id === ask.to);
    if (here < 0 || to < 0) {
      console.error(`The agent asked for a phase this task doesn't have: "${ask.to}"`);
      return;
    }
    const current = phases[here];
    // Its own id: "this part is done", which means something only in the close phase (D5).
    if (to === here && !current.close) return;
    const auto = current.auto === true && (to === here + 1 || to === here);
    if (!auto) {
      const proposal = { to: ask.to, reason: ask.reason };
      return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, phaseProposal: proposal } } : s));
    }
    // The caller's turn is the one that asked: how it ended stays `lastDone` (an answer's turn must not reopen its
    // question because the change turn after it failed).
    const asked = this.lastDone;
    try {
      if (to === here) await this.closeCurrent();
      else await this.endsInWindow(() => this.movePhase(c, phases[to], "agent"));
    } catch (err) {
      console.error("The phase change the agent asked for failed", err);
    } finally {
      this.lastDone = asked;
    }
  }

  /**
   * Checks, in order: a task waits (the one the caller saw); the action has the phase; it isn't the current one (the
   * close phase's own id is its Finish). Then the change: its message read first (a brief that can't be read refuses
   * it), then the state and the turn.
   */
  private async phaseNow(to: string, take: (r: PhaseResult) => void, task?: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.status !== "waiting" || (task !== undefined && c.id !== task)) return take({ ok: false, reason: "no-task" });
    const phases = this.phasesOf(c.action);
    const target = phases.find((p) => p.id === to);
    if (!target) return take({ ok: false, reason: "unknown" });
    if (c.phase?.id === to) {
      if (!target.close) return take({ ok: true, changed: "same" });
      // The close phase's Finish (D5): the core closing turn asks for the note and ends the task.
      take({ ok: true, changed: "closing" });
      await this.closeCurrent();
      return;
    }
    const back = phases.indexOf(target) < phases.findIndex((p) => p.id === c.phase?.id);
    const plan = await this.phasePlan(c, target, back);
    await this.personWorks(c);
    take({ ok: true, changed: plan.message ? "turn" : "quiet" });
    return this.endsInWindow(() => this.enterPhase(c, target, "person", plan, back));
  }

  /** Moves the task forward to `to` (the agent's `auto`, the time box): the plan, then the change. */
  private async movePhase(c: CurrentTask, to: HarnessPhase, by: PhaseBy): Promise<void> {
    const plan = await this.phasePlan(c, to, false);
    await this.enterPhase(c, to, by, plan, false);
  }

  /**
   * The change's message (spec §4.4): the new part, the way back, the time left, its brief, and what it does to the mode
   * (modes spec §7). A task whose session is gone (a folder move) gets no message: nothing to tell now, the resumed
   * session's first message carries the part and the mode (`resumeMessageFor`), so every move (the person's, the agent's,
   * the time box's) changes only the state.
   */
  private async phasePlan(c: CurrentTask, to: HarnessPhase, back: boolean): Promise<PhasePlan> {
    if (c.resume) {
      const { fields } = await this.modesOnEntry(c, to);
      return { message: null, ...(fields ? { modes: fields } : {}) };
    }
    const language = await this.d.language();
    const text = await this.phaseText(c.action!, to);
    const previous = this.phaseOf(c);
    const vars = { language, back, ...(previous ? { previous: oneLine(previous.label) } : {}), ...(c.timeBox ? { timeLeft: this.timeLeft(c) } : {}) };
    const entry = await this.modesOnEntry(c, to, language);
    const extra = entry.sections;
    return {
      message: text.brief || extra.length > 0 ? phasePrompt(text, { ...vars, extra }) : null,
      ...(entry.fields ? { modes: entry.fields } : {}),
    };
  }

  /**
   * Enters phase `to` (spec §4.4), inside the running operation. With a message, the window is told and a due checkpoint
   * runs first, still in the part the task leaves (a cancelled one moves nothing). Then the state: the phase, the log,
   * the mode fields, and the proposal goes. Then one run turn of the same session carries the message; its answer
   * shows, and the chat's line is the separator.
   */
  private async enterPhase(c: CurrentTask, to: HarnessPhase, by: PhaseBy, plan: PhasePlan, back: boolean): Promise<void> {
    if (plan.message) {
      this.tellTurn({ task: c.id, kind: "phase", phase: to.id, by, ...(back ? { back: true as const } : {}) });
      const before = (await this.d.store.load()).current;
      if (before?.id !== c.id) return this.stopped();
      if (needsCheckpoint(before) && !(await this.checkpoint(before))) return this.stopped();
    }
    const at = this.now().toISOString();
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { phaseProposal: _proposal, ...rest } = s.current;
      let next: CurrentTask = { ...rest, phase: { id: to.id, startedAt: at }, phases: [...(rest.phases ?? []), { id: to.id, at, by }].slice(-PHASE_LOG_MAX) };
      if (plan.modes) {
        const { mode: _m, modes: _ms, suspendedMode: _s, belowMinTier: _b, ...base } = next;
        next = { ...base, ...plan.modes };
      }
      return { ...s, current: next };
    });
    if (!plan.message) return;
    const now = (await this.d.store.load()).current;
    if (now?.id !== c.id) return this.stopped();
    await this.setStatus(c.id, "running");
    // Checked with no await before the send: a Stop while the status was saved.
    if (this.cancelRequested) {
      await this.setStatus(c.id, "waiting");
      return this.stopped();
    }
    let done: Done;
    try {
      done = await this.runTurn(now, plan.message, {
        display: `— ${oneLine(to.label)} —`,
        ...(c.action ? { action: c.action } : {}),
        followUp: true,
        phase: "phase-change",
        phaseChange: to.id,
      });
    } catch (err) {
      if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
      throw unwrap(err);
    }
    return this.afterRun(c.id, done, false);
  }

  /** Tells the window a turn the app starts on its own is coming; that turn's `done` is the window's to see again. */
  private tellTurn(notice: TaskTurnNotice): void {
    this.windowDone = false;
    try {
      this.d.taskTurn?.(notice);
    } catch (err) {
      console.error("Could not tell the window about the turn", err);
    }
  }

  /** The agent's proposal goes (the person moved, or sent something else). */
  private dropProposal(id: string): Promise<void> {
    return this.update((s) => {
      if (s.current?.id !== id || !s.current.phaseProposal) return s;
      const { phaseProposal: _proposal, ...rest } = s.current;
      return { ...s, current: rest };
    });
  }

  /** Sets the one timer for the open task's next time-box step (spec §5): none while paused, after quit, or when done. */
  private arm(c: CurrentTask | null): void {
    // A step already waits to run: it arms the next one when it is over.
    if (this.stepPending) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const box = c?.timeBox;
    if (!c || !box?.runningSince || this.closed) return;
    const wrapUpAt = this.known(c.action) ? this.d.actions[c.action].timeBox?.wrapUpAt : undefined;
    const due = nextDue(box, wrapUpAt, this.now(), this.minute);
    // A step due now for a task that doesn't wait: the write that makes it wait arms it.
    if (!due || (due.inMs === 0 && c.status !== "waiting")) return;
    const id = c.id;
    this.timer = this.timers.set(
      () => {
        this.timer = null;
        this.stepPending = true;
        // A step never cuts a turn: it waits until nothing runs (spec §5).
        void this.whenFree(() => this.op(() => this.timeNow(id)))
          .catch((err: unknown) => {
            // Quitting refuses the waiting step: nothing went wrong.
            if (!this.closed) console.error("The time box's step failed", err);
          })
          .finally(() => {
            this.stepPending = false;
            this.rearm();
          });
      },
      Math.min(due.inMs, MAX_TIMER_MS),
    );
  }

  /** Arms the timer from tasks.json as it is after the pending writes. */
  private rearm(): void {
    const run = this.writes.then(async () => this.arm((await this.d.store.load()).current));
    this.writes = run.catch((err: unknown) => console.error("Could not arm the time box", err));
  }

  /** The step that is due now, if the task is still the one and still waits; early (time was added): armed again after it. */
  private async timeNow(id: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || !c.timeBox?.runningSince || !this.known(c.action)) return;
    const due = nextDue(c.timeBox, this.d.actions[c.action].timeBox?.wrapUpAt, this.now(), this.minute);
    if (!due || due.inMs > 0) return;
    // Not waiting (a stuck status): the write that makes it wait arms it again.
    if (c.status !== "waiting") return;
    if (due.kind === "wrap-up") return this.wrapUp(c);
    await this.updateTimeBox(c.id, (t) => ({ ...t, ended: true }));
    await this.endsInWindow(() => this.toClosePhase(c.id));
  }

  /**
   * The wrap-up (spec §5): once, one turn asking to finish the point, then the close phase if it never started. Like a
   * phase change, a due checkpoint runs first; a task whose session is gone gets no turn, only the move (quiet too).
   */
  private async wrapUp(c: CurrentTask): Promise<void> {
    await this.updateTimeBox(c.id, (t) => ({ ...t, wrappedUp: true }));
    if (c.resume) return this.toClosePhase(c.id);
    return this.endsInWindow(async () => {
      this.tellTurn({ task: c.id, kind: "wrap-up" });
      const before = (await this.d.store.load()).current;
      if (before?.id !== c.id) return this.stopped();
      if (needsCheckpoint(before) && !(await this.checkpoint(before))) return this.stopped();
      const now = (await this.d.store.load()).current;
      if (now?.id !== c.id) return this.stopped();
      await this.setStatus(c.id, "running");
      // Checked with no await before the send: a Stop while the status was saved.
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      let done: Done;
      try {
        // `display` always goes with `wrapUp`: the chat shows the system line, never the prompt.
        done = await this.runTurn(now, wrapUpPrompt(await this.d.language()), {
          display: "Time is almost up",
          ...(c.action ? { action: c.action } : {}),
          followUp: true,
          phase: "wrap-up",
          wrapUp: true,
        });
      } catch (err) {
        if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
        throw unwrap(err);
      }
      await this.afterRun(c.id, done, false);
      if (done.ok && !this.cancelRequested) await this.toClosePhase(c.id);
    });
  }

  /** After the wrap-up or at 100% (spec §5): the close phase by the app, unless the task has been in it already. */
  private async toClosePhase(id: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || c.status !== "waiting") return;
    const close = this.phasesOf(c.action).find((p) => p.close);
    if (!close || (c.phases ?? []).some((e) => e.id === close.id)) return;
    await this.movePhase(c, close, "app");
  }

  /** A turn the person starts (a message, a phase or mode pick): they are working, so a paused time box runs again (spec §5). */
  private async personWorks(c: CurrentTask): Promise<void> {
    if (!c.timeBox || c.timeBox.runningSince) return;
    const since = this.now();
    await this.updateTimeBox(c.id, (t) => running(t, since));
  }

  /** Changes the open task's time box, if it is still task `id`'s. */
  private updateTimeBox(id: string, fn: (t: TimeBoxState) => TimeBoxState): Promise<void> {
    return this.update((s) => (s.current?.id === id && s.current.timeBox ? { ...s, current: { ...s.current, timeBox: fn(s.current.timeBox) } } : s));
  }

  /**
   * Closes the open task: one quiet turn asking for `save_note`, unless its note is already written.
   * False when the closing turn was cancelled (or a cancel or quit came meanwhile): nothing new may start.
   */
  private async closeCurrent(): Promise<boolean> {
    const c = await this.storedCurrent();
    if (!c) return !this.cancelRequested;
    if (c.noteSaved) {
      await this.endTask(c.id, "done");
      return !this.cancelRequested;
    }
    // A moved task's new session holds no conversation to sum up (a checkpoint's note still counts).
    if (c.resume) {
      await this.endTask(c.id, "unfinished");
      return !this.cancelRequested;
    }
    if (c.status !== "waiting") {
      await this.endTask(c.id, "unfinished");
      return !this.cancelRequested;
    }
    await this.setStatus(c.id, "closing");
    // Checked with no await before the closing turn: a Stop while the status was saved.
    if (this.cancelRequested) {
      await this.setStatus(c.id, "waiting");
      return false;
    }
    let done: Done;
    try {
      // The modes used are listed (task-modes spec §6); a task with none: CLOSE_PROMPT exactly (D0).
      done = await this.runTurn(c, closePrompt(this.modeLabels(c)), { ...(c.action ? { action: c.action } : {}), phase: "close", quiet: true });
    } catch (err) {
      if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
      throw unwrap(err);
    }
    const cancelled = !done.ok && done.error.code === "cancelled";
    const after = (await this.d.store.load()).current;
    // A checkpoint's note stands when the closing turn brings none (as `interrupted` keeps it).
    const saved = after?.noteSaved === true || after?.checkpointNote === true;
    await this.endTask(c.id, saved ? "done" : cancelled ? "unfinished" : "unsaved");
    return !cancelled && !this.cancelRequested;
  }

  /**
   * A quiet turn asking for `save_note` before the context reaches the task's cap (spec §6): same session,
   * same profile, the note goes to the task's own file. False when it was cancelled (nothing more runs);
   * a cancelled checkpoint is offered again before the next follow-up.
   */
  private async checkpoint(c: CurrentTask): Promise<boolean> {
    await this.update((s) => (s.current?.id === c.id ? { ...s, current: { ...s.current, status: "checkpoint", checkpointed: true } } : s));
    const waitAgain = () => this.update((s) => (s.current?.id === c.id ? { ...s, current: { ...s.current, status: "waiting", checkpointed: false } } : s));
    // Checked with no await before the turn: a Stop while the status was saved.
    if (this.cancelRequested) {
      await waitAgain();
      return false;
    }
    let done: Done;
    try {
      // Its failure is held: the follow-up runs next and its own end is the one the window shows.
      done = await this.runTurn(c, CHECKPOINT_PROMPT, { ...(c.action ? { action: c.action } : {}), phase: "checkpoint", quiet: true, holdFailure: true });
    } catch (err) {
      if (err instanceof TurnNotStarted) await waitAgain();
      throw unwrap(err);
    }
    if ((!done.ok && done.error.code === "cancelled") || this.cancelRequested) {
      await waitAgain();
      return false;
    }
    // Any other failure doesn't stop the person's turn: the engine still compacts on its own.
    return true;
  }

  /**
   * Keeps the context in use after a turn. A compaction (reported, or `used` falling by more than half)
   * allows a new checkpoint and is logged (spec §6).
   */
  private async track(id: string, seen: { used?: number; size?: number; compacted?: boolean }): Promise<void> {
    const before = (await this.d.store.load()).current;
    if (before?.id !== id) return;
    const prev = before.context?.used;
    const compacted = seen.compacted === true || (prev !== undefined && seen.used !== undefined && seen.used < prev * COMPACTED_DROP);
    const context = seen.used !== undefined ? { used: seen.used, ...(seen.size !== undefined ? { size: seen.size } : {}) } : undefined;
    await this.update((s) =>
      s.current?.id === id ? { ...s, current: { ...s.current, ...(context ? { context } : {}), ...(compacted ? { checkpointed: false } : {}) } } : s,
    );
    if (!compacted) return;
    try {
      await this.d.recordCompaction?.(before);
    } catch (err) {
      console.error("Could not record the compaction", err);
    }
  }

  /**
   * The operation stops (cancel or quit) before its turn reached the window, which already shows that
   * turn running: a cancelled `done` ends it there, as a cancelled turn's own would.
   */
  private stopped(): void {
    if (this.windowDone) return;
    this.windowDone = true;
    try {
      this.d.emit?.(fail("cancelled"));
    } catch (err) {
      console.error("Could not send an event to the window", err);
    }
  }

  private async endTask(id: string, outcome: ActionStatus): Promise<void> {
    await this.update((s) => {
      const c = s.current;
      if (!c || c.id !== id) return s;
      if (outcome !== "done") return interrupted(s, outcome);
      if (!c.action) return { ...s, current: null };
      return { ...withStatus(s, scopeOfTask(c), c.action, "done"), current: null };
    });
    await this.endSession();
    await this.between();
  }

  private async saveNote(task: CurrentTask, note: SavedNote, final = true): Promise<void> {
    try {
      const scope = scopeOfTask(task);
      const slug = task.action ?? (await this.questionSlug(task.id, note.title, scope));
      const meta: NoteMeta = {
        ...(task.action ? { action: task.action } : {}),
        date: this.now().toISOString(),
        engine: await this.d.engine(),
        // The modes the task used (task-modes spec §6); none: as before (D0).
        ...(task.modes && task.modes.length > 0 ? { modes: task.modes } : {}),
      };
      // Without scopes the call is exactly today's (D2).
      if (this.d.scoped) await this.d.writeNote(slug, note, meta, scope);
      else await this.d.writeNote(slug, note, meta);
      // A checkpoint's note is provisional: the closing turn still runs and updates the same file.
      await this.update((s) =>
        s.current?.id === task.id
          ? { ...s, current: { ...s.current, ...(final ? { noteSaved: true } : { checkpointNote: true, checkpointTurns: s.current.turns }) } }
          : s,
      );
      await this.d.saveHistory?.(`${NOTE_PREFIX}${note.title.slice(0, 60)}`, this.trailerOf(task));
    } catch (err) {
      console.error("Could not save the note", err);
    }
  }

  /**
   * An input block shown in task `id`'s turn becomes its pending input, replacing any earlier one (spec D5). Saved
   * as the event arrives, so the window knows the question before the turn ends. A failure is logged.
   */
  private showInput(id: string, block: string, blockId: string): Promise<void> {
    const shownAt = this.now().toISOString();
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, pendingInput: { blockId, block, shownAt } } } : s)).catch((err: unknown) =>
      console.error("Could not record the question shown", err),
    );
  }

  /** `q-<title slug>`, numbered (`-2`, `-3`…) when another note of the scope already has that name. */
  private async questionSlug(taskId: string, title: string, scope: string): Promise<string> {
    const own = this.questionSlugs.get(taskId);
    if (own) return own;
    const where = this.d.scoped ? scope : undefined;
    const exists = this.d.noteExists
      ? (slug: string) => this.d.noteExists!(slug, where)
      : await this.d.notes(where).then(
          (notes) => (slug: string) => Promise.resolve(notes.some((n) => n.slug === slug)),
          () => () => Promise.resolve(false),
        );
    const base = `q-${noteSlug(title)}`;
    let slug = base;
    for (let i = 2; await exists(slug); i++) slug = `${base}-${i}`;
    this.questionSlugs.clear();
    this.questionSlugs.set(taskId, slug);
    return slug;
  }

  private setStatus(id: string, status: TaskStatus): Promise<void> {
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status } } : s));
  }

  private async endSession(): Promise<void> {
    try {
      await this.d.endSession();
    } catch (err) {
      console.error("Could not end the engine session", err);
    }
  }

  private async between(): Promise<void> {
    try {
      await this.d.betweenTasks?.();
    } catch (err) {
      console.error("Could not prepare the next session", err);
    }
  }

  /** Reads tasks.json, applies `fn`, saves it when it changed and tells the window. */
  private update(fn: (s: TasksFile) => TasksFile): Promise<void> {
    const run = this.writes.then(async () => {
      const before = await this.d.store.load();
      const after = fn(before);
      if (after === before) return;
      await this.d.store.save(after);
      this.arm(after.current);
      try {
        this.d.changed(await this.view());
      } catch (err) {
        console.error("Could not send the tasks to the window", err);
      }
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
