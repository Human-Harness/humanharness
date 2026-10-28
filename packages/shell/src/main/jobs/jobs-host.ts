import { randomUUID } from "node:crypto";
import type { HarnessJob } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, type HarnessWorkspace, type Session, type SessionSlot, runtimeOnSlot } from "@humanharness/runtime";
import type { AppConfig } from "@humanharness/ui/client";
import { APP_SCOPE, ATTENTION_LIMITS, type AttentionStore, MAIN_SCOPE } from "@humanharness/workspace";
import { type Turns, gatedTurns } from "../gated-turns";
import { effectiveCaps, engineHold } from "../parallel-config";
import type { TaskDeps } from "../task-manager";
import { type BeforeStart, TurnGate } from "../turn-gate";
import { UsageLog, type UsageRecord, jobRecord } from "../usage-log";
import { JobLog, type JobRunRecord, type JobTrigger, dedupeKey } from "./job-log";
import { jobMessageFor, runJob } from "./job-runner";
import { JobScheduler, type SchedulerTimer } from "./job-scheduler";

type Usage = Extract<Event, { type: "usage" }>;

/** A job run's slot key (`job:<run>`): a data or material request on it is the run's, never the open task's. */
export const isJobSlot = (key: string): boolean => key.startsWith("job:");

/** A job result's item key: one per job and scope, the last run's (parallel part 3 Task 8). */
export const JOB_RESULT_KEY = "result";

/**
 * Which job origins the shared Attention store shows: `<job>:<scope>` of a declared job (`-`: an app-wide run). The
 * agent can write attention.json; an origin it made up for an undeclared job never shows.
 */
export function jobOriginKnown(jobs: Record<string, HarnessJob>): (id: string) => boolean {
  return (id) => {
    const at = id.indexOf(":");
    return at > 0 && at < id.length - 1 && Object.hasOwn(jobs, id.slice(0, at));
  };
}

/** A needs-you summary as an item's title: cut by code points to the inbox's limit, the whole one in the body when cut. */
function resultText(summary: string, label: string): { title: string; body?: string } {
  const points = [...summary];
  const title = points.slice(0, ATTENTION_LIMITS.titleChars).join("").trim() || label.slice(0, ATTENTION_LIMITS.titleChars).trim() || "Job";
  return points.length > ATTENTION_LIMITS.titleChars ? { title, body: summary.slice(0, ATTENTION_LIMITS.bodyChars) } : { title };
}

/**
 * The base's one shared log of runs (Task 3), reading jobs.jsonl once until the next append: the daily cap and the
 * Jobs section read it on every check and refresh.
 */
export class CachedJobLog extends JobLog {
  private cache: Promise<JobRunRecord[]> | null = null;

  override all(): Promise<JobRunRecord[]> {
    this.cache ??= super.all();
    return this.cache.then((rs) => [...rs]);
  }

  override async append(r: JobRunRecord): Promise<void> {
    try {
      await super.append(r);
    } finally {
      this.cache = null;
    }
  }
}

/** Settings › Jobs for one job, as the scheduler takes them: `off` only when true, a cap only as a whole number ≥ 1. */
export function cleanJobSettings(v: unknown): { off?: boolean; dailyTokens?: number } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const cap = o.dailyTokens;
  // 0 or a fraction would pause an `every` job for good, or count against a cap no run can meet.
  return { ...(o.off === true ? { off: true } : {}), ...(typeof cap === "number" && Number.isSafeInteger(cap) && cap >= 1 ? { dailyTokens: cap } : {}) };
}

