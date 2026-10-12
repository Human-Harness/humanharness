import { randomUUID } from "node:crypto";
import { type ChoiceOption, type Language, type LocalizedText, type SavedNote, saveNoteSchema } from "@humanharness/harness-sdk";
import type { Event, Session } from "@humanharness/runtime";
import { type ActionStatus, type NoteView, type TaskStatus, type TaskView, nextInPath } from "@humanharness/ui/client";
import { type Note, type NoteMeta, buildNotesIndex, noteSlug } from "@humanharness/workspace";
import { CLOSE_PROMPT, QUESTION_PROMPT, fillPrompt } from "./task-prompts";
import type { CurrentTask, TasksFile } from "./task-store";
import type { TurnOptions } from "./turn-controller";

type Done = Extract<Event, { type: "done" }>;

export interface TaskDeps {
  /** tasks.json of the configured folder. */
  store: { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void> };
  turns: { send(message: string, options: TurnOptions): Promise<void>; isBusy(): boolean };
  /** The harness's actions (their labels, by language). */
  actions: Record<string, { label: LocalizedText }>;
  /** The guided path: action ids in order. */
  path: string[];
  /** The text of the action's brief (its prompt file). */
  readPrompt(action: string): Promise<string>;
  language(): Promise<Language>;
  engine(): Promise<string>;
  /** The folder's notes, newest first. */
  notes(): Promise<Note[]>;
  writeNote(slug: string, note: SavedNote, meta: NoteMeta): Promise<void>;
  /** Whether `.harness/notes/<slug>.md` exists (readable or not). Defaults to the slugs of `notes()`. */
  noteExists?(slug: string): Promise<boolean>;
  /** Ends the engine session (Codex: `session/close`); the next turn starts a new one. */
  endSession(): Promise<void>;
  /** Records the folder in the local history (a note was written). */
  saveHistory?(message: string): Promise<void>;
  /** The task view changed: tell the window. */
  changed(view: TaskView): void;
  now?: () => Date;
  newId?: () => string;
}

