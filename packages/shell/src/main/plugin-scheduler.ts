/**
 * When a plugin's sources sync (plugins spec §4.3, Decisions 11 and 21; threat model B11): each source runs at start
 * and then every TTL, one run at a time, raced against the run limit. Failures back off 1, 2, 4… minutes capped at the
 * TTL, and the third in a row raises one `info` item a success resolves. A `workHoursOnly` source that comes due
 * outside the hours re-checks every minute without running; a Refresh runs anyway. Refreshes that arrive during a run
 * share one follow-up run. After sleep the host calls `resumed()`. `CrashPolicy` says when a crashed backend restarts and
 * when the plugin turns off. Timers only: no Electron, no I/O of its own.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Item bodies and the status's last error (the Attention store caps bodies at the same length). */
const ERROR_CHARS = 500;

export interface SchedulerSource {
  id: string;
  /** Seconds. */
  ttl: number;
  workHoursOnly: boolean;
}
export interface SourceStatus {
  running: boolean;
  lastOk?: string;
  lastError?: string;
  failures: number;
  nextAt?: string;
}
export interface SyncFailingItem {
  key: string;
  severity: "info";
  title: string;
  body: string;
}
export type RefreshResult = { ok: true; writes: number } | { ok: false; error: string };
export interface SchedulerDeps {
  sources: SchedulerSource[];
  inWorkHours(at: Date): boolean;
  /** Runs one sync of `source` in the backend; rejects with the reason. */
  run(source: string): Promise<{ writes: number }>;
  /** Raises the `sync-failing:<source>` item; a rejection (a refused write) is retried on the next failure. */
  raise(item: SyncFailingItem): Promise<void>;
  resolve(key: string): Promise<void>;
  runLimitMs: number;
  /** A run went over the limit: the host reloads the backend window (a crash for CrashPolicy). */
  onTimeout(source: string): void;
  /** A source's status changed. */
  changed?(): void;
  /** The clock, in ms since the epoch (tests); `Date.now` by default. */
  now?(): number;
}

interface SourceState {
  src: SchedulerSource;
  status: SourceStatus;
  timer?: ReturnType<typeof setTimeout>;
  limit?: ReturnType<typeof setTimeout>;
  /** The run in flight; it never rejects. */
  inflight?: Promise<RefreshResult>;
  /** The one follow-up run every refresh arriving during `inflight` shares; cleared when it begins. */
  queued?: Promise<RefreshResult>;
  /** When the timer is due, in ms since the epoch. */
  dueAt?: number;
  /** An item may be open: true at start (one may survive from an earlier session) and after a raise. */
  mayBeRaised: boolean;
  raised: boolean;
}

export class PluginScheduler {
  private readonly states = new Map<string, SourceState>();
  /** Bumped by start and stop: what an older run finds afterwards it leaves alone. */
  private epoch = 0;
  private active = false;
  /** One per attempt in flight, removed when it settles: stop() settles them all, so nothing waits on a run that never ends. */
  private readonly stoppers = new Set<() => void>();

  constructor(private readonly d: SchedulerDeps) {
    for (const src of d.sources) {
      this.states.set(src.id, { src, status: { running: false, failures: 0 }, mayBeRaised: true, raised: false });
    }
  }

  start(): void {
    if (this.active) return;
    this.epoch += 1;
    this.active = true;
    for (const st of this.states.values()) this.schedule(st, 0);
  }

  stop(): void {
    this.epoch += 1;
    this.active = false;
    const stoppers = [...this.stoppers];
    this.stoppers.clear();
    for (const stop of stoppers) stop();
    for (const st of this.states.values()) {
      clearTimeout(st.timer);
      clearTimeout(st.limit);
      st.timer = st.limit = st.inflight = st.queued = st.dueAt = undefined;
      st.status.running = false;
      st.status.nextAt = undefined;
    }
  }

  /** A panel's Refresh or Test connection: runs now, work hours or not; waits for a run in flight first. */
  async refresh(source: string): Promise<RefreshResult> {
    const st = this.states.get(source);
    if (!st) return { ok: false, error: "Unknown source" };
    return this.go(st);
  }

  /**
   * The computer woke up (powerMonitor "resume"): timers may have slept past their time, so every source whose next run
   * has passed runs now. A source with a run in flight, or outside its work hours, behaves as when its timer fires.
   */
  resumed(): void {
    if (!this.active) return;
    const now = this.now();
    for (const st of this.states.values()) {
      if (st.timer !== undefined && st.dueAt !== undefined && st.dueAt <= now) this.schedule(st, 0);
    }
  }

  status(source: string): SourceStatus {
    const st = this.states.get(source);
    return st ? { ...st.status } : { running: false, failures: 0 };
  }

  private go(st: SourceState): Promise<RefreshResult> {
    if (!st.inflight) {
      const p = this.attempt(st, this.epoch);
      st.inflight = p;
      return p;
    }
    if (st.queued) return st.queued;
    const queued: Promise<RefreshResult> = st.inflight.then(() => {
      if (st.queued === queued) st.queued = undefined;
      return this.go(st);
    });
    st.queued = queued;
    return queued;
  }

