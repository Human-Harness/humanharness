import { randomUUID } from "node:crypto";
import type { ModelProfile } from "@humanharness/engines";
import { type ChoiceOption, type Language, type LocalizedText, type SavedNote, saveNoteSchema } from "@humanharness/harness-sdk";
import { type Event, type Session, fail } from "@humanharness/runtime";
import { type ActionStatus, type CurrentTaskView, type NoteView, type TaskStatus, type TaskView, nextInPath } from "@humanharness/ui/client";
import { APP_SCOPE, type HistoryTrailer, MAIN_SCOPE, NOTE_PREFIX, type Note, type NoteMeta, buildNotesIndex, isScopeId, noteSlug } from "@humanharness/workspace";
import { CHECKPOINT_PROMPT, CLOSE_PROMPT, QUESTION_PROMPT, fillPrompt, resumeMessage } from "./task-prompts";
import { type CurrentTask, type TasksFile, interrupted, keptQuestion, scopeOfTask, statusesIn, withStatus } from "./task-store";
import { type TurnOptions, isHeld } from "./turn-controller";

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
  /** The harness's actions: their labels, by language, and where each runs when the harness has scopes. */
  actions: Record<string, { label: LocalizedText; scope?: "required" | "none" }>;
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
  /** The model profile a new task runs on, resolved once when it starts (resources spec §5). Absent: the engine's defaults. */
  profileFor?(action: string | undefined): Promise<ModelProfile>;
  /** The profile to retry a first turn with after `model-unavailable`, or null when none is left (spec §5.3). */
  fallbackFor?(profile: ModelProfile, tried: string[]): Promise<ModelProfile | null>;
  /**
   * A stored profile (tasks.json) fitted again to what its engine offers now, before a resumed task runs
   * on it: an effort the engine stopped offering never reaches argv or CODEX_CONFIG. Absent: used as stored.
   */
  fitProfile?(profile: ModelProfile): Promise<ModelProfile>;
  /** A compaction was detected in `task`'s session (usage.jsonl `kind: "compaction"`). Failures are logged. */
  recordCompaction?(task: CurrentTask): Promise<void>;
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

