import { type HarnessJob, parseEvery } from "@humanharness/harness-sdk";
import { type JobLog, type JobRunRecord, type JobTrigger, dedupeKey } from "./job-log";

/** setTimeout's longest delay: a longer wait is armed in steps (a longer one would fire at once). */
export const TIMER_MAX_MS = 2_147_483_647;

/** One-shot timers (setTimeout's shape); tests pass a fake. */
export interface SchedulerTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SchedulerDeps {
  /** The harness's jobs. Empty: the scheduler never arms a timer nor runs anything (D0). */
  jobs: Record<string, HarnessJob>;
  /** The base's one shared log: today's tokens for the daily cap. */
  log: Pick<JobLog, "tokensToday">;
  /** Runs one job run (`runJob` bound to its deps); null when it was dropped before it started. */
  run(id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal: AbortSignal): Promise<JobRunRecord | null>;
  /** The active scopes now (scope "each"); ["main"] without scopes. */
  scopes(): Promise<string[]>;
  scopeExists(scope: string): Promise<boolean>;
  /** Off in Settings › Jobs, and the person's daily cap (over the manifest's). */
  settings(id: string): { off?: boolean; dailyTokens?: number };
  timer?: SchedulerTimer;
  now?: () => Date;
  /** Where skips and failures are logged. Absent: the console. */
  report?(message: string): void;
  /** A run was queued or ended: the window's Jobs section is stale. */
  changed(): void;
}

const realTimer: SchedulerTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * The four triggers of the jobs (parallel spec §8): `start` once per app start, `manual` from "Run now", `afterTask` when
 * a task closes with its note saved, `every` on a timer. A job and scope runs once at a time (a trigger meanwhile is
 * skipped and logged); `every` runs stop for the day once the job's tokens today reach its daily cap (J5).
 */
export class JobScheduler {
  /** The runs queued or running, by `dedupeKey`. */
  private readonly active = new Map<string, AbortController>();
  /** Each `every` job's armed timer. */
  private readonly timers = new Map<string, unknown>();
  /** Each `every` job's next run time (ms), while its timer is armed. */
  private readonly dues = new Map<string, number>();
  private started = false;
  private stopped = false;

  constructor(private readonly d: SchedulerDeps) {}

  private get timer(): SchedulerTimer {
    return this.d.timer ?? realTimer;
  }

  private now(): Date {
    return (this.d.now ?? (() => new Date()))();
  }

  private report(message: string): void {
    (this.d.report ?? console.log)(message);
  }

  /**
   * After setup, once per app start (Decision 7): `start` jobs are queued and `every` timers armed. It returns once the
   * start runs are queued, not when they end.
   */
  async appReady(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    for (const [id, job] of Object.entries(this.d.jobs)) {
      const ms = job.on.every ? parseEvery(job.on.every) : null;
      if (ms) this.arm(id, job, this.now().getTime() + ms, ms);
    }
    for (const [id, job] of Object.entries(this.d.jobs)) if (job.on.start) await this.fire(id, job, "start");
  }

  /**
   * "Run now" (`client.jobs.run`, J4): only a declared manual job, only in an existing scope; a scope-"trigger" job needs
   * one. True when at least one run was queued (false when off, unknown or already running).
   */
  async manual(id: string, scope?: string): Promise<boolean> {
    if (this.stopped || !Object.hasOwn(this.d.jobs, id)) return false;
    const job = this.d.jobs[id];
    if (!job.on.manual) return false;
    if (scope !== undefined && !(await this.d.scopeExists(scope))) return false;
    if (job.scope === "trigger" && scope === undefined) return false;
    return (await this.fire(id, job, "manual", scope)) > 0;
  }

  /** A task closed with its note saved (Decision 6): the jobs whose `afterTask` lists its action (or is true). */
  taskClosed(t: { id: string; action?: string; scope: string }): void {
    if (this.stopped) return;
    for (const [id, job] of Object.entries(this.d.jobs)) {
      const after = job.on.afterTask;
      if (after === undefined) continue;
      if (after === true || (t.action !== undefined && after.includes(t.action))) void this.fire(id, job, "afterTask", t.scope);
    }
  }

