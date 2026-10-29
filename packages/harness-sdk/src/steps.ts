import { z } from "zod";
import { TOOL_ID } from "./tools";

/** The cap on a task's prepared data in its first message, in tokens (tools spec §6). */
export const PRE_TOKENS_DEFAULT = 4000;
export const PRE_TOKENS_MIN = 500;
export const PRE_TOKENS_MAX = 20_000;
export const PRE_STEPS_MAX = 10;

/** A tool step (tools spec §6, §7.1): pre-steps of an action; job recipes reuse it without `required` (slice 4). */
export const toolStepSchema = z.strictObject({
  tool: z.string().regex(TOOL_ID),
  /** Fixed arguments; for forEach, they override the item's fields. */
  args: z.record(z.string(), z.unknown()).optional(),
  /** Earlier results, by their `as`, passed to the tool as `ctx.inputs`. */
  input: z.array(z.string().regex(TOOL_ID)).min(1).max(10).optional(),
  /** Runs the tool once per item of an earlier array result; params come from the item's fields of the same name. */
  forEach: z.string().regex(TOOL_ID).optional(),
  /** The result's name: for later steps and for the first message. */
  as: z.string().regex(TOOL_ID).optional(),
});
export const preStepSchema = toolStepSchema.extend({
  /** The task does not start when this step fails (tools spec §6.5). */
  required: z.literal(true).optional(),
});
export type ToolStep = z.output<typeof toolStepSchema>;
export type PreStep = z.output<typeof preStepSchema>;

export const preSchema = z.array(preStepSchema).min(1).max(PRE_STEPS_MAX);
export const preTokensSchema = z.int().min(PRE_TOKENS_MIN).max(PRE_TOKENS_MAX);
export const expectsSchema = z.array(z.string().regex(TOOL_ID)).min(1).max(10);

type ActionLike = { pre?: PreStep[]; preTokens?: number; phases?: { id: string; expects?: string[] }[] };

/** Some action declares pre-steps. False: no slice-3 start code runs (D0). */
export const hasPre = (h: { actions?: Record<string, ActionLike> }): boolean => Object.values(h.actions ?? {}).some((a) => (a.pre?.length ?? 0) > 0);
/** Some phase declares expects. False: no part-end check runs (D0). */
export const hasExpects = (h: { actions?: Record<string, ActionLike> }): boolean =>
  Object.values(h.actions ?? {}).some((a) => (a.phases ?? []).some((p) => (p.expects?.length ?? 0) > 0));

export interface StepProblem {
  path: (string | number)[];
  message: string;
}

/**
 * The order checks of a list of steps (tools spec §3.3), shared by pre-steps and job recipes: each tool is declared,
 * each `as` is unique, `input` and `forEach` name an earlier `as`. `where` is the list's path ("pre", or "steps").
 */
export function orderProblems(steps: readonly { tool?: string; input?: string[]; forEach?: string; as?: string }[], tools: Record<string, unknown>, at: (string | number)[], where: string, earlierExtra: readonly string[] = []): StepProblem[] {
  const out: StepProblem[] = [];
  const seen = new Set<string>(earlierExtra);
  steps.forEach((s, i) => {
    const issue = (message: string) => out.push({ path: [...at, i], message: `${where}[${i}]: ${message}` });
    if (s.tool !== undefined && !Object.hasOwn(tools, s.tool)) issue(`"${s.tool}" is not a tool of this harness`);
    for (const n of s.input ?? []) if (!seen.has(n)) issue(`input "${n}" names no earlier step's as`);
    if (s.forEach !== undefined && !seen.has(s.forEach)) issue(`forEach "${s.forEach}" names no earlier step's as`);
    if (s.as !== undefined) {
      if (seen.has(s.as)) issue(`as "${s.as}" is used twice`);
      seen.add(s.as);
    }
  });
  return out;
}

/** The manifest-only checks of pre-steps and expects (tools spec §3.3), for the manifest's `superRefine`. */
export function preProblems(h: { tools?: Record<string, string>; actions?: Record<string, ActionLike> }): StepProblem[] {
  const tools = h.tools ?? {};
  const out: StepProblem[] = [];
  for (const [id, a] of Object.entries(h.actions ?? {})) {
    if (a.preTokens !== undefined && !a.pre) out.push({ path: ["actions", id, "preTokens"], message: "preTokens needs pre" });
    out.push(...orderProblems(a.pre ?? [], tools, ["actions", id, "pre"], "pre"));
    (a.phases ?? []).forEach((p, i) => {
      for (const t of p.expects ?? []) if (!Object.hasOwn(tools, t)) out.push({ path: ["actions", id, "phases", i, "expects"], message: `expects "${t}" is not a tool of this harness` });
    });
  }
  return out;
}
