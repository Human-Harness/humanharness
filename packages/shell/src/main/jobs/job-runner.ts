import { randomUUID } from "node:crypto";
import type { ModelProfile } from "@humanharness/engines";
import { HIDDEN_CHARS, type HarnessJob, type JobResult, jobResultSchema, JOB_RESULT_TOOL } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace, SessionSlot } from "@humanharness/runtime";
import { APP_SCOPE, MAIN_SCOPE, type Note } from "@humanharness/workspace";
import { pauseOutOfQuota, resetOf } from "../gated-turns";
import { notesIndexFor } from "../notes-index";
import { Dropped, type TurnGate } from "../turn-gate";
import { capTokens } from "../usage-log";
import type { JobLog, JobRunRecord, JobTrigger } from "./job-log";
import { jobFirstMessage } from "./job-prompt";

/** A run's setup step lost the race with its time limit or an abort. */
class Halted extends Error {}

/** A run's time limit (Decision 8): past it the run is cancelled and logged failed, "Timed out". */
export const JOB_RUN_MAX_MS = 15 * 60_000;

type Usage = Extract<Event, { type: "usage" }>;

export interface JobRunDeps {
  workspace(): Promise<HarnessWorkspace>;
  gate: TurnGate;
  /** The base's one shared log (Task 3): its appends are serialized. */
  log: Pick<JobLog, "append">;
  /** The run's first message (`jobMessageFor`); `scope` null for an app-wide run. */
  firstMessage(job: string, scope: string | null): Promise<string>;
  /** The run's model profile, from the job's tier (TaskDeps.profileFor). Absent or undefined: the engine's defaults. */
  profileFor?(job: HarnessJob): Promise<ModelProfile | undefined>;
  /** A usage line `{ phase: "job", job, task: <run> }` (Decision 2). A failure is logged, never fails the run. */
  recordUsage(e: Usage, meta: { job: string; task: string; scope?: string }): Promise<void>;
  /** The harness's actions: a needs-you result may name only these (J3). */
  actions: Record<string, unknown>;
  /**
   * Asked once the gate lets the run in: false gives the slot back and drops the run (null, nothing logged). The host's
   * check that the folder (or profile) the run was queued for is still the app's.
   */
  stillValid?(): Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
  maxMs?: number;
}

const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
/** The longest summary kept: the block's own limit. */
const SUMMARY_CHARS = 300;
/** A summary on one plain line (it is logged and shown): controls and separators as spaces, hidden characters gone. */
const oneLine = (t: string) => {
  const line = t
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim();
  // Cut by code points: a cut never splits a surrogate pair.
  return Array.from(line).slice(0, SUMMARY_CHARS).join("").trim() || "No summary";
};

/**
 * Runs one job run (spec §8) on its own `job:<run>` slot, through the gate's `jobs` cap, and logs it in jobs.jsonl.
 * Returns its record; null when it was dropped (or its signal aborted) before it started, which logs nothing.
 *
 * The run ends with the first `job_result` of its own slot (a later one is ignored and logged); without one it is
 * failed, "No result". It is cancelled past `maxMs` ("Timed out") or when `signal` aborts ("Cancelled"). The slot is
 * always closed and the gate's slot always freed, however the run ends. The engine's permission requests never reach
 * the person: the slot's narrowed policy answers them (Decision 5), and the time limit ends a run that hangs anyway.
 */
