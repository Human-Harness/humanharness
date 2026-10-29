import { randomUUID } from "node:crypto";
import { type AiStep, type HarnessJob, type ToolStep, isAiStep, postStepIndex } from "@humanharness/harness-sdk";
import type { HistoryTrailer } from "@humanharness/workspace";
import type { JobLimits } from "../tools/tool-broker";
import { type StepCallBase, type StepOutcome, type StepRegistry, type StepValues, runToolStep } from "../tools/pre-steps";
import { plainLine } from "../tools/one-line";
import { Dropped, type TurnGate } from "../turn-gate";
import { type AiStepResult, type runAiStep, aiStepParts } from "./ai-step";
import type { JobLog, JobRunRecord, JobTrigger } from "./job-log";
import { JOB_RUN_MAX_MS, jobRunTrailer } from "./job-runner";
import { whenHolds } from "./when";

export interface RecipeRunDeps {
  gate: TurnGate;
  /** The base's one shared log (part 3's): a recipe run writes the same record as a prompt run. */
  log: Pick<JobLog, "append">;
  /** The tools' registry (calls as caller "job") and its trace notes. */
  registry: StepRegistry & { note(n: { tool: string; caller: "job"; job: string; run: string; text: string }): Promise<void> };
  /**
   * Runs `fn` with the run's history trailer on its tool calls (the tools host's call trailer, as an agent job call's):
   * a tool's data write is committed under the run.
   */
  withRunTrailer<T>(trailer: HistoryTrailer, fn: () => Promise<T>): Promise<T>;
  /** What a tool called from the job's run may reach (tools-host `jobLimits`). */
  limits(job: string): JobLimits;
  /** The last trace entry's tool and resultSummary for the run (the built summary, Decision 13); null when none. */
  lastCall(run: string): Promise<{ tool: string; resultSummary: string } | null>;
  /** One AI round: `runAiStep` with its deps bound. */
  ai(o: Parameters<typeof runAiStep>[1]): Promise<AiStepResult>;
  /** The `recipe` usage row (`recipeRecord` with the engine). A failure is logged, never fails the run. */
  recordRecipe(row: { job: string; run: string; scope?: string; toolSteps: number; aiSteps: number; ms: number; ok: boolean }): Promise<void>;
  /** The harness's actions: `onLimit` may name only these (J3). */
  actions: Record<string, unknown>;
  /** As runJob's: false once the gate lets the run in gives the slot back and drops the run (null, nothing logged). */
  stillValid?(): Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
  maxMs?: number;
}

/** The longest summary kept (part 3's limit). */
const SUMMARY_CHARS = 300;
/** A summary on one plain line, cut by code points: part 3's rule (job-runner.ts keeps its own copy). */
const oneLine = (t: string) => plainLine(t, SUMMARY_CHARS) || "No summary";
const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const logErr = (what: string) => (err: unknown) => console.error(what, err);

type End = { status: "ok" | "needs-you" | "failed"; summary: string; action?: string };

/**
 * Runs one recipe run (tools spec §7): a job with `steps`. Same gate (`jobs` slot), `stillValid`, time limit and cancel
 * as part 3's `runJob`, and the same `JobRunRecord` in jobs.jsonl; null when it was dropped (or its signal aborted)
 * before it started, which logs nothing.
 *
 * Tool steps run in order as caller "job" with the run's trailer and the job's limits; the AI step runs only when its
 * `when` holds (else it and every step after it are skipped, and the run is ok); the post-step (the first tool step
 * after it) may ask for more AI rounds with `ctx.requestAi`, up to `maxAi` AI steps in all, past which the run needs
 * the person. A failed step fails the run. The time limit or `signal` cancels a running AI step at once; a running tool
 * call ends on its own timeout, and nothing starts after it. Every summary is one plain line of at most 300
 * characters, built from fixed texts and the registry's or the AI step's own (already redacted) messages.
 */
