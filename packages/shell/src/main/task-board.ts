import type { TaskView } from "@humanharness/ui/client";
import { type TasksFileStore, withTasksFile } from "./lane-store";
import type { TaskManager } from "./task-manager";
import { LANES_MAX, type TasksFile, interrupted, interruptedLanes, isLaneId } from "./task-store";

/** TaskManager methods a lane forwards as they are; the board's tests leave out the ones they don't use. */
type Forwarded =
  | "startPrepared"
  | "choose"
  | "respond"
  | "chooseMode"
  | "setPhase"
  | "currentScope"
  | "chatScope"
  | "runningTask"
  | "openPhase"
  | "trailerNow"
  | "pauseTimeBox"
  | "resumeTimeBox"
  | "extendTimeBox"
  | "resumeFromNotes"
  | "checkpointBeforeMove"
  | "idle";

/** What the board needs from one lane: a TaskManager (its methods have the same names) plus close. */
export interface LaneHandle extends Partial<Pick<TaskManager, Forwarded>> {
  /** The lane's task id, its slot key and its key in tasks.json `lanes`. */
  readonly id: string;
  start(action: string, display?: string, scope?: string, mode?: string, opts?: { timeBox?: number | null }): Promise<void>;
  ask(text: string, display?: string, scope?: string): Promise<void>;
  isBusy(): boolean;
  view(): Promise<TaskView>;
  finish(): Promise<boolean>;
  cancel(): void;
  interrupt(): Promise<void>;
  /** Closes its slot and listeners (the task already ended, or the app quits). */
  close(): Promise<void>;
}

export interface BoardDeps {
  /** tasks.json: the store every lane's `LaneStore` wraps, so the board's writes share their write chain. */
  file: TasksFileStore;
  /** A lane whose next task gets id `id` (a lane over a fresh `TaskManager` whose `newId` gives `id`). */
  newLane(id: string): LaneHandle;
  /** The id the next task gets: a safe lane id (`isLaneId`). */
  newId(): string;
  /** The open tasks or the focus changed: the window's view and the inbox read again. */
  changed(): void;
}

/**
 * Board mode's open tasks (parallel spec §6, Decision 3): one lane per task, keyed by its id. Starting a task never
 * closes another: it runs in a fresh idle lane (the start view), which then becomes that task's lane and gets the
 * focus. The focused lane is the one the window shows; closing, a follow-up and the guided path act on it only.
 */