  /** The job's `every` runs are paused for the rest of the day: its tokens today reached its daily cap. */
  async pausedToday(id: string): Promise<boolean> {
    if (!Object.hasOwn(this.d.jobs, id)) return false;
    const job = this.d.jobs[id];
    if (!job.on.every) return false;
    return this.overCap(id, job);
  }

  /** When `id`'s next `every` run is due; null when no timer is armed (not `every`, before setup, after quit). */
  nextRun(id: string): Date | null {
    const due = this.dues.get(id);
    return due === undefined ? null : new Date(due);
  }

  isActive(id: string, scope: string | null): boolean {
    return this.active.has(dedupeKey(id, scope));
  }

  /** Engine switch (Decision 11): the runs queued or running are cancelled; the timers stay armed. */
  cancelRuns(): void {
    for (const c of this.active.values()) c.abort();
  }

  /** Quit (Decision 11): runs cancelled, timers cleared, and nothing fires again. */
  stopAll(): void {
    this.stopped = true;
    for (const h of this.timers.values()) this.timer.clear(h);
    this.timers.clear();
    this.dues.clear();
    this.cancelRuns();
  }

  private async overCap(id: string, job: HarnessJob): Promise<boolean> {
    const cap = this.d.settings(id).dailyTokens ?? job.dailyTokens ?? 0;
    return (await this.d.log.tokensToday(id, this.now())) >= cap;
  }

  /** Arms `id`'s next `every` run at `due`, in steps of at most TIMER_MAX_MS; when due it fires and arms the next. */
  private arm(id: string, job: HarnessJob, due: number, every: number): void {
    const wait = Math.max(0, due - this.now().getTime());
    const handle = this.timer.set(
      () => {
        if (this.stopped || this.timers.get(id) !== handle) return;
        this.timers.delete(id);
        if (this.now().getTime() < due) return this.arm(id, job, due, every);
        this.arm(id, job, this.now().getTime() + every, every);
        void this.fire(id, job, "every");
      },
      Math.min(wait, TIMER_MAX_MS),
    );
    this.timers.set(id, handle);
    this.dues.set(id, due);
  }

  /** Queues the trigger's runs, one per scope it covers; resolves with how many were queued (not when they end). */
  private async fire(id: string, job: HarnessJob, trigger: JobTrigger, triggerScope?: string): Promise<number> {
    try {
      if (this.d.settings(id).off) return 0;
      if (trigger === "every" && (await this.overCap(id, job))) {
        this.report(`Job ${id}: daily cap reached, every skipped`);
        this.d.changed();
        return 0;
      }
      const scopes: (string | null)[] =
        job.scope === "none" ? [null] : job.scope === "trigger" ? (triggerScope !== undefined ? [triggerScope] : []) : triggerScope !== undefined && trigger === "manual" ? [triggerScope] : await this.d.scopes();
      // A stop may have come while the cap or the scopes were read.
      if (this.stopped) return 0;
      let queued = 0;
      for (const scope of scopes) {
        const key = dedupeKey(id, scope);
        if (this.active.has(key)) {
          this.report(`Job ${key}: already queued or running, ${trigger} skipped`);
          continue;
        }
        const c = new AbortController();
        this.active.set(key, c);
        queued++;
        void this.d
          .run(id, job, scope, trigger, c.signal)
          .catch((err: unknown) => this.report(`Job ${key} failed: ${err instanceof Error ? err.message : String(err)}`))
          .finally(() => {
            if (this.active.get(key) === c) this.active.delete(key);
            this.d.changed();
          });
      }
      if (queued > 0) this.d.changed();
      return queued;
    } catch (err) {
      this.report(`Job ${id}: ${trigger} could not start: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
}
