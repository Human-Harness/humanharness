import { z } from "zod";
import { MAX_AI_CAP, aiStepOf, jobStepsSchema, jobUsesAi } from "./recipes";

/** The shortest `every` interval (parallel spec §3). */
export const EVERY_MIN_MS = 15 * 60_000;
/** The tool a job run ends with (spec §8). Registered only on a job slot's `ui` server: never in `allBlocks` (Decision 1). */
export const JOB_RESULT_TOOL = "job_result";
/** What the agent reads when a job tries to ask the person (spec §8). */
export const JOB_CANNOT_ASK = "A background job cannot ask the person; end with job_result.";
/** What the agent reads when a job tries to save a note (Decision 4). */
export const JOB_NO_NOTE = "A background job saves no note; end with job_result.";
/** A job id: the same shape as an action id. It keys the app config's `jobs` (Settings › Jobs), the jobs log and usage lines; not the models config. */
export const JOB_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** "15m", "2h" → milliseconds; null for anything else. */
export function parseEvery(s: string): number | null {
  const m = /^(\d{1,4})(m|h)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000);
}

/** A job's own permissions: each key may only turn something off (checked against the harness's in `jobProblems`). */
const permissionsOverride = z.strictObject({ edit: z.enum(["folder", "none"]).optional(), exec: z.boolean().optional(), web: z.boolean().optional() });

/** A background job (spec §3): it runs with no chat and no person in the loop. Strict: a typo is refused. */
export const jobSchema = z.strictObject({
  label: z.string().min(1).max(80),
  /** The job's brief: a file in the harness folder. A job declares `prompt` or `steps`. */
  prompt: z.string().min(1).optional(),
  tier: z.enum(["light", "standard", "deep"]).default("light"),
  on: z.strictObject({
    /** Once per app start, after setup. */
    start: z.boolean().optional(),
    /** From the Jobs section's "Run now" (`client.jobs.run`). */
    manual: z.boolean().optional(),
    /** After a task of any action (true) or of the listed actions ends with its note saved. */
    afterTask: z.union([z.literal(true), z.array(z.string()).min(1)]).optional(),
    /** A duration ("30m", "2h"), at least 15 minutes; needs `dailyTokens`. */
    every: z.string().optional(),
  }),
  /** "none": app-wide; "each": once per active scope; "trigger": the scope of the task or the "Run now" that fired it. */
  scope: z.enum(["none", "each", "trigger"]).default("none"),
  /** The most tokens the job's periodic runs spend in a day. */
  dailyTokens: z.int().min(1).optional(),
  permissions: permissionsOverride.optional(),
  /** A recipe (tools spec §7): tool steps, at most one AI step, a post-step. A job declares `prompt` or `steps`. */
  steps: jobStepsSchema.optional(),
  /** The most AI steps one run may run: 1–3, default 1 (tools spec §7.3). Only with an AI step. */
  maxAi: z.int().min(1).max(MAX_AI_CAP).optional(),
  /** The action the inbox offers when a run stops at maxAi. Only with an AI step. */
  onLimit: z.string().max(64).optional(),
});
export type HarnessJob = z.output<typeof jobSchema>;

export const jobsSchema = z.record(z.string().regex(JOB_ID), jobSchema);

/** The `job_result` block (spec §8): ends a run. `action` is kept only when it names a real action (J3). */
export const jobResultSchema = z.object({
  status: z.enum(["ok", "needs-you", "failed"]),
  summary: z.string().min(1).max(300),
  action: z.string().max(64).optional(),
});
export type JobResult = z.output<typeof jobResultSchema>;

/** The harness declares at least one job. False: no part-3 code runs (D0). */
export const hasJobs = (h: { jobs?: Record<string, unknown> }): boolean => !!h.jobs && Object.keys(h.jobs).length > 0;

export interface JobProblem {
  path: (string | number)[];
  message: string;
}

/** Each problem of the manifest's jobs (spec §3 checks), for the manifest's `superRefine`. */
export function jobProblems(h: {
  jobs?: Record<string, HarnessJob>;
  actions?: Record<string, unknown>;
  scopes?: unknown;
  permissions: { edit: "folder" | "none"; exec: boolean; web: boolean };
}): JobProblem[] {
  const out: JobProblem[] = [];
  const isAction = (id: string) => !!h.actions && Object.hasOwn(h.actions, id);
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    const issue = (p: (string | number)[], message: string) => out.push({ path: ["jobs", id, ...p], message });
    if (isAction(id)) issue([], `Job id "${id}" clashes with an action id`);
    if (j.prompt !== undefined && j.steps !== undefined) issue([], "A job declares prompt or steps, not both");
    if (j.prompt === undefined && j.steps === undefined) issue([], "A job declares prompt or steps");
    const triggers = (["start", "manual", "afterTask", "every"] as const).filter((k) => j.on[k] !== undefined && j.on[k] !== false);
    if (triggers.length === 0) issue(["on"], "A job needs at least one trigger");
    if (j.on.every !== undefined) {
      const ms = parseEvery(j.on.every);
      if (ms === null || ms < EVERY_MIN_MS) issue(["on", "every"], 'every must be a duration of 15m or more ("30m", "2h")');
      // Only a job that runs a model spends tokens (Decision 2).
      if (j.dailyTokens === undefined && jobUsesAi(j)) issue(["dailyTokens"], "dailyTokens is required with every");
    }
    if (Array.isArray(j.on.afterTask)) for (const a of j.on.afterTask) if (!isAction(a)) issue(["on", "afterTask"], `afterTask names no action "${a}"`);
    if (j.scope !== "none" && !h.scopes) issue(["scope"], `scope "${j.scope}" needs the harness to declare scopes`);
    if (j.scope === "trigger" && (triggers.some((t) => t === "start" || t === "every") || !triggers.some((t) => t === "afterTask" || t === "manual"))) {
      issue(["scope"], 'scope "trigger" needs afterTask or manual and no other trigger');
    }
    if (!aiStepOf(j)) {
      if (j.maxAi !== undefined) issue(["maxAi"], "maxAi needs an AI step");
      if (j.onLimit !== undefined) issue(["onLimit"], "onLimit needs an AI step");
    } else if (j.onLimit !== undefined && !isAction(j.onLimit)) issue(["onLimit"], `onLimit names no action "${j.onLimit}"`);
    if (j.steps !== undefined && j.permissions !== undefined) issue(["permissions"], "permissions narrow an AI job's session; a recipe's tools use their own uses");
    const p = j.permissions;
    if (p && ((p.edit === "folder" && h.permissions.edit === "none") || (p.exec === true && !h.permissions.exec) || (p.web === true && !h.permissions.web))) {
      issue(["permissions"], "A job's permissions can only narrow the harness's");
    }
  }
  return out;
}
