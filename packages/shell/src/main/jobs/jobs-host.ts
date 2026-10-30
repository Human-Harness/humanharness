import { randomUUID } from "node:crypto";
import { type HarnessJob, hasJobs } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, type HarnessWorkspace, type Session, type SessionSlot, type TurnScope, runtimeOnSlot } from "@humanharness/runtime";
import type { AppConfig, JobSummary, JobsInfo } from "@humanharness/protocol";
import { APP_SCOPE, ATTENTION_LIMITS, type AttentionStore, type HistoryTrailer, MAIN_SCOPE } from "@humanharness/workspace";
import { type Turns, gatedTurns } from "../gated-turns";
import { cleanJobSettings } from "../config";
import { effectiveCaps, engineHold } from "../parallel-config";
import type { TaskDeps } from "../task-manager";
import { type BeforeStart, TurnGate } from "../turn-gate";
import { UsageLog, type UsageRecord, jobRecord, recipeRecord } from "../usage-log";
import { runAiStep } from "./ai-step";
import { JobLog, type JobRunRecord, type JobTrigger, dedupeKey } from "./job-log";
import { jobMessageFor, jobRunTrailer, runJob } from "./job-runner";
import { JobScheduler, type SchedulerTimer } from "./job-scheduler";
import { type RecipeRunDeps, runRecipe } from "./recipe-runner";

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

/**
 * `t` cut to `max` UTF-16 units, the length the Attention store checks on every read (a longer field drops the item),
 * never splitting a surrogate pair.
 */
