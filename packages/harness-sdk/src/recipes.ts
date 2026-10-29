import { z } from "zod";
import { type StepProblem, type StepSource, orderProblems, sourceProblems, toolStepSchema } from "./steps";
import { TOOL_ID } from "./tools";

/** The core block an AI step ends with (tools spec §7.1). Registered only on a step slot's `ui` server. */
export const STEP_OUTPUT_TOOL = "step_output";
/** The most AI steps one run may run (D6). */
export const MAX_AI_CAP = 3;
export const RECIPE_STEPS_MAX = 20;

const scalar = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
/** `when` is data, not code (tools spec §7.2): a result exists and isn't empty, or an array item has these field values. */
export const whenSchema = z.strictObject({
  from: z.string().regex(TOOL_ID),
  where: z
    .record(z.string().regex(TOOL_ID), scalar)
    .refine((w) => Object.keys(w).length >= 1 && Object.keys(w).length <= 10, "where takes 1 to 10 fields")
    .optional(),
});
export type When = z.output<typeof whenSchema>;

/** A zod object, checked by shape (the harness's zod may be another copy of the module than ours). */
const isZodObject = (v: unknown): v is z.ZodObject =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { safeParse?: unknown }).safeParse === "function" &&
  (v as { _zod?: { def?: { type?: unknown } } })._zod?.def?.type === "object";

/** The one AI step of a recipe (tools spec §7.1). */
export const aiStepSchema = z.strictObject({
  /** The step's brief: a file in the harness folder. */
  ai: z.string().min(1),
  /** Earlier results, by their `as`, shown under `## Data`. */
  input: z.array(z.string().regex(TOOL_ID)).min(1).max(10),
  /** The result's schema: `step_output`'s input. A zod object. */
  output: z.custom<z.ZodObject>(isZodObject, "output must be a zod object (z.object({ … }))"),
  /** The step runs only when this holds; otherwise it and every step after it are skipped. */
  when: whenSchema.optional(),
  tier: z.enum(["light", "standard", "deep"]).default("light"),
  as: z.string().regex(TOOL_ID).optional(),
});
export type AiStep = z.output<typeof aiStepSchema>;

/** A recipe step: a tool step (slice 3's, without `required`: in a recipe every failure fails the run) or the AI step. */
export const jobStepSchema = z.union([toolStepSchema, aiStepSchema]);
export type JobStep = z.output<typeof jobStepSchema>;
export const jobStepsSchema = z.array(jobStepSchema).min(1).max(RECIPE_STEPS_MAX);

export const isAiStep = (s: JobStep): s is AiStep => Object.hasOwn(s, "ai");

/** What the recipe helpers read of a job: a job declares `prompt` or `steps`. */
type JobLike = { prompt?: string; steps?: JobStep[]; maxAi?: number; onLimit?: string };

/** The recipe's AI step; undefined for a prompt job or a recipe without one. */
export const aiStepOf = (j: JobLike): AiStep | undefined => j.steps?.find(isAiStep);
/** The post-step (Decision 6): the first tool step after the AI step; -1 when there is none. */
export function postStepIndex(j: JobLike): number {
  const steps = j.steps ?? [];
  const at = steps.findIndex(isAiStep);
  if (at < 0) return -1;
  return steps.findIndex((s, i) => i > at && !isAiStep(s));
}
/** The job runs a model: a prompt job always, a recipe only with an AI step (Decision 2). */
export const jobUsesAi = (j: JobLike): boolean => j.steps === undefined || aiStepOf(j) !== undefined;
/** Some job is a recipe. False: no slice-4 code runs (D0). */
export const hasRecipes = (h: { jobs?: Record<string, JobLike> }): boolean => Object.values(h.jobs ?? {}).some((j) => j.steps !== undefined);

/** The manifest-only checks of recipes (tools spec §3.3), for the manifest's `superRefine`. */
export function recipeProblems(h: { tools?: Record<string, string>; jobs?: Record<string, JobLike> }): StepProblem[] {
  const out: StepProblem[] = [];
  const tools = h.tools ?? {};
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    if (!j.steps) continue;
    const at = ["jobs", id, "steps"];
    if (j.steps.filter(isAiStep).length > 1) out.push({ path: at, message: `Job "${id}": a recipe has at most one AI step` });
    // Tool steps' order rules (slice 3); the AI step takes part with its input and as, and has no tool.
    const ordered = j.steps.map((s) => (isAiStep(s) ? { input: s.input, ...(s.as !== undefined ? { as: s.as } : {}) } : s));
    out.push(...orderProblems(ordered, tools, at, "steps").map((p) => ({ ...p, message: `Job "${id}": ${p.message}` })));
    const aiAt = j.steps.findIndex(isAiStep);
    const step = aiAt >= 0 ? (j.steps[aiAt] as AiStep) : undefined;
    if (step?.when) {
      const earlier = new Set(j.steps.slice(0, aiAt).map((s) => s.as).filter((a): a is string => a !== undefined));
      if (!earlier.has(step.when.from)) out.push({ path: [...at, aiAt, "when"], message: `Job "${id}": steps[${aiAt}]: when "${step.when.from}" names no earlier step's as` });
    }
  }
  return out;
}

/** The recipe checks that need tools.json (tools spec §3.3), as `Job "<id>": …` lines; the AI step's output is a source. */
export function recipeSourceProblems(
  h: { jobs?: Record<string, JobLike> },
  json: { tools: Record<string, { params: Record<string, unknown>; returns?: Record<string, unknown> }> },
): string[] {
  const out: string[] = [];
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    if (!j.steps) continue;
    const sources = new Map<string, StepSource>();
    j.steps.forEach((s, i) => {
      if (isAiStep(s)) {
        if (s.as !== undefined) sources.set(s.as, { kind: "ai", returns: z.toJSONSchema(s.output) as Record<string, unknown> });
        return;
      }
      // One step at a time so that the AI step's source sits between them; the label keeps the recipe's index.
      out.push(...sourceProblems([s], json, "steps", sources).map((p) => `Job "${id}": ${p.replace("steps[0]", `steps[${i}]`)}`));
    });
  }
  return out;
}