export async function runRecipe(
  d: RecipeRunDeps,
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
  let couldNotRun = false;
  const unqueue = () => d.gate.drop(key);
  signal?.addEventListener("abort", unqueue);
  try {
    release = await d.gate.acquire("jobs", { id: key });
  } catch (err) {
    if (err instanceof Dropped) return null;
    // The gate couldn't get ready (its beforeStart failed): it already gave the slot back.
    console.error(`Job ${id} could not start`, err);
    couldNotRun = true;
  } finally {
    signal?.removeEventListener("abort", unqueue);
  }
  if (release && d.stillValid && !(await d.stillValid().catch(() => false))) {
    release();
    return null;
  }
  const startedAt = now();

  const steps = job.steps ?? [];
  const aiAt = steps.findIndex(isAiStep);
  const postAt = postStepIndex(job);
  const maxAi = job.maxAi ?? 1;
  const values: StepValues = new Map();
  // Set at the walk's start, inside the try that frees the gate's slot (the limits read may throw).
  let base: StepCallBase = { caller: "job", job: id, run, scope };
  const trailer = jobRunTrailer(run, id, scope);
  let toolSteps = 0;
  let aiSteps = 0;
  let tokens = 0;
  let summary: string | undefined;
  /** The post-step's own last summary: the only one a stop at maxAi shows (tools spec §7.3). */
  let postSummary: string | undefined;
  let end: End | null = null;
  let halted: "timeout" | "cancelled" | null = null;

  const ctl = new AbortController();
  const halt = (why: "timeout" | "cancelled") => {
    halted ??= why;
    ctl.abort();
  };
  const timer = setTimeout(() => halt("timeout"), d.maxMs ?? JOB_RUN_MAX_MS);
  const onAbort = () => halt("cancelled");
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) halt("cancelled");

  /** One tool step's call(s); its `as` is set here (runToolStep never sets it), its summary kept. */
  const tool = async (s: ToolStep, post: boolean): Promise<StepOutcome> => {
    toolSteps++;
    const got = await d.withRunTrailer(trailer, () => runToolStep(d.registry, s, values, post ? { ...base, caller: "job", post: true } : base));
    if (got.summary !== undefined) {
      summary = got.summary;
      if (post) postSummary = got.summary;
    }
    if (s.as !== undefined) values.set(s.as, got.ok ? { ok: true, value: got.value } : { ok: false, tool: s.tool });
    return got;
  };
  /** One AI round with its trace note (Decision 16); its tokens count, whatever it gave. */
  const aiRound = async (step: AiStep, data: { name: string; value: unknown }[]): Promise<AiStepResult> => {
    aiSteps++;
    const r = await d.ai({ job: id, run, round: aiSteps, scope, step, data, signal: ctl.signal });
    tokens += r.tokens;
    const text = `AI step: ${r.ok ? "valid output" : "no valid output"} · ${r.tokens.toLocaleString("en-US")} tokens`;
    await d.registry.note({ tool: "step_output", caller: "job", job: id, run, text }).catch(logErr("Could not note an AI step"));
    if (r.ok && step.as !== undefined) values.set(step.as, { ok: true, value: r.value });
    return r;
  };
  /**
   * A failed AI round ends the run. A round cancelled by the run's halt (time limit or cancel) is the halt's; one the
   * engine cancelled on its own (its slot or workspace closed) fails the run "Cancelled", as runJob logs it.
   */
  const aiFailed = (r: Extract<AiStepResult, { ok: false }>): End | null =>
    r.cancelled ? (halted ? null : { status: "failed", summary: "Cancelled" }) : { status: "failed", summary: r.error };

  async function walk(): Promise<void> {
    base = { ...base, limits: d.limits(id) };
    for (let i = 0; i < steps.length && !end && !halted; i++) {
      const s = steps[i]!;
      if (isAiStep(s)) {
        // Decision 12: the AI step and every step after it are skipped.
        if (!whenHolds(s.when, values)) return;
        // Decided before any AI call: a missing or failed input never reaches the data section.
        const parts = aiStepParts(s, values);
        if (!parts.ok) {
          end = { status: "failed", summary: parts.error };
          return;
        }
        const r = await aiRound(s, parts.parts);
        if (!r.ok) end = aiFailed(r);
        continue;
      }
      let got = await tool(s, i === postAt);
      while (got.ok && i === postAt && got.requestAi && !halted) {
        if (aiSteps >= maxAi) {
          const named = job.onLimit;
          const action = named !== undefined && Object.hasOwn(d.actions, named) ? named : undefined;
          if (named !== undefined && action === undefined) console.error(`Job ${id} names no action ${JSON.stringify(named)} as onLimit: dropped`);
          end = { status: "needs-you", summary: `Stopped after ${plural(aiSteps, "AI step")}${postSummary ? ` · ${postSummary}` : ""}`, ...(action ? { action } : {}) };
          return;
        }
        const r = await aiRound(steps[aiAt] as AiStep, [{ name: "request", value: got.requestAi.input }]);
        if (!r.ok) {
          end = aiFailed(r);
          return;
        }
        if (halted) return;
        got = await tool(s, true);
      }
      if (!got.ok) end = { status: "failed", summary: `${s.tool} failed: ${got.error}` };
    }
  }

  if (release) {
    try {
      if (!halted) await walk();
    } catch (err) {
      // A registry or AI double that throws: never its text (it may hold a path or a key).
      console.error(`Job ${id} failed to run`, err);
      couldNotRun = true;
    } finally {
      release();
    }
  }
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);

  let result: End;
  if (couldNotRun) result = { status: "failed", summary: "Could not run" };
  else if (halted) result = { status: "failed", summary: halted === "timeout" ? "Timed out" : "Cancelled" };
  else if (end) result = end;
  else {
    const last = await d.lastCall(run).catch(() => null);
    const built = plural(toolSteps, "step") + (aiSteps ? ` · ${plural(aiSteps, "AI step")}` : "") + (last ? ` · ${last.tool}: ${last.resultSummary}` : "");
    result = { status: "ok", summary: summary ?? built };
  }
  const endedAt = now();
  const record: JobRunRecord = {
    run,
    job: id,
    scope,
    trigger,
    status: result.status,
    summary: oneLine(result.summary),
    ...(result.status === "needs-you" && result.action ? { action: result.action } : {}),
    tokens,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  };
  await d.log.append(record);
  await d
    .recordRecipe({ job: id, run, ...(scope ? { scope } : {}), toolSteps, aiSteps, ms: endedAt.getTime() - startedAt.getTime(), ok: record.status === "ok" })
    .catch(logErr("Could not record a recipe row"));
  return record;
}