function cutUnits(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** A needs-you summary as an item's title: cut to the inbox's limit, the whole one (to the body's limit) in the body when cut. */
function resultText(summary: string, label: string): { title: string; body?: string } {
  const max = ATTENTION_LIMITS.titleChars;
  const title = cutUnits(summary, max).trim() || cutUnits(label, max).trim() || "Job";
  return summary.length > max ? { title, body: cutUnits(summary, ATTENTION_LIMITS.bodyChars) } : { title };
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

/** Settings › Jobs for one job (config.ts cleans the saved config with it too). */
export { cleanJobSettings };

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
  /**
   * A scoped run's linked folders (hatches spec §3.3): its access and its first message's section, as a task's in that
   * scope. Absent without linked folders (D0).
   */
  linked?: { access(scope: string): Promise<TurnScope | undefined>; section(scope: string): Promise<string> };
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
  /**
   * What a recipe's run needs of the tools (tools spec §7): the registry its tool steps call as caller "job", the run's
   * history trailer on those calls, the job's limits, the trace's last call (the run's line) and the AI step's brief.
   * Absent without tools (D0): a job with `steps` then fails its run at its first tool step, as "<tool> failed: Tools are off".
   */
  tools?: {
    registry: RecipeRunDeps["registry"];
    withRunTrailer: RecipeRunDeps["withRunTrailer"];
    limits: RecipeRunDeps["limits"];
    lastCall: RecipeRunDeps["lastCall"];
    /** The AI step's brief (its `ai` file in the harness folder). */
    readAiBrief(path: string): Promise<string>;
  };
}

/** A recipe's registry without tools: every call answers "Tools are off", nothing is noted. */
const offRegistry: RecipeRunDeps["registry"] = {
  call: async () => ({ ok: false, error: "Tools are off" }),
  meta: async () => null,
  note: async () => {},
};

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
  const runs = new Map<string, { id: string; scope: string; job: string; trailer: HistoryTrailer }>();
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
      ...(d.linked ? { linkedContext: d.linked.section } : {}),
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

  /**
   * A recipe run's deps (tools spec §7) in `base`, as a prompt run's: the same gate, log, usage lines, run id and
   * `stillValid`. Without tools every tool step answers "Tools are off" and nothing reaches the trace.
   */
  const recipeDeps = (
    base: string,
    runId: string,
    recordUsage: (e: Usage, meta: { job: string; task: string; scope?: string }) => Promise<void>,
    stillValid: () => Promise<boolean>,
    toolScope: string,
  ): RecipeRunDeps => {
    const tools = d.tools;
    return {
      gate: d.gate,
      log: logFor(base),
      registry: tools?.registry ?? offRegistry,
      withRunTrailer: tools ? (trailer, fn) => tools.withRunTrailer(trailer, fn) : (_trailer, fn) => fn(),
      // Fails closed: a limits read that throws reaches neither the web nor commands.
      limits: (job) => {
        try {
          return tools ? tools.limits(job) : { job, web: false, exec: false };
        } catch (err) {
          console.error(`Job ${job}: could not read its limits`, err);
          return { job, web: false, exec: false };
        }
      },
      lastCall: (run) => (tools ? tools.lastCall(run) : Promise.resolve(null)),
      ai: (o) =>
        runAiStep(
          {
            workspace: () => d.workspace(),
            readBrief: (p) => (tools ? tools.readAiBrief(p) : Promise.reject(new Error("Tools are off"))),
            profileFor: async (tier) => d.taskDeps.profileFor?.(undefined, undefined, tier),
            recordUsage,
            gate: d.gate,
            now,
          },
          o,
        ),
      recordRecipe: async (row) => appendUsage(base, recipeRecord({ engine: await d.engine(), ...row }, now().toISOString())),
      actions: d.actions,
      now,
      newId: () => runId,
      stillValid,
      ...(d.maxMs !== undefined ? { maxMs: d.maxMs } : {}),
      toolScope,
    };
  };

  const runOnce = async (id: string, job: HarnessJob, scope: string | null, trigger: JobTrigger, signal: AbortSignal): Promise<JobRunRecord | null> => {
    // The base when the run is taken: its log and usage lines stay there even if the folder or profile changes meanwhile.
    const base = await d.base();
    if (!base) {
      (d.report ?? console.log)(`Job ${id}: the app is not set up, ${trigger} skipped`);
      return null;
    }
    const runId = randomUUID();
    // A job usage line in this base (part 3's): a prompt run's turns and a recipe's AI step turns alike.
    const recordUsage = async (e: Usage, meta: { job: string; task: string; scope?: string }) => {
      const usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, cacheWriteTokens: e.cacheWriteTokens, ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}) };
      await appendUsage(base, jobRecord({ engine: await d.engine(), ...meta, usage }, now().toISOString()));
    };
    // Queued for one folder or profile, let in after a switch: dropped, never run against the new one.
    const stillValid = async () => (await d.base()) === base;
    const key = `job:${runId}`;
    // The run's history trailer, the same one its own commits carry: a harness tool's data write from this slot commits under it.
    // The scope its tool calls see: an agent call's from this slot and a recipe's tool steps alike (`_app`/`main` app-wide).
    const toolScope = scope ?? (d.scoped() ? APP_SCOPE : MAIN_SCOPE);
    runs.set(key, { id: runId, scope: toolScope, job: id, trailer: jobRunTrailer(runId, id, scope) });
    try {
      // A job is a prompt or a recipe (tools spec §7): a recipe goes to its own runner, a prompt job to part 3's.
      const record = job.steps
        ? await runRecipe(recipeDeps(base, runId, recordUsage, stillValid, toolScope), id, job, scope, trigger, signal)
        : await runJob(
            {
              workspace: () => d.workspace(),
              gate: d.gate,
              log: logFor(base),
              firstMessage,
              profileFor: async (j) => d.taskDeps.profileFor?.(undefined, undefined, j.tier),
              recordUsage,
              actions: d.actions,
              now,
              newId: () => runId,
              stillValid,
              ...(d.linked ? { scopeAccess: d.linked.access } : {}),
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

  /** A job's Settings › Jobs entry, cleaned. */
  const settingsOf = (id: string) => cleanJobSettings(d.settings?.(id));

  return {
    scheduler,
    /** The declared jobs (the IPC checks an id against them, J4). */
    jobs: d.jobs,
    settingsOf,
    scopeExists: (scope: string) => d.scopeExists(scope),
    /** The app is set up (a base to run in): before that a run would be dropped. */
    ready: async (): Promise<boolean> => (await d.base()) !== null,
    /**
     * The Jobs section's rows (parallel spec §9.1): each declared job × its scopes (the active ones; one app-wide row for
     * `scope: "none"`), with its last run in the current base, whether it is queued or running, and why it is paused or
     * when its next `every` run is due. The last run is read as `needsYou()` reads it: archived scopes don't show.
     */
    async summaries(): Promise<JobSummary[]> {
      const base = await d.base();
      const last = base ? await logFor(base).lastRuns() : new Map<string, JobRunRecord>();
      const scopes = base ? await d.scopes() : [];
      const rows: JobSummary[] = [];
      for (const [id, job] of Object.entries(d.jobs)) {
        const settings = settingsOf(id);
        const paused = settings.off ? ("off" as const) : (await scheduler.pausedToday(id)) ? ("daily-cap" as const) : undefined;
        const next = paused ? null : scheduler.nextRun(id);
        for (const scope of job.scope === "none" ? [null] : scopes) {
          const r = last.get(dedupeKey(id, scope));
          rows.push({
            id,
            label: job.label,
            scope,
            ...(r
              ? { last: { status: r.status, summary: r.summary, at: r.endedAt, ...(r.action !== undefined ? { action: r.action } : {}), ...(d.tools ? { run: r.run } : {}) } }
              : {}),
            ...(next ? { next: next.toISOString() } : {}),
            ...(paused ? { paused } : {}),
            manual: job.on.manual === true,
            running: scheduler.isActive(id, scope),
          });
        }
      }
      return rows;
    },
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
    runningOf: (key: string): { id: string; scope: string } | null => {
      const r = runs.get(key);
      return r ? { id: r.id, scope: r.scope } : null;
    },
    /** `runningOf` with the job's id and the run's history trailer (a harness tool's call from that slot). */
    runOf: (key: string): { id: string; scope: string; job: string; trailer: HistoryTrailer } | null => {
      const r = runs.get(key);
      return r ? { ...r, trailer: { ...r.trailer } } : null;
    },
    /** A run is queued or running: an app change commits only its own files, never a run's work. */
    running: (): boolean => runs.size > 0,
    /** The base's shared log (the Jobs section, Task 9). */
    log: logFor,
    /**
     * The declared jobs' scopes whose last run needs the person, in the current base (the Dock badge); 0 before setup.
     * A job turned off in Settings › Jobs and an archived (or gone) scope don't count.
     */
    needsYou: async (): Promise<number> => {
      const base = await d.base();
      if (!base) return 0;
      const waiting = [...(await logFor(base).lastRuns()).values()].filter(
        (r) => r.status === "needs-you" && Object.hasOwn(d.jobs, r.job) && !settingsOf(r.job).off,
      );
      const open = await Promise.all(waiting.map((r) => (r.scope === null ? true : d.scopeExists(r.scope).catch(() => false))));
      return open.filter(Boolean).length;
    },
  };
}

/** `AppState.jobs`: what the window shows of each declared job (never its brief); undefined without jobs (D0). */
export function jobsInfo(h: { jobs?: Record<string, HarnessJob> }): JobsInfo | undefined {
  if (!h.jobs || !hasJobs(h)) return undefined;
  return {
    jobs: Object.entries(h.jobs).map(([id, j]) => ({
      id,
      label: j.label,
      ...(j.on.every !== undefined ? { every: j.on.every } : {}),
      ...(j.dailyTokens !== undefined ? { dailyTokens: j.dailyTokens } : {}),
      manual: j.on.manual === true,
    })),
  };
}

/**
 * A push to the window that reads its value first (`hh:jobsChange`): reads never overlap, so an earlier, slower one
 * can't arrive after a later one, and a call during a read (to its last microtask) gets one more read after it.
 */
export function coalescedSender<T>(read: () => Promise<T>, send: (value: T) => void, report: (err: unknown) => void): () => void {
  let sending = false;
  let stale = false;
  return function push(): void {
    stale = true;
    if (sending) return;
    sending = true;
    void (async () => {
      try {
        while (stale) {
          stale = false;
          try {
            send(await read());
          } catch (err) {
            report(err);
          }
        }
      } finally {
        // In the same microtask as the last `stale` check: a call can't land between them and be lost.
        sending = false;
      }
    })();
  };
}

/** What the jobs channels need of the jobs host. */
export type JobsIpcHost = Pick<JobsHost, "jobs" | "settingsOf" | "scopeExists" | "ready" | "summaries" | "runManual">;

/** An id or scope from the window: a string of 1..200 characters (then looked up, J4). */
function windowString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) throw new Error(`Invalid ${what}`);
  return v;
}