/** The open task as the window sees it: no session, no prompt, just what the screen shows. */
const currentView = (c: CurrentTask): CurrentTaskView => ({
  id: c.id,
  ...(c.action ? { action: c.action } : {}),
  ...(c.scope ? { scope: c.scope } : {}),
  status: c.status,
  ...(c.profile && c.context ? { context: { used: c.context.used, cap: c.profile.cap } } : {}),
  ...(c.profile?.fallbackFrom
    ? { fallback: { model: c.profile.fallbackFrom, ...(c.profile.model !== undefined && c.profile.tier !== "custom" ? { tier: c.profile.tier } : {}) } }
    : {}),
});

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
  /** The slug each free-question task wrote its note under, so a second save replaces its own note. */
  private readonly questionSlugs = new Map<string, string>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: TaskDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? randomUUID;
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
      return { current: c ? currentView(c) : null, actions: state.actions, notes: notes.map(noteView) };
    }
    const state = await this.d.store.load();
    const c = state.current;
    const scope = this.chatOf(state);
    const own = await this.d.notes(scope).catch(() => [] as Note[]);
    const app = scope === APP_SCOPE ? [] : await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
    return {
      current: c ? currentView(c) : null,
      // The open scope's statuses, over the app-wide actions' own.
      actions: { ...statusesIn(state, APP_SCOPE), ...statusesIn(state, scope) },
      notes: [...own, ...app].map(noteView),
      scope: state.open ?? null,
    };
  }

  /**
   * Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows.
   * `scope`, in a harness with scopes, is opened first (closing the open task, spec §3.3).
   */
  start(action: string, display?: string, scope?: string): Promise<void> {
    return this.op(() => this.startNow(action, display, scope));
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

  /** For quitting: every later operation is refused and the running one starts no further turn. */
  close(): void {
    this.closed = true;
    this.cancelRequested = true;
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

  /** The history trailer of a task's commits; `scope` only in a harness with scopes (D2). */
  private trailerOf(c: CurrentTask): HistoryTrailer {
    return { task: c.id, ...(c.action ? { action: c.action } : {}), ...(c.scope ? { scope: c.scope } : {}) };
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

  private async startNow(action: string, display?: string, scope?: string): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
    // Checked before anything closes: a required action with no open scope starts nothing.
    const where = this.scopeFor(await this.d.store.load(), action);
    if (!(await this.closeCurrent())) return this.stopped();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    await this.begin({ action }, where, (notesIndex) => fillPrompt(template, { language, notesIndex }), display ?? this.d.actions[action].label[language]);
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
    return resumeMessage({
      language,
      notesIndex: await this.contextFor(scopeOfTask(c), c.action),
      ...(brief !== undefined ? { brief } : {}),
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
    task: { action?: string; question?: string; questionCut?: true },
    scope: string,
    message: (notesIndex: string) => string,
    display: string,
  ): Promise<void> {
    // Cancelled or quitting since the operation began (e.g. right after the closing turn): start nothing.
    if (this.cancelRequested) return this.stopped();
    await this.endSession();
    const context = await this.contextFor(scope, task.action);
    const engine = await this.d.engine();
    // Resolved once: the task keeps its model, effort and cap to the end (spec D2).
    const profile = await this.d.profileFor?.(task.action);
    const current: CurrentTask = {
      id: this.newId(),
      ...task,
      status: "running",
      startedAt: this.now().toISOString(),
      turns: 0,
      ...(profile ? { profile } : {}),
      ...(this.d.scoped ? { scope } : {}),
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
    const seen: { done?: Done; note?: SavedNote; used?: number; size?: number; compacted?: boolean } = {};
    this.turnTask = task.id;
    try {
      const scoped = await this.scopeOptions(task);
      await this.d.turns.send(message, {
        phase: "run",
        ...options,
        ...scoped,
        ...(task.profile ? { profile: task.profile } : {}),
        task: task.id,
        onEvent: (e) => {
          if (e.type === "done") seen.done = e;
          else if (e.type === "block" && e.name === "save_note") {
            const parsed = saveNoteSchema.safeParse(e.data);
            if (parsed.success) seen.note = parsed.data;
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
    // Mirrors TurnController: a quiet turn reaches the window only with a failure other than a cancel,
    // and a held failure never does.
    const d = seen.done;
    if (d && !isHeld(d, options) && (!options.quiet || (!d.ok && d.error.code !== "cancelled"))) this.windowDone = true;
    if (seen.note) await this.saveNote(task, seen.note, options.phase !== "checkpoint");
    if (seen.used !== undefined || seen.compacted) await this.track(task.id, seen);
    return seen.done ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
  }

  private async afterRun(id: string, done: Done, first: boolean): Promise<void> {
    if (!done.ok && (done.error.code === "cancelled" || first)) return this.endTask(id, "unfinished");
    await this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status: "waiting", turns: s.current.turns + 1 } } : s));
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
      done = await this.runTurn(c, CLOSE_PROMPT, { ...(c.action ? { action: c.action } : {}), phase: "close", quiet: true });
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
  }

  private async saveNote(task: CurrentTask, note: SavedNote, final = true): Promise<void> {
    try {
      const scope = scopeOfTask(task);
      const slug = task.action ?? (await this.questionSlug(task.id, note.title, scope));
      const meta: NoteMeta = { ...(task.action ? { action: task.action } : {}), date: this.now().toISOString(), engine: await this.d.engine() };
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

  /** Reads tasks.json, applies `fn`, saves it when it changed and tells the window. */
  private update(fn: (s: TasksFile) => TasksFile): Promise<void> {
    const run = this.writes.then(async () => {
      const before = await this.d.store.load();
      const after = fn(before);
      if (after === before) return;
      await this.d.store.save(after);
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
