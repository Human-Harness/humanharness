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

/** What the step checks read of an action. */
export type ActionLike = { pre?: PreStep[]; preTokens?: number; phases?: { id: string; expects?: string[] }[] };

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

/** What an `as` was made by: a tool (its tools.json entry) or, in a job recipe, the AI step (its output's JSON Schema; slice 4). */
export type StepSource = { kind: "tool"; tool: string; returns?: Record<string, unknown> } | { kind: "ai"; returns: Record<string, unknown> };

const props = (s: Record<string, unknown> | undefined): Record<string, unknown> =>
  s && typeof s.properties === "object" && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
const required = (s: Record<string, unknown> | undefined): string[] => (Array.isArray(s?.required) ? (s.required as unknown[]).filter((r): r is string => typeof r === "string") : []);

/**
 * The checks of a step list that need tools.json (tools spec §3.3): `input` and `forEach` read results whose maker
 * declares `returns`; a `forEach` result is an array whose items carry the tool's required params not in `args`.
 * `sources` starts with what earlier lists made (slice 4's AI step), and gains each `as` in order. A step whose tool
 * tools.json lacks makes no source: toolProblems reports the missing build.
 */
export function sourceProblems(
  steps: readonly { tool?: string; args?: Record<string, unknown>; input?: string[]; forEach?: string; as?: string }[],
  json: { tools: Record<string, { params: Record<string, unknown>; returns?: Record<string, unknown> }> },
  label: string,
  sources: Map<string, StepSource> = new Map(),
): string[] {
  const out: string[] = [];
  const maker = (src: StepSource) => (src.kind === "tool" ? src.tool : "the AI step");
  steps.forEach((s, i) => {
    const at = `${label}[${i}]`;
    for (const n of s.input ?? []) {
      const src = sources.get(n);
      if (src && !src.returns) out.push(`${at}: input "${n}": ${maker(src)} declares no returns`);
    }
    const src = s.forEach !== undefined ? sources.get(s.forEach) : undefined;
    if (src) {
      if (!src.returns) out.push(`${at}: forEach "${s.forEach}": ${maker(src)} declares no returns`);
      else if (src.returns.type !== "array") out.push(`${at}: forEach "${s.forEach}": ${maker(src)} does not return an array`);
      else if (s.tool !== undefined && Object.hasOwn(json.tools, s.tool)) {
        const items = typeof src.returns.items === "object" && src.returns.items !== null ? (src.returns.items as Record<string, unknown>) : undefined;
        const has = props(items);
        for (const p of required(json.tools[s.tool].params)) {
          if (s.args && Object.hasOwn(s.args, p)) continue;
          if (!Object.hasOwn(has, p)) out.push(`${at}: forEach "${s.forEach}": its items have no "${p}", a required param of ${s.tool}`);
        }
      }
    }
    if (s.as !== undefined && s.tool !== undefined && Object.hasOwn(json.tools, s.tool)) {
      const returns = json.tools[s.tool].returns;
      // forEach makes an array of the tool's results.
      sources.set(s.as, { kind: "tool", tool: s.tool, ...(returns ? { returns: s.forEach !== undefined ? { type: "array", items: returns } : returns } : {}) });
    }
  });
  return out;
}

/** Every pre and expects problem that needs tools.json, as "<action>: …" lines (check's `tool-steps`, main's tools off). */
export function stepProblems(
  h: { actions?: Record<string, ActionLike> },
  json: { tools: Record<string, { agent: "call" | "none"; params: Record<string, unknown>; returns?: Record<string, unknown> }> },
): string[] {
  const out: string[] = [];
  for (const [id, a] of Object.entries(h.actions ?? {})) {
    out.push(...sourceProblems(a.pre ?? [], json, "pre").map((p) => `${id}: ${p}`));
    for (const p of a.phases ?? [])
      for (const t of p.expects ?? []) if (Object.hasOwn(json.tools, t) && json.tools[t].agent !== "call") out.push(`${id}: phase ${p.id}: expects "${t}" is a tool the agent can't call (agent: "none")`);
  }
  return out;
}