const noteView = (n: Note): NoteView => ({
  slug: n.slug,
  title: n.title,
  ...(n.action ? { action: n.action } : {}),
  date: n.date,
  summary: n.summary,
  decisions: n.decisions,
  path: n.path,
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
    const [state, notes] = await Promise.all([this.d.store.load(), this.d.notes().catch(() => [] as Note[])]);
    const c = state.current;
    return {
      current: c ? { id: c.id, ...(c.action ? { action: c.action } : {}), status: c.status } : null,
      actions: state.actions,
      notes: notes.map(noteView),
    };
  }

  /** Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows. */
  start(action: string, display?: string): Promise<void> {
    return this.op(() => this.startNow(action, display));
  }

  /** A message from the person: a follow-up of the waiting task, or a new free-question task. */
  ask(text: string, display?: string): Promise<void> {
    return this.op(() => this.askNow(text, display));
  }

  /** An option of a `choices` block. */
  choose(option: ChoiceOption): Promise<void> {
    return this.op(() => this.chooseNow(option));
  }

  /** Ends the open task without a note (engine change, quit, dropped runtime, a task left by an earlier run). */
  interrupt(): Promise<void> {
    return this.queue(async () => {
      const c = (await this.d.store.load()).current;
      if (c) await this.endTask(c.id, "unfinished");
    });
  }

  /** The engine started the current task's session. */
  sessionStarted(session: Session): Promise<void> {
    return this.update((s) => (s.current ? { ...s, current: { ...s.current, session: { id: session.id, started: session.started } } } : s));
  }

  private op(fn: () => Promise<void>): Promise<void> {
    if (this.isBusy()) return Promise.reject(new Error("A turn is already running"));
    this.running = true;
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

  private async startNow(action: string, display?: string): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    await this.closeCurrent();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    await this.begin({ action }, (notesIndex) => fillPrompt(template, { language, notesIndex }), display ?? this.d.actions[action].label[language]);
  }

  private async askNow(text: string, display?: string): Promise<void> {
    const c = (await this.d.store.load()).current;
    if (c?.status === "waiting") {
      await this.setStatus(c.id, "running");
      const done = await this.runTurn(c, text, { ...(display ? { display } : {}), ...(c.action ? { action: c.action } : {}), followUp: true });
      return this.afterRun(c.id, done, false);
    }
    if (c) await this.endTask(c.id, "unfinished");
    const language = await this.d.language();
    await this.begin(
      { question: text.slice(0, 500) },
      (notesIndex) => fillPrompt(QUESTION_PROMPT, { language, notesIndex, question: text }),
      display ?? text,
    );
  }

  /**
   * Precedence: a known `action`, then `next`, then `followUp`. An option with none of them (or only an
   * unknown action) is a follow-up whose text is its label.
   */
  private async chooseNow(option: ChoiceOption): Promise<void> {
    const state = await this.d.store.load();
    const action = this.known(option.action) ? option.action : undefined;
    if (!option.next && !action) return this.askNow(option.followUp ?? option.label, option.label);
    const target = action ?? nextInPath(this.d.path, state.current?.action, state.actions);
    await this.closeCurrent();
    if (target) await this.startNow(target);
  }

  /** A new task in a fresh session; its first message is built from the notes index. */
  private async begin(task: { action?: string; question?: string }, message: (notesIndex: string) => string, display: string): Promise<void> {
    await this.endSession();
    const notes = await this.d.notes().catch(() => [] as Note[]);
    const engine = await this.d.engine();
    const current: CurrentTask = { id: this.newId(), ...task, status: "running", startedAt: this.now().toISOString(), turns: 0 };
    await this.update((s) => ({ ...s, engine, current }));
    const done = await this.runTurn(current, message(buildNotesIndex(notes)), { display, ...(task.action ? { action: task.action } : {}) });
    await this.afterRun(current.id, done, true);
  }

  /** Runs one turn of `task`; a valid `save_note` in it becomes the task's note. */
  private async runTurn(task: CurrentTask, message: string, options: Omit<TurnOptions, "task" | "onEvent">): Promise<Done> {
    const seen: { done?: Done; note?: SavedNote } = {};
    try {
      await this.d.turns.send(message, {
        phase: "run",
        ...options,
        task: task.id,
        onEvent: (e) => {
          if (e.type === "done") seen.done = e;
          else if (e.type === "block" && e.name === "save_note") {
            const parsed = saveNoteSchema.safeParse(e.data);
            if (parsed.success) seen.note = parsed.data;
          }
        },
      });
    } catch (err) {
      // The turn never started (another one runs, or the app is closing).
      seen.done ??= { type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } };
    }
    if (seen.note) await this.saveNote(task, seen.note);
    return seen.done ?? { type: "done", ok: false, error: { code: "agent-crashed" } };
  }

  private async afterRun(id: string, done: Done, first: boolean): Promise<void> {
    if (!done.ok && (done.error.code === "cancelled" || first)) return this.endTask(id, "unfinished");
    await this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status: "waiting", turns: s.current.turns + 1 } } : s));
  }

  /** Closes the open task: one quiet turn asking for `save_note`, unless its note is already written. */
  private async closeCurrent(): Promise<void> {
    const c = (await this.d.store.load()).current;
    if (!c) return;
    if (c.noteSaved) return this.endTask(c.id, "done");
    if (c.status !== "waiting") return this.endTask(c.id, "unfinished");
    await this.setStatus(c.id, "closing");
    const done = await this.runTurn(c, CLOSE_PROMPT, { ...(c.action ? { action: c.action } : {}), phase: "close", quiet: true });
    const saved = (await this.d.store.load()).current?.noteSaved === true;
    await this.endTask(c.id, saved ? "done" : !done.ok && done.error.code === "cancelled" ? "unfinished" : "unsaved");
  }

  private async endTask(id: string, outcome: ActionStatus): Promise<void> {
    await this.update((s) => {
      const c = s.current;
      if (!c || c.id !== id) return s;
      if (!c.action) return { ...s, current: null };
      const status: ActionStatus = c.noteSaved || (outcome !== "done" && s.actions[c.action] === "done") ? "done" : outcome;
      return { ...s, current: null, actions: { ...s.actions, [c.action]: status } };
    });
    await this.endSession();
  }

  private async saveNote(task: CurrentTask, note: SavedNote): Promise<void> {
    try {
      const slug = task.action ?? (await this.questionSlug(task.id, note.title));
      await this.d.writeNote(slug, note, { ...(task.action ? { action: task.action } : {}), date: this.now().toISOString(), engine: await this.d.engine() });
      await this.update((s) => (s.current?.id === task.id ? { ...s, current: { ...s.current, noteSaved: true } } : s));
      await this.d.saveHistory?.(`Note: ${note.title.slice(0, 60)}`);
    } catch (err) {
      console.error("Could not save the note", err);
    }
  }

  /** `q-<title slug>`, numbered (`-2`, `-3`…) when another note already has that name. */
  private async questionSlug(taskId: string, title: string): Promise<string> {
    const own = this.questionSlugs.get(taskId);
    if (own) return own;
    const exists =
      this.d.noteExists?.bind(this.d) ??
      (await this.d.notes().then(
        (notes) => (slug: string) => Promise.resolve(notes.some((n) => n.slug === slug)),
        () => () => Promise.resolve(false),
      ));
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
