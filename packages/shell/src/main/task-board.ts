import type { ParallelCaps } from "@humanharness/harness-sdk";
import type { TaskView } from "@humanharness/ui/client";
import { APP_SCOPE, isScopeId } from "@humanharness/workspace";
import { type TasksFileStore, withTasksFile } from "./lane-store";
import type { EngineHold } from "./parallel-config";
import type { TaskManager } from "./task-manager";
import { LANES_MAX, type TasksFile, interrupted, interruptedLanes, isLaneId, scopeOfTask } from "./task-store";
import type { TurnGate } from "./turn-gate";

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
  /** The caps and queues every lane's turns go through. Absent (tests): no queue to pause, drop or hook. */
  gate?: Pick<TurnGate, "pause" | "resume" | "paused" | "dropAll" | "dispose" | "setCaps" | "setBeforeStart">;
  /** The engine's hold when the board is made; `engineChanged` gives the next one. */
  hold?: EngineHold;
  /** The harness's scopes: `scoped` false refuses `switchScope`; `exists` checks an id. Absent: any valid id is taken. */
  scopes?: { scoped: boolean; exists?(id: string): Promise<boolean> };
}

/** The idle sleep (spec §4): after `ms` waiting, a lane's engine process goes; its next turn starts one again. */
export interface IdleSleep {
  ms: number;
  timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Puts lane `id`'s ACP adapter to sleep (its session stays, on disk); a no-op for an engine without one (Claude). */
  sleep(id: string): Promise<void>;
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
  private hold: EngineHold;
  private sleepCfg: IdleSleep | null = null;
  private readonly sleepTimers = new Map<string, unknown>();
  /** The board paused the queues for a folder move (and so lifts that pause, never another). */
  private movePaused = false;

  constructor(private readonly d: BoardDeps) {
    this.hold = { ...d.hold };
  }

  /**
   * Reopens the lanes tasks.json lists (after a restart, before `interrupt` ends them). A `current` left by plain mode
   * or an older app becomes a lane, so its chat (moved to the task's own file first, Decision 8) stays with it; past
   * LANES_MAX, or with an id that can't name a lane, it ends unfinished instead.
   */
  restore(): Promise<void> {
    return this.serial(() => this.restoreNow());
  }

  private async restoreNow(): Promise<void> {
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
    if (open) return this.settleAfter(open, open.ask(text, display, scope));
    return this.begin((l) => l.ask(text, display, scope));
  }

  /** Shows task `id` (null: the start view). Only an open task's id is taken (threat model P1). */
  async focus(id: string | null): Promise<void> {
    if (id !== null && (!isLaneId(id) || this.lanes.get(id) === undefined)) throw new Error("Unknown task");
    this.focusId = id;
    await this.writeFocus();
    this.d.changed();
  }

  /** The guided path's next or another action closes this task; the next starts in a new lane (`handOver`). */
  choose(...a: Parameters<TaskManager["choose"]>): ReturnType<TaskManager["choose"]> {
    const l = this.focused();
    return this.settleAfter(l, need(l, "choose")(...a));
  }

  respond(...a: Parameters<TaskManager["respond"]>): ReturnType<TaskManager["respond"]> {
    const l = this.focused();
    const r = need(l, "respond")(...a);
    return { ...r, done: this.settleAfter(l, r.done) };
  }

  chooseMode(...a: Parameters<TaskManager["chooseMode"]>): ReturnType<TaskManager["chooseMode"]> {
    const l = this.focused();
    const r = need(l, "chooseMode")(...a);
    return { ...r, done: this.settleAfter(l, r.done) };
  }

  setPhase(...a: Parameters<TaskManager["setPhase"]>): ReturnType<TaskManager["setPhase"]> {
    const l = this.focused();
    const r = need(l, "setPhase")(...a);
    return { ...r, done: this.settleAfter(l, r.done) };
  }

  /** The open scope (null: none), as the focused lane reads tasks.json; every lane shares it. */
  currentScope(): ReturnType<TaskManager["currentScope"]> {
    return need(this.focused(), "currentScope")();
  }

  /** The focused task's own scope, wherever the open scope is now; at the start view, the open scope's chat. */
  async chatScope(): ReturnType<TaskManager["chatScope"]> {
    const id = this.focusId;
    if (id !== null) {
      const t = (await this.d.file.load()).lanes?.find((l) => l.id === id);
      if (t) return scopeOfTask(t);
    }
    return need(this.focused(), "chatScope")();
  }