export interface JobsHostDeps {
  jobs: Record<string, HarnessJob>;
  /** The harness's actions: a needs-you result may name only these (J3); their labels go in the first message. */
  actions: Record<string, { label: string }>;
  /** The text of the job's brief (its prompt file in the harness folder). */
  readBrief(job: HarnessJob): Promise<string>;
  /** The workspace job slots open in (single mode's, or the board's); throws why a run can't start now. */
  workspace(): Promise<HarnessWorkspace>;
  /** The gate the runs go through, on its `jobs` cap. */
  gate: TurnGate;
  /** The folder every `.harness/` path starts from; null before the app is set up (no run starts). */
  base(): Promise<string | null>;
  /** index.ts's task deps, getters kept: they are read at each run. */
  taskDeps: Pick<TaskDeps, "notes" | "dataContext" | "materialContext" | "profileFor">;
  scoped(): boolean;
  /** The active scopes (scope "each"); ["main"] without scopes. */
  scopes(): Promise<string[]>;
  scopeExists(scope: string): Promise<boolean>;
  /** Settings › Jobs' raw entry for job `id` (cleaned here). Absent: none. */
  settings?(id: string): unknown;
  /** The engine the usage lines name. */
  engine(): Promise<string>;
  /** Appends a usage line to the base's usage.jsonl. Default: UsageLog. */
  usage?(base: string, record: UsageRecord): Promise<void>;
  /** A run was queued or ended (the Jobs section, Task 9). */
  changed?(): void;
  /**
   * Base `base`'s shared Attention store (attention-stores.ts): a needs-you result raises an item there, the next run of
   * that job and scope resolves it. Absent or null: no item.
   */
  attention?(base: string): Promise<Pick<AttentionStore, "raise" | "resolve"> | null>;
  /** A run ended and its item was settled: the Dock badge counts `needsYou()` again. */
  needsYouChanged?(): void;
  report?(message: string): void;
  timer?: SchedulerTimer;
  now?: () => Date;
  maxMs?: number;
}

export type JobsHost = ReturnType<typeof createJobsHost>;

/**
 * The jobs' wiring (part 3): the scheduler's runs go to `runJob` on a `job:<run>` slot of the workspace, through the
 * gate's `jobs` cap; each run logs in its base's one shared jobs.jsonl and its usage in usage.jsonl. Only built for a
 * harness with jobs (D0).
 */
