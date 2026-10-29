import type { ParallelCaps } from "@humanharness/harness-sdk";
import type { EngineHold } from "./parallel-config";

export type Cap = keyof ParallelCaps;

const CAPS = ["tasks", "jobs"] as const;

/** A queued turn taken out before it started (cancel, engine switch, quit). */
export class Dropped extends Error {
  constructor() {
    super("The queued turn was cancelled");
  }
}

/** Why the queues wait (spec §7 "Out of quota"). */
export interface Pause {
  reason: "out-of-quota" | "folder-move";
  /** When the engine said its window resets, if it did. */
  resetsAt?: string;
}

/** Runs before a turn starts on an engine held at one session (the board puts idle lanes to sleep). */
export type BeforeStart = (turn: { cap: Cap; id: string }) => Promise<void>;

interface Waiter {
  cap: Cap;
  id: string;
  text?: string;
  at: number;
  seq: number;
  start: (release: () => void) => void;
  fail: (err: Error) => void;
}

/** setTimeout's longest delay; a longer one fires at once. */
const MAX_DELAY = 2 ** 31 - 1;

/**
 * The caps on running turns and their FIFO queues (parallel spec §7). `acquire` resolves with a release function when
 * the turn may run; `tryAcquire` takes a free slot without an await when nothing waits. Every change is synchronous,
 * then listeners are told. A release frees its slot once, however often it is called.
 *
 * An engine held at one session (`EngineHold.singleSession`) runs one turn in all, tasks and jobs counted together and
 * taken in arrival order. Before each such turn starts, `beforeStart` runs with the slot already taken, so another
 * lane's process can be put to sleep before this one's starts. The slot stays taken until the hook settles, even when
 * the turn is dropped meanwhile, so two hooks never run at once. A hook that fails frees the slot and rejects the turn
 * with its error.
 */