export class TaskBoard {
  private readonly lanes = new Map<string, LaneHandle>();
  /** The lane the next task starts in: the start view's. Made on first use. */
  private spare: LaneHandle | null = null;
  private focusId: string | null = null;
  /** Lane creation, restore and `whenNoTask`, one after another. Never a lane's turn. */
  private ops: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: BoardDeps) {}

  /**
   * Reopens the lanes tasks.json lists (after a restart, before `interrupt` ends them). A `current` left by plain mode
   * or an older app becomes a lane, so its chat (moved to the task's own file first, Decision 8) stays with it; past
   * LANES_MAX, or with an id that can't name a lane, it ends unfinished instead.
   */
  restore(): Promise<void> {
    return this.serial(async () => {
      const f = await withTasksFile(this.d.file, async () => {
        const f = await this.d.file.load();
        const c = f.current;
        if (!c) return f;
        const lanes = f.lanes ?? [];
        const next: TasksFile =
          !isLaneId(c.id) || lanes.length >= LANES_MAX
            ? interrupted(f)
            : { ...f, current: null, lanes: lanes.some((l) => l.id === c.id) ? lanes : [c, ...lanes] };
        await this.d.file.save(next);
        return next;
      });
      for (const t of f.lanes ?? []) if (isLaneId(t.id) && !this.lanes.has(t.id)) this.lanes.set(t.id, this.d.newLane(t.id));
      this.focusId = typeof f.focus === "string" && this.lanes.get(f.focus) !== undefined ? f.focus : null;
      this.d.changed();
    });
  }

  laneIds(): string[] {
    return [...this.lanes.keys()];
  }

  lane(id: string): LaneHandle | undefined {
    return this.lanes.get(id);
  }

  /** The focused task's id; null at the start view. */
  focusedId(): string | null {
    return this.focusId;
  }

  /** The lane the window shows, or the idle lane (start view). */
  focused(): LaneHandle {
    if (this.focusId !== null) {
      const l = this.lanes.get(this.focusId);
      if (l) return l;
    }
    return this.idleLane();
  }

  /** A new task in its own lane; every open task stays open. */
  start(action: string, display?: string, scope?: string, mode?: string, opts?: { timeBox?: number | null }): Promise<void> {
    return this.begin((l) => l.start(action, display, scope, mode, opts));
  }

  /** A plugin's prepared task: a new task in its own lane, as `start`. */
  startPrepared(p: Parameters<TaskManager["startPrepared"]>[0]): Promise<void> {
    return this.begin((l) => need(l, "startPrepared")(p));
  }

  /** In an open task's chat, a follow-up of that task; at the start view, a new task (as today). */
  ask(text: string, display?: string, scope?: string): Promise<void> {
    const open = this.focusId === null ? undefined : this.lanes.get(this.focusId);
    if (open) return open.ask(text, display, scope);
    return this.begin((l) => l.ask(text, display, scope));
  }

  /** Shows task `id` (null: the start view). Only an open task's id is taken (threat model P1). */
  async focus(id: string | null): Promise<void> {
    if (id !== null && (!isLaneId(id) || this.lanes.get(id) === undefined)) throw new Error("Unknown task");
    this.focusId = id;
    await this.writeFocus();
    this.d.changed();
  }

  choose(...a: Parameters<TaskManager["choose"]>): ReturnType<TaskManager["choose"]> {
    return need(this.focused(), "choose")(...a);
  }

  respond(...a: Parameters<TaskManager["respond"]>): ReturnType<TaskManager["respond"]> {
    return need(this.focused(), "respond")(...a);
  }

  chooseMode(...a: Parameters<TaskManager["chooseMode"]>): ReturnType<TaskManager["chooseMode"]> {
    return need(this.focused(), "chooseMode")(...a);
  }

  setPhase(...a: Parameters<TaskManager["setPhase"]>): ReturnType<TaskManager["setPhase"]> {
    return need(this.focused(), "setPhase")(...a);
  }

  currentScope(): ReturnType<TaskManager["currentScope"]> {
    return need(this.focused(), "currentScope")();
  }

  chatScope(): ReturnType<TaskManager["chatScope"]> {
    return need(this.focused(), "chatScope")();
  }

  runningTask(): ReturnType<TaskManager["runningTask"]> {
    return need(this.focused(), "runningTask")();
  }

  openPhase(): ReturnType<TaskManager["openPhase"]> {
    return need(this.focused(), "openPhase")();
  }

  trailerNow(): ReturnType<TaskManager["trailerNow"]> {
    return need(this.focused(), "trailerNow")();
  }

  pauseTimeBox(): ReturnType<TaskManager["pauseTimeBox"]> {
    return need(this.focused(), "pauseTimeBox")();
  }

  resumeTimeBox(): ReturnType<TaskManager["resumeTimeBox"]> {
    return need(this.focused(), "resumeTimeBox")();
  }

  extendTimeBox(minutes?: number): ReturnType<TaskManager["extendTimeBox"]> {
    return need(this.focused(), "extendTimeBox")(minutes);
  }

  /** Closes the focused task (its closing turn); once it is gone, its lane goes and the start view shows. */
  async finish(): Promise<boolean> {
    const l = this.focused();
    const done = await l.finish();
    if (done && this.lanes.get(l.id) === l) await this.laneEnded(l.id);
    return done;
  }

  /** Stops the focused task's turn; the others go on. */
  cancel(): void {
    this.focused().cancel();
  }

  /** Every open task's engine session is gone (the folder moved): each resumes from the notes (Decision 15). */
  async resumeFromNotes(): Promise<void> {
    for (const l of [...this.lanes.values()]) {
      await Promise.resolve()
        .then(() => need(l, "resumeFromNotes")())
        .catch((err: unknown) => console.error("Could not mark a task to resume", err));
    }
  }

  isBusy(): boolean {
    return [...this.lanes.values()].some((l) => l.isBusy()) || (this.spare?.isBusy() ?? false);
  }

  /** Resolves once no lane runs an operation. */
  async idle(): Promise<void> {
    const all = [...this.lanes.values(), ...(this.spare ? [this.spare] : [])];
    await Promise.all(all.map((l) => l.idle?.().catch(() => undefined)));
  }

  view(): Promise<TaskView> {
    return this.focused().view();
  }

  /**
   * Runs `fn` when no task is open (harness-settings spec D4): true when it ran. No lane starts while `fn` runs.
   */
  whenNoTask(fn: () => Promise<void>): Promise<boolean> {
    return this.serial(async () => {
      if (this.lanes.size > 0 || this.isBusy()) return false;
      await fn();
      return true;
    });
  }

  /**
   * Every open task ends without a note: at start (the tasks a quit left open, Decision 16) and after a profile switch.
   * The lanes tasks.json lists are reopened first; any its lanes failed to end are ended in the file.
   */
  async interrupt(): Promise<void> {
    await this.restore();
    await this.interruptAll();
  }

  /** Every lane ends unfinished (engine switch, spec §10; Decision 14), then leaves the board. */
  async interruptAll(): Promise<void> {
    for (const l of [...this.lanes.values()]) {
      await l.interrupt().catch((err: unknown) => console.error("Could not end a task", err));
      await this.laneEnded(l.id);
    }
    await withTasksFile(this.d.file, async () => {
      const f = await this.d.file.load();
      if (!f.current && (f.lanes ?? []).length === 0 && (f.focus ?? null) === null) return;
      await this.d.file.save(interruptedLanes(interrupted(f)));
    });
  }

  /** A lane's task ended (note saved, cancelled): drop it; focus falls back to the start view. */
  async laneEnded(id: string): Promise<void> {
    const l = this.lanes.get(id);
    if (!l) return;
    this.lanes.delete(id);
    await l.close().catch((err: unknown) => console.error("Could not close a lane", err));
    if (this.focusId === id) {
      this.focusId = null;
      await this.writeFocus();
    }
    this.d.changed();
  }

  /** The open tasks' ids, oldest first. Task 8 gives the full summaries. */
  async list(): Promise<{ id: string }[]> {
    return [...this.lanes.keys()].map((id) => ({ id }));
  }

  private idleLane(): LaneHandle {
    if (this.spare) return this.spare;
    const id = this.d.newId();
    // One lane per task id (P1): a bad or repeated id never reaches the map or a file name.
    if (!isLaneId(id) || this.lanes.has(id)) throw new Error("Could not make a task id");
    this.spare = this.d.newLane(id);
    return this.spare;
  }

  /**
   * Runs `fn` on the idle lane, which becomes an open lane with the focus first. Only that step is serialized: two
   * quick starts get two lanes, each running its first turn on its own. A lane left with no task (refused, failed
   * before it began) leaves the board.
   */
  private async begin(fn: (l: LaneHandle) => Promise<void>): Promise<void> {
    const l = await this.serial(async () => {
      const l = this.idleLane();
      this.spare = null;
      this.lanes.set(l.id, l);
      this.focusId = l.id;
      await this.writeFocus();
      this.d.changed();
      return l;
    });
    try {
      await fn(l);
    } finally {
      if (this.lanes.get(l.id) === l && !l.isBusy() && (await l.view().catch(() => null))?.current == null) await this.laneEnded(l.id);
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(fn);
    this.ops = run.catch(() => undefined);
    return run;
  }

  /** Writes `focus` alone, in the write chain every lane's save uses: no lane's change is undone. */
  private writeFocus(): Promise<void> {
    return withTasksFile(this.d.file, async () => {
      const f = await this.d.file.load();
      if ((f.focus ?? null) === this.focusId && "focus" in f) return;
      await this.d.file.save({ ...f, focus: this.focusId });
    });
  }
}

/** Lane `l`'s method `name`, bound; a lane without it can't do that. */
function need<K extends Forwarded>(l: LaneHandle, name: K): NonNullable<LaneHandle[K]> {
  const fn = l[name];
  if (typeof fn !== "function") throw new Error(`This task can't ${name}`);
  return (fn as (...a: unknown[]) => unknown).bind(l) as NonNullable<LaneHandle[K]>;
}