export function createJobsHost(d: JobsHostDeps) {
  const now = d.now ?? (() => new Date());
  const logs = new Map<string, CachedJobLog>();
  const logFor = (base: string): CachedJobLog => {
    let log = logs.get(base);
    if (!log) {
      log = new CachedJobLog(base);
      logs.set(base, log);
    }
    return log;
  };
  /** The runs queued or running, by slot key: a request from that slot is the run's, in its scope. */
  const runs = new Map<string, { id: string; scope: string }>();
  /** Every run under way (from its trigger on, before it knows its base): a stop waits for them. */
  const inFlight = new Set<Promise<unknown>>();
  const appendUsage = d.usage ?? ((base: string, record: UsageRecord) => new UsageLog(base).append(record));

  const firstMessage = (id: string, scope: string | null): Promise<string> =>
    jobMessageFor({
      jobs: d.jobs,
      readBrief: (job) => d.readBrief(job),
      notes: (s) => d.taskDeps.notes(s),
      scoped: d.scoped(),
      ...(d.taskDeps.dataContext ? { dataContext: d.taskDeps.dataContext } : {}),
      ...(d.taskDeps.materialContext ? { materialContext: d.taskDeps.materialContext } : {}),
      actions: d.actions,
    })(id, scope);

  /**
   * A run's item follows its last result: needs-you raises (or updates) `{ kind: "job", id: <job>:<scope> }`, an action
   * leading to the declared action it names; any other result resolves it. Never throws: the run is logged either way.
   */
  const settle = async (base: string, r: JobRunRecord): Promise<void> => {
    const origin = { kind: "job" as const, id: dedupeKey(r.job, r.scope) };
    try {
      const store = (await d.attention?.(base)) ?? null;
      if (store && r.status === "needs-you") {
        const label = Object.hasOwn(d.jobs, r.job) ? d.jobs[r.job].label : r.job;
        // J3 again here: the action is the runner's checked one, and still only a declared action becomes a target.
        const action = r.action !== undefined && Object.hasOwn(d.actions, r.action) ? r.action : undefined;
        await store.raise(origin, {
          key: JOB_RESULT_KEY,
          severity: "action",
          ...resultText(r.summary, label),
          ...(action ? { target: { action, vars: r.scope ? { scope: r.scope } : {} } } : {}),
        });
      } else if (store) await store.resolve(origin, JOB_RESULT_KEY);
    } catch (err) {
      (d.report ?? console.log)(`Job ${r.job}: could not update the Attention inbox: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      d.needsYouChanged?.();
    } catch (err) {
      (d.report ?? console.log)(`Job ${r.job}: could not update the badge: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Async: a throw is a rejected run, so the scheduler's dedupe key is always freed.
  const run = (id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal: AbortSignal): Promise<JobRunRecord | null> => {
    const p = runOnce(id, job, scope, trigger, signal);
    const settled = p.catch(() => undefined);
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));
    return p;
  };

  const runOnce = async (id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal: AbortSignal): Promise<JobRunRecord | null> => {
    // The base when the run is taken: its log and usage lines stay there even if the folder or profile changes meanwhile.
    const base = await d.base();
    if (!base) {
      (d.report ?? console.log)(`Job ${id}: the app is not set up, ${trigger} skipped`);
      return null;
    }
    const runId = randomUUID();
    const key = `job:${runId}`;
    runs.set(key, { id: runId, scope: scope ?? (d.scoped() ? APP_SCOPE : MAIN_SCOPE) });
    try {
      const record = await runJob(
        {
          workspace: () => d.workspace(),
          gate: d.gate,
          log: logFor(base),
          firstMessage,
          profileFor: async (j) => d.taskDeps.profileFor?.(undefined, undefined, j.tier),
          recordUsage: async (e: Usage, meta) => {
            const usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, cacheWriteTokens: e.cacheWriteTokens, ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}) };
            await appendUsage(base, jobRecord({ engine: await d.engine(), ...meta, usage }, now().toISOString()));
          },
          actions: d.actions,
          now,
          newId: () => runId,
          // Queued for one folder or profile, let in after a switch: dropped, never run against the new one.
          stillValid: async () => (await d.base()) === base,
          ...(d.maxMs !== undefined ? { maxMs: d.maxMs } : {}),
        },
        id,
        job,
        scope,
        trigger,
        signal,
      );
      if (record) await settle(base, record);
      return record;
    } finally {
      runs.delete(key);
    }
  };

  const scheduler = new JobScheduler({
    jobs: d.jobs,
    log: {
      tokensToday: async (job, at) => {
        const base = await d.base();
        return base ? logFor(base).tokensToday(job, at) : 0;
      },
    },
    run,
    scopes: () => d.scopes(),
    scopeExists: (s) => d.scopeExists(s),
    settings: (id) => cleanJobSettings(d.settings?.(id)),
    ...(d.timer ? { timer: d.timer } : {}),
    now,
    ...(d.report ? { report: d.report } : {}),
    changed: () => d.changed?.(),
  });

  return {
    scheduler,
    /** After setup, once per app start (Decision 7): `start` runs and the `every` timers. Later calls do nothing. */
    appReady: () => scheduler.appReady(),
    /** "Run now" (J4; the window's IPC in Task 9). */
    runManual: (id: string, scope?: string) => scheduler.manual(id, scope),
    /** A task closed with its note saved (TaskDeps.taskClosed, Decision 6). */
    taskClosed: (t: { id: string; action?: string; scope: string }) => scheduler.taskClosed(t),
    /** Engine switch, folder change (Decision 11): runs cancelled, timers kept. */
    cancelRuns: () => scheduler.cancelRuns(),
    /**
     * Cancels the runs and resolves once each has ended and logged ("Cancelled"), before their workspace closes (a
     * profile switch, a folder move, a plugin change): none is cut off by its slot closing, none writes after.
     */
    async cancelAndSettle(): Promise<void> {
      scheduler.cancelRuns();
      await Promise.all([...inFlight]);
    },
    /** Quit (Decision 11): runs cancelled, timers cleared, nothing starts again. */
    stopAll: () => scheduler.stopAll(),
    /** The run whose slot is `key` (a data or material request's task, P3); null for any other slot. */
    runningOf: (key: string): { id: string; scope: string } | null => runs.get(key) ?? null,
    /** A run is queued or running: an app change commits only its own files, never a run's work. */
    running: (): boolean => runs.size > 0,
    /** The base's shared log (the Jobs section, Task 9). */
    log: logFor,
    /** The declared jobs' scopes whose last run needs the person, in the current base (the Dock badge); 0 before setup. */
    needsYou: async (): Promise<number> => {
      const base = await d.base();
      if (!base) return 0;
      return [...(await logFor(base).lastRuns()).values()].filter((r) => r.status === "needs-you" && Object.hasOwn(d.jobs, r.job)).length;
    },
  };
}