export class TurnGate {
  private readonly runningCount: Record<Cap, number> = { tasks: 0, jobs: 0 };
  private readonly queues: Record<Cap, Waiter[]> = { tasks: [], jobs: [] };
  /** Turns that hold a slot while `beforeStart` runs (and haven't been dropped). */
  private readonly admitting = new Set<Waiter>();
  private pauseState: Pause | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private holds = 0;
  private readonly holdTimers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  private engine: EngineHold;
  private beforeStart: BeforeStart | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private caps: ParallelCaps,
    private readonly o: { now?: () => number; hold?: EngineHold } = {},
  ) {
    this.engine = { ...o.hold };
  }

  acquire(cap: Cap, w: { id: string; text?: string }): Promise<() => void> {
    return new Promise((resolve, reject) => {
      this.queues[cap].push({ cap, id: w.id, text: w.text, at: this.now(), seq: this.seq++, start: resolve, fail: reject });
      this.pump();
      this.changed();
    });
  }

  /**
   * A free slot now, or null: no await, so a free gate at cap 1 starts a turn exactly when today's app would. Never
   * passes a waiting turn, a pause or a hold; null too when `beforeStart` must run first.
   */
  tryAcquire(cap: Cap, _w: { id: string }): (() => void) | null {
    if (!this.canStart(cap)) return null;
    if (this.engine.singleSession ? this.queues.tasks.length + this.queues.jobs.length > 0 || this.beforeStart : this.queues[cap].length > 0)
      return null;
    this.runningCount[cap]++;
    const release = this.releaser(cap);
    this.changed();
    return release;
  }

  /** Takes a queued turn out (spec §7 "cancelled until it starts"); its text, or null when `id` isn't queued. */
  drop(id: string): string | null {
    for (const cap of CAPS) {
      const i = this.queues[cap].findIndex((w) => w.id === id);
      if (i < 0) continue;
      const [w] = this.queues[cap].splice(i, 1);
      w.fail(new Dropped());
      this.changed();
      return w.text ?? "";
    }
    for (const w of this.admitting) {
      if (w.id !== id) continue;
      this.admitting.delete(w);
      w.fail(new Dropped());
      this.changed();
      return w.text ?? "";
    }
    return null;
  }

  dropAll(): void {
    for (const cap of CAPS) for (const w of this.queues[cap].splice(0)) w.fail(new Dropped());
    for (const w of this.admitting) w.fail(new Dropped());
    this.admitting.clear();
    this.changed();
  }

  queued(cap: Cap): { id: string; text?: string; at: number }[] {
    return this.queues[cap].map(({ id, text, at }) => ({ id, text, at }));
  }

  isQueued(id: string): boolean {
    return this.queues.tasks.some((w) => w.id === id) || this.queues.jobs.some((w) => w.id === id);
  }

  running(cap: Cap): number {
    return this.runningCount[cap];
  }

  /**
   * New caps, and the engine's hold when it changed (an engine switch); without `hold` the current one stays. Running
   * turns are never stopped: a lower cap only keeps new turns back until the count is under it.
   */
  setCaps(caps: ParallelCaps, hold?: EngineHold): void {
    this.caps = { ...caps };
    if (hold) this.engine = { ...hold };
    this.pump();
    this.changed();
  }

  /** The board's hook for an engine held at one session; null takes it away. */
  setBeforeStart(fn: BeforeStart | null): void {
    this.beforeStart = fn;
  }

  pause(p: Pause): void {
    this.pauseState = p;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    const at = p.resetsAt ? Date.parse(p.resetsAt) : Number.NaN;
    // A reset too far ahead for a timer stays manual: the person's Resume.
    if (Number.isFinite(at) && at - this.now() <= MAX_DELAY) this.pauseTimer = setTimeout(() => this.resume(), Math.max(0, at - this.now()));
    this.changed();
  }

  resume(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pauseState = null;
    this.pump();
    this.changed();
  }

  paused(): Pause | null {
    return this.pauseState;
  }

  /** Holds new turns for at most `ms` (spec §10: a pending AGENTS.md rewrite). Returns the early release. */
  hold(ms: number): () => void {
    this.holds++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.holdTimers.delete(timer);
      this.holds--;
      this.pump();
      this.changed();
    };
    const timer = setTimeout(release, ms);
    this.holdTimers.add(timer);
    return release;
  }

  /** Quit or engine switch: clears the pause and hold timers and the listeners, so nothing fires afterwards. */
  dispose(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    for (const t of this.holdTimers) clearTimeout(t);
    this.holdTimers.clear();
    this.listeners.clear();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private canStart(cap: Cap): boolean {
    if (this.pauseState || this.holds > 0) return false;
    if (this.engine.singleSession) return this.runningCount.tasks + this.runningCount.jobs < 1;
    return this.runningCount[cap] < this.caps[cap];
  }

  /** The release for a slot of `cap`: frees it once, then lets the next turn in. */
  private releaser(cap: Cap): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.runningCount[cap]--;
      this.pump();
      this.changed();
    };
  }

  private pump(): void {
    for (;;) {
      const w = this.next();
      if (!w) return;
      this.queues[w.cap].shift();
      this.runningCount[w.cap]++;
      const hook = this.engine.singleSession ? this.beforeStart : null;
      if (!hook) {
        w.start(this.releaser(w.cap));
        continue;
      }
      this.admitting.add(w);
      const release = this.releaser(w.cap);
      void Promise.resolve()
        .then(() => hook({ cap: w.cap, id: w.id }))
        .then(
          () => {
            // Dropped meanwhile: already rejected; its slot frees only now that the hook has settled.
            if (this.admitting.delete(w)) w.start(release);
            else release();
          },
          (err: unknown) => {
            console.error("Could not get ready for the next turn", err);
            if (this.admitting.delete(w)) w.fail(err instanceof Error ? err : new Error(String(err)));
            release();
          },
        );
    }
  }

  /** The next turn that may start: the head of a queue with room; held at one session, the earliest of both heads. */
  private next(): Waiter | null {
    const heads = CAPS.map((cap) => this.queues[cap][0]).filter((w): w is Waiter => w !== undefined && this.canStart(w.cap));
    if (heads.length === 0) return null;
    return this.engine.singleSession ? heads.reduce((a, b) => (b.seq < a.seq ? b : a)) : heads[0];
  }

  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error("A queue listener failed", err);
      }
    }
  }
}