  private async attempt(st: SourceState, epoch: number): Promise<RefreshResult> {
    const id = st.src.id;
    clearTimeout(st.timer);
    st.timer = undefined;
    st.status.running = true;
    st.status.nextAt = undefined;
    this.notify();
    let timedOut = false;
    const limit = new Promise<never>((_resolve, reject) => {
      st.limit = setTimeout(() => {
        timedOut = true;
        reject(new Error(`The sync took more than ${duration(this.d.runLimitMs)}`));
      }, this.d.runLimitMs);
    });
    let stop!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => (stop = () => reject(new Error("Stopped"))));
    this.stoppers.add(stop);
    let result: RefreshResult;
    try {
      const run = Promise.resolve().then(() => this.d.run(id));
      run.catch(() => {}); // a run abandoned at the limit may still reject
      const { writes } = await Promise.race([run, limit, stopped]);
      result = { ok: true, writes };
    } catch (e) {
      result = { ok: false, error: errorText(e) };
    } finally {
      this.stoppers.delete(stop);
    }
    const current = epoch === this.epoch;
    if (current) {
      clearTimeout(st.limit);
      st.limit = undefined;
    }
    if (st.inflight === undefined || !current) return result;
    st.inflight = undefined;
    st.status.running = false;
    if (timedOut) safely(() => this.d.onTimeout(id));
    if (result.ok) await this.succeeded(st, epoch);
    else await this.failed(st, result.error, epoch);
    if (epoch === this.epoch && this.active && !st.inflight) {
      this.schedule(st, result.ok ? st.src.ttl * 1000 : backoff(st.status.failures, st.src.ttl));
    }
    this.notify();
    return result;
  }

  private async succeeded(st: SourceState, epoch: number): Promise<void> {
    st.status.lastOk = new Date(this.now()).toISOString();
    st.status.lastError = undefined;
    st.status.failures = 0;
    if (!this.active || !st.mayBeRaised) return;
    try {
      await this.d.resolve(failingKey(st.src.id));
      if (epoch === this.epoch) st.mayBeRaised = st.raised = false;
    } catch {
      // Tried again after the next success.
    }
  }

  private async failed(st: SourceState, error: string, epoch: number): Promise<void> {
    st.status.lastError = error;
    st.status.failures += 1;
    if (!this.active || st.raised || st.status.failures < 3) return;
    const id = st.src.id;
    try {
      await this.d.raise({ key: failingKey(id), severity: "info", title: `${id} isn't syncing`, body: error });
      if (epoch === this.epoch) st.raised = st.mayBeRaised = true;
    } catch {
      // Tried again on the next failure.
    }
  }

  private schedule(st: SourceState, delayMs: number): void {
    clearTimeout(st.timer);
    const epoch = this.epoch;
    st.dueAt = this.now() + delayMs;
    st.status.nextAt = new Date(st.dueAt).toISOString();
    st.timer = setTimeout(() => {
      st.timer = st.dueAt = undefined;
      if (epoch !== this.epoch || st.inflight) return;
      if (st.src.workHoursOnly && !this.inWorkHours()) return this.schedule(st, MINUTE);
      void this.go(st);
    }, delayMs);
  }

  /** A broken work-hours check counts as in the hours: it never silences a source for good. */
  private inWorkHours(): boolean {
    try {
      return this.d.inWorkHours(new Date(this.now()));
    } catch (err) {
      console.error("Could not tell the work hours; the sync runs anyway", err);
      return true;
    }
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private notify(): void {
    if (this.d.changed) safely(this.d.changed);
  }
}

/**
 * Restarts of a crashed backend: 1, 2, 4… s capped at 60 s; the 5th crash within an hour turns the plugin off.
 * Only crashes of the last hour count, for both the backoff and the limit.
 */
export class CrashPolicy {
  private crashes: number[] = [];

  /** Records a crash at `now`: when to restart, or turn the plugin off (the 5th within an hour). */
  crashed(now: number): { restartInMs: number } | { turnOff: true } {
    this.crashes = this.crashes.filter((t) => t > now - HOUR);
    this.crashes.push(now);
    if (this.crashes.length >= 5) return { turnOff: true };
    return { restartInMs: Math.min(1000 * 2 ** (this.crashes.length - 1), MINUTE) };
  }

  /** The person turned the plugin on again: a fresh start. */
  reset(): void {
    this.crashes = [];
  }
}

function failingKey(source: string): string {
  return `sync-failing:${source}`;
}

/** 1, 2, 4… minutes after the 1st, 2nd, 3rd… failure in a row, never more than the TTL. */
function backoff(failures: number, ttlSeconds: number): number {
  return Math.min(MINUTE * 2 ** Math.min(Math.max(failures - 1, 0), 20), ttlSeconds * 1000);
}

function duration(ms: number): string {
  if (ms % MINUTE === 0) return ms === MINUTE ? "1 minute" : `${ms / MINUTE} minutes`;
  const s = Math.ceil(ms / 1000);
  return s === 1 ? "1 second" : `${s} seconds`;
}

function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return (text || "The sync failed").slice(0, ERROR_CHARS);
}

function safely(f: () => void): void {
  try {
    f();
  } catch {
    // A listener's error never stops the schedule.
  }
}