  /**
   * Opens scope `id` (null: none) without closing a lane (Decision 5): the focus goes to that scope's newest open task,
   * or the start view. True, as today's switch that wasn't stopped.
   */
  async switchScope(id: string | null): Promise<boolean> {
    if (this.d.scopes?.scoped === false) throw new Error("This harness has no scopes");
    if (id !== null && (!isScopeId(id) || !((await this.d.scopes?.exists?.(id)) ?? true))) throw new Error("Unknown scope");
    await withTasksFile(this.d.file, async () => {
      const f = await this.d.file.load();
      // With none open, a new task runs in `_app`: that is the "scope" whose tasks show.
      const want = id ?? APP_SCOPE;
      const newest = (f.lanes ?? [])
        .filter((t) => this.lanes.has(t.id) && scopeOfTask(t) === want)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
      this.focusId = newest?.id ?? null;
      const { open: _open, ...rest } = f;
      await this.d.file.save({ ...rest, ...(id === null ? {} : { open: id }), focus: this.focusId });
    });
    this.d.changed();
    return true;
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
  interrupt(): Promise<void> {
    return this.serial(async () => {
      await this.restoreNow();
      await this.interruptAllNow();
    });
  }

  /**
   * Every lane ends unfinished (engine switch, spec §10; Decision 14), then leaves the board. The queued turns go
   * first: a running turn's slot, freed as its lane ends, must not start one. No lane starts meanwhile; one asked for
   * then starts after, on the new engine.
   */
  interruptAll(): Promise<void> {
    this.d.gate?.dropAll();
    return this.serial(() => this.interruptAllNow());
  }

  private async interruptAllNow(): Promise<void> {
    this.d.gate?.dropAll();
    for (const l of [...this.lanes.values()]) {
      await l.interrupt().catch((err: unknown) => console.error("Could not end a task", err));
      await this.laneEnded(l.id);
    }
    // The idle lane was made for the old engine (its session, its runtime): the next start gets a new one.
    const spare = this.spare;
    this.spare = null;
    await spare?.close().catch((err: unknown) => console.error("Could not close a lane", err));
    // Lanes the board no longer holds (their interrupt failed) end in the file; a held one is never ended there.
    await withTasksFile(this.d.file, async () => {
      const f = await this.d.file.load();
      const held = (f.lanes ?? []).filter((t) => this.lanes.has(t.id));
      const gone = (f.lanes ?? []).filter((t) => !this.lanes.has(t.id));
      const focusHeld = typeof f.focus === "string" && this.lanes.has(f.focus);
      if (!f.current && gone.length === 0 && (focusHeld || (f.focus ?? null) === null)) return;
      const ended = interruptedLanes(interrupted({ ...f, lanes: gone }));
      await this.d.file.save({ ...ended, lanes: held, ...("focus" in f ? { focus: focusHeld ? f.focus : null } : {}) });
    });
  }

  /** A lane's task ended (note saved, cancelled): drop it; focus falls back to the start view. */
  async laneEnded(id: string): Promise<void> {
    const l = this.lanes.get(id);
    if (!l) return;
    this.laneActive(id);
    this.lanes.delete(id);
    await l.close().catch((err: unknown) => console.error("Could not close a lane", err));
    if (this.focusId === id) {
      this.focusId = null;
      await this.writeFocus();
    }
    this.d.changed();
  }

  /**
   * The lane-ended hook (the board host calls it on each lane's change): once lane `id` runs nothing and has no task
   * (a close phase, the end of the path, a task handed to another lane), it leaves the board.
   */
  async laneSettled(id: string): Promise<void> {
    const l = this.lanes.get(id);
    if (!l) return;
    if (l.isBusy()) await l.idle?.().catch(() => undefined);
    if (this.lanes.get(id) !== l || l.isBusy()) return;
    if ((await l.view().catch(() => null))?.current == null) await this.laneEnded(id);
  }

  /**
   * A lane's `TaskDeps.successor`: the task that follows one a lane closed starts in a fresh lane, focused, as a new
   * task does (LaneStore never lets a lane save a second task). `start` runs it on that lane. `from`: the lane whose
   * task closed, which leaves the board right after and so doesn't count against LANES_MAX.
   */
  handOver(start: (next: LaneHandle) => Promise<void>, from?: string): Promise<void> {
    return this.begin(start, from);
  }

  /**
   * Folder move (spec §10, Decision 15): each lane's checkpoint, one at a time; then the queues pause until
   * `moveEnded`. The checkpoints are turns through the gate, so they run before the pause, never under it. An earlier
   * pause (out of quota) stays as it is. The lanes then resume from the notes (`resumeFromNotes`), as today's task does.
   */
  async checkpointAllBeforeMove(): Promise<void> {
    for (const l of [...this.lanes.values()]) {
      await Promise.resolve()
        .then(() => need(l, "checkpointBeforeMove")())
        .catch((err: unknown) => console.error("Could not checkpoint a task before the move", err));
    }
    const gate = this.d.gate;
    if (gate && !gate.paused()) {
      gate.pause({ reason: "folder-move" });
      this.movePaused = true;
    }
  }

  /** The move ended (done, refused or failed): the queues go on, unless something else paused them. */
  moveEnded(): void {
    const gate = this.d.gate;
    if (this.movePaused && gate?.paused()?.reason === "folder-move") gate.resume();
    this.movePaused = false;
  }

  /**
   * After an engine switch's `interruptAll`: the old engine's pause goes (its quota isn't the new one's), the caps and
   * hold become the new engine's, and the sleep hook follows the hold.
   */
  engineChanged(caps: ParallelCaps, hold: EngineHold): void {
    this.hold = { ...hold };
    this.d.gate?.resume();
    this.d.gate?.setCaps(caps, this.hold);
    this.syncSleepHook();
  }

  /** Quit (Decision 16): every lane's turn stops and its slot closes; tasks.json stays, the next start ends them. */
  async closeAll(): Promise<void> {
    this.d.gate?.dropAll();
    // No pause or hold timer fires once the app goes.
    this.d.gate?.dispose();
    for (const id of [...this.sleepTimers.keys()]) this.laneActive(id);
    const all = [...this.lanes.values(), ...(this.spare ? [this.spare] : [])];
    this.lanes.clear();
    this.spare = null;
    this.focusId = null;
    for (const l of all) l.cancel();
    for (const l of all) await l.close().catch((err: unknown) => console.error("Could not close a lane", err));
  }

  /**
   * The board host's idle sleep (spec §4). Each Codex lane costs about 0.3 GB while its process lives (spike PT-S3),
   * so a waiting lane's goes after `ms`. On an engine held at one session, every other idle lane's goes before a turn
   * starts (the gate's `beforeStart`).
   */
  setIdleSleep(cfg: IdleSleep): void {
    this.sleepCfg = cfg;
    this.syncSleepHook();
  }

  /** A lane started waiting for the person: arm its sleep timer. */
  laneWaiting(id: string): void {
    const cfg = this.sleepCfg;
    if (!cfg || !this.lanes.has(id)) return;
    this.laneActive(id);
    this.sleepTimers.set(
      id,
      cfg.timer.set(() => {
        this.sleepTimers.delete(id);
        // sleep() holds the lane busy: never one that runs (or is about to).
        const l = this.lanes.get(id);
        if (!l || l.isBusy()) return;
        void cfg.sleep(id).catch((err: unknown) => console.error("Could not put an idle session to sleep", err));
      }, cfg.ms),
    );
  }

  /** A lane runs a turn again (or ended): no sleep pending. */
  laneActive(id: string): void {
    const h = this.sleepTimers.get(id);
    if (h !== undefined) this.sleepCfg?.timer.clear(h);
    this.sleepTimers.delete(id);
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
  private async begin(fn: (l: LaneHandle) => Promise<void>, leaving?: string): Promise<void> {
    let before: string | null = null;
    const l = await this.serial(async () => {
      // tasks.json keeps LANES_MAX lanes: one more would drop an open task from it on the next load.
      const open = this.lanes.size - (leaving !== undefined && this.lanes.has(leaving) ? 1 : 0);
      if (open >= LANES_MAX) throw new Error("Too many open tasks");
      before = this.focusId;
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
      if (this.lanes.get(l.id) === l && !l.isBusy() && (await l.view().catch(() => null))?.current == null) {
        const focused = this.focusId === l.id;
        await this.laneEnded(l.id);
        // A start that left no task gives the focus back to the task shown before, if it is still open.
        if (focused && this.focusId === null && before !== null && this.lanes.has(before)) await this.focus(before);
      }
    }
  }

  /** On an engine held at one session, a turn first puts every other idle lane's process to sleep; otherwise no hook. */
  private syncSleepHook(): void {
    const cfg = this.sleepCfg;
    if (!this.d.gate) return;
    this.d.gate.setBeforeStart(
      cfg && this.hold.singleSession
        ? async ({ id }) => {
            // One at a time; a failure fails the turn: two engine processes must never run at once.
            for (const l of [...this.lanes.values()]) {
              if (l.id === id || l.isBusy()) continue;
              this.laneActive(l.id);
              await cfg.sleep(l.id);
            }
          }
        : null,
    );
  }

  /** `p`, then lane `l` leaves the board if its task ended meanwhile. */
  private async settleAfter<T>(l: LaneHandle, p: Promise<T>): Promise<T> {
    try {
      return await p;
    } finally {
      await this.laneSettled(l.id);
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