/**
 * `single` mode's gate (Decision 12): one task turn at a time, as today, and the jobs' cap beside it. An engine held at
 * one session counts tasks and jobs together (one turn in all).
 */
export function singleGate(engineId: string | undefined, person: AppConfig["parallel"]): TurnGate {
  const hold = engineHold(engineId);
  return new TurnGate(singleCaps(engineId, person), { hold });
}

/** `single` mode's caps for an engine: `tasks` always 1, the person's (or 1) `jobs`. */
export function singleCaps(engineId: string | undefined, person: AppConfig["parallel"]): { tasks: number; jobs: number } {
  return { ...effectiveCaps({ tasks: 1, jobs: 1 }, person, engineHold(engineId)), tasks: 1 };
}

/**
 * `single` mode on an engine held at one session: before a job's turn the task's idle `"main"` process sleeps (it
 * keeps its session; its next turn reconnects). Job slots close after their run, so a task's turn needs nothing.
 * Null for an engine that runs two at once.
 */
export function singleBeforeStart(engineId: string | undefined, main: () => Promise<SessionSlot | null>): BeforeStart | null {
  if (!engineHold(engineId).singleSession) return null;
  return async ({ cap }) => {
    if (cap !== "jobs") return;
    await (await main())?.sleep();
  };
}

/**
 * `single` mode's task turns through the gate's `tasks` cap: a task turn and job turns are counted apart. The plain
 * task view has no Resume, so a task turn lifts an out-of-quota pause (as today, the task runs and meets the engine's
 * answer itself); the jobs wait for it.
 */
export function singleTurns(gate: TurnGate, inner: Turns, emit: (e: Event) => void): Turns {
  const gated = gatedTurns("main", gate, inner, { cap: "tasks", emit });
  return {
    send(message, options) {
      // Every task turn, not only the person's message: the closing note, a checkpoint or the wrap-up held here would
      // leave the task waiting for a Resume the plain view doesn't have. At worst it runs into the same wall, as today.
      if (gate.paused()?.reason === "out-of-quota") gate.resume();
      return gated.send(message, options);
    },
    isBusy: () => gated.isBusy(),
    cancel: () => gated.cancel(),
  };
}

/**
 * `single` mode's runtime (Decision 12): the workspace's `"main"` slot in `HarnessRuntime`'s shape, as `createRuntime`
 * builds it, with the job slots beside it. An AGENTS.md rewrite refused because a job runs throws, so the settings stay
 * stale until the next gap (as in board mode). `slot` is kept for the engine-hold sleep before a job.
 */
export async function openSingleRuntime(ws: HarnessWorkspace, o: { onSession?: (s: Session) => void }): Promise<{ runtime: HarnessRuntime; slot: SessionSlot }> {
  let slot: SessionSlot;
  try {
    slot = await ws.openSlot({ key: "main", ...(o.onSession ? { onSession: o.onSession } : {}) });
  } catch (err) {
    await ws.close().catch(() => {});
    throw err;
  }
  const rt = runtimeOnSlot(ws, slot);
  return {
    slot,
    runtime: {
      ...rt,
      refreshInstructions: async () => {
        const wrote = await ws.refreshInstructions();
        if (!wrote && ws.anyRunning()) throw new Error("A job is running: AGENTS.md waits for a gap");
        return wrote;
      },
    },
  };
}