/**
 * The window's jobs channels (parallel spec §9.1, J4): `hh:jobsList` and `hh:jobsRun`. Both refuse without jobs (plain
 * or board mode without them, D0). "Run now" starts only a declared manual job that isn't off, in an existing scope; it
 * answers false when the job and scope are already queued or running, or the app isn't set up yet.
 */
export function jobsIpc(host: () => JobsIpcHost | null) {
  const jobs = (): JobsIpcHost => {
    const h = host();
    if (!h) throw new Error("No jobs");
    return h;
  };
  return {
    list: async (): Promise<JobSummary[]> => jobs().summaries(),
    run: async (rawId: unknown, rawScope: unknown): Promise<boolean> => {
      const h = jobs();
      const id = windowString(rawId, "job");
      if (!Object.hasOwn(h.jobs, id)) throw new Error("Unknown job");
      const job = h.jobs[id];
      if (job.on.manual !== true) throw new Error("This job is not run by hand");
      if (h.settingsOf(id).off) throw new Error("The job is off");
      const scope = rawScope === undefined || rawScope === null ? undefined : windowString(rawScope, "scope");
      if (job.scope === "none" && scope !== undefined) throw new Error("This job has no scope");
      if (job.scope === "trigger" && scope === undefined) throw new Error("This job needs a scope");
      if (scope !== undefined && !(await h.scopeExists(scope))) throw new Error("Unknown scope");
      // Before setup there is no folder: the run would be dropped, so nothing is queued.
      if (!(await h.ready())) return false;
      return h.runManual(id, scope);
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