export async function runJob(
  d: JobRunDeps,
  id: string,
  job: HarnessJob,
  scope: string | null,
  trigger: JobTrigger,
  signal?: AbortSignal,
): Promise<JobRunRecord | null> {
  if (signal?.aborted) return null;
  const run = (d.newId ?? randomUUID)();
  const key = `job:${run}`;
  const now = d.now ?? (() => new Date());
  let release: (() => void) | null = null;
  let outcome: "done" | "timeout" | "cancelled" | "error" = "done";
  const unqueue = () => d.gate.drop(key);
  signal?.addEventListener("abort", unqueue);
  try {
    release = await d.gate.acquire("jobs", { id: key });
  } catch (err) {
    if (err instanceof Dropped) return null;
    // The gate couldn't get ready (its beforeStart failed): it already gave the slot back.
    console.error(`Job ${id} could not start`, err);
    outcome = "error";
  } finally {
    signal?.removeEventListener("abort", unqueue);
  }
  if (release && d.stillValid && !(await d.stillValid().catch(() => false))) {
    release();
    return null;
  }
  // The run's start, though its line is written at its end (Decision 9: the daily cap's day).
  const startedAt = now().toISOString();
  let result: JobResult | null = null;
  let tokens = 0;
  const recording: Promise<void>[] = [];
  if (release) {
    try {
      if (signal?.aborted) outcome = "cancelled";
      else outcome = await turn();
    } catch (err) {
      outcome = "error";
      console.error(`Job ${id} failed to run`, err);
    } finally {
      release();
    }
  }
  await Promise.all(recording);

  async function turn(): Promise<typeof outcome> {
    let end: typeof outcome = "done";
    let cancelTurn: (() => void) | null = null;
    let stop: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    /** The time limit or an abort: from the first setup step on, a run that hasn't started never starts. */
    const halt = (why: "timeout" | "cancelled") => {
      if (end === "done") end = why;
      stop();
      cancelTurn?.();
    };
    const timer = setTimeout(() => halt("timeout"), d.maxMs ?? JOB_RUN_MAX_MS);
    const onAbort = () => halt("cancelled");
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted) halt("cancelled");
    /** A setup step raced with the halt: one that hangs (a slot that never opens) can't hold the jobs slot. */
    const step = <T>(p: Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        p.then(resolve, reject);
        void stopped.then(() => reject(new Halted()));
      });
    let slot: SessionSlot | undefined;
    try {
      const profile = await step(Promise.resolve(d.profileFor?.(job)));
      const ws = await step(d.workspace());
      const opening = ws.openSlot({ key, kind: "job", ...(job.permissions ? { permissions: job.permissions } : {}) });
      slot = await step(opening).catch((err: unknown) => {
        // Halted while it opened: it is closed once it does, so its key and sockets are never left behind.
        if (err instanceof Halted) void opening.then((s) => s.close()).catch((e: unknown) => console.error("Could not close a job's slot", e));
        throw err;
      });
      const message = await step(d.firstMessage(id, scope));
      if (end !== "done") return end;
      let resetsAt: string | undefined;
      const running = slot.send(
        message,
        (e) => {
          // Only this run's own slot (kind "job") feeds it: a task's slot has no job_result tool and isn't listened to.
          if (e.type === "block" && e.name === JOB_RESULT_TOOL) {
            const parsed = jobResultSchema.safeParse(e.data);
            if (!parsed.success) console.error(`Job ${id} sent a malformed result`);
            else if (result) console.error(`Job ${id} sent more than one result: the first one stands`);
            else result = parsed.data;
          }
          if (e.type === "usage") {
            tokens += capTokens(e);
            recording.push(
              d.recordUsage(e, { job: id, task: run, ...(scope ? { scope } : {}) }).catch((err: unknown) => console.error("Could not record a job's usage", err)),
            );
          }
          if (e.type === "limits") resetsAt = resetOf(e.windows) ?? resetsAt;
          if (e.type === "done" && !e.ok && e.error.code === "out-of-quota") pauseOutOfQuota(d.gate, resetsAt, now().getTime());
          if (e.type === "done" && !e.ok && e.error.code === "cancelled" && end === "done") end = "cancelled";
        },
        { ...(profile ? { profile } : {}), trailer: { task: run, job: id, ...(scope ? { scope } : {}) } },
      );
      cancelTurn = running.cancel;
      await running.done;
    } catch (err) {
      if (!(err instanceof Halted)) throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      await slot?.close().catch((err: unknown) => console.error("Could not close a job's slot", err));
    }
    return end;
  }

  const r = result as JobResult | null;
  const named = r?.status === "needs-you" ? r.action : undefined;
  const action = named !== undefined && Object.hasOwn(d.actions, named) ? named : undefined;
  if (named !== undefined && action === undefined) console.error(`Job ${id} named no action ${JSON.stringify(named)}: dropped`);
  const summary =
    outcome === "timeout" ? "Timed out" : outcome === "cancelled" ? "Cancelled" : outcome === "error" ? "Could not run" : r ? oneLine(r.summary) : "No result";
  const record: JobRunRecord = {
    run,
    job: id,
    scope,
    trigger,
    status: outcome === "done" && r ? r.status : "failed",
    summary,
    ...(outcome === "done" && action ? { action } : {}),
    tokens,
    startedAt,
    endedAt: now().toISOString(),
  };
  await d.log.append(record);
  return record;
}

/**
 * A run's first message, wired as an action's (Task 4): the brief, the notes index of its scope (and the app's, in a
 * scope), the data asked with no action and the material. An app-wide run (scope null) reads the app scope with
 * scopes, `main` without.
 */
export function jobMessageFor(o: {
  jobs: Record<string, HarnessJob>;
  /** The text of the job's brief (its prompt file). */
  readBrief(job: HarnessJob): Promise<string>;
  /** TaskDeps' getters, as index.ts builds them. */
  notes(scope?: string): Promise<Note[]>;
  scoped: boolean;
  dataContext?(scope: string, action: string | undefined): Promise<string>;
  materialContext?(scope: string): Promise<string>;
  actions: Record<string, { label: string }>;
}): (id: string, scope: string | null) => Promise<string> {
  const labels = Object.fromEntries(Object.entries(o.actions).map(([id, a]) => [id, a.label]));
  return async (id, scope) => {
    if (!Object.hasOwn(o.jobs, id)) throw new Error(`No job ${id}`);
    const job = o.jobs[id];
    const where = scope ?? (o.scoped ? APP_SCOPE : MAIN_SCOPE);
    const data = o.dataContext;
    const material = o.materialContext;
    return jobFirstMessage({
      brief: await o.readBrief(job),
      scope: where,
      notesIndex: (s) => notesIndexFor((n) => o.notes(n), o.scoped, s),
      ...(data ? { dataContext: (s: string) => data(s, undefined) } : {}),
      ...(material ? { materialContext: (s: string) => material(s) } : {}),
      actions: labels,
    });
  };
}
