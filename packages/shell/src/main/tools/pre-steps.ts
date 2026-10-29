import type { PreStep, ToolMeta, ToolStep } from "@humanharness/harness-sdk";
import type { ToolAnswer, ToolCall } from "./tool-registry";

/** At most this many items in one forEach (Decision 5). */
export const FOR_EACH_MAX = 100;
/** forEach calls in flight at once. */
const FOR_EACH_PARALLEL = 4;

/** What a step runner needs of the registry. */
export interface StepRegistry {
  call(c: ToolCall): Promise<ToolAnswer>;
  meta(id: string): Promise<ToolMeta | null>;
}

/** One step's outcome, by its `as` (or its tool when it has none). */
export interface StepResult {
  as?: string;
  tool: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  ms: number;
}

/** The pre-step results of one start. */
export interface PreRun {
  results: StepResult[];
  /** A `required` step failed: the task does not start (tools spec §6.5). */
  requiredFailure?: { tool: string; error: string };
  ms: number;
}

/** The call fields every call of a step list shares (caller, task or job run, scope, phase). */
export type StepCallBase = Omit<ToolCall, "tool" | "args" | "inputs">;

/** Earlier results by `as`: a value, or which tool failed to give it. */
export type StepValues = Map<string, { ok: true; value: unknown } | { ok: false; tool: string }>;

type StepOutcome = { ok: true; value: unknown } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An earlier result by name, or why it can't be used. */
function earlier(values: StepValues, name: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const v = values.get(name);
  if (!v) return { ok: false, error: `"${name}" is not available` };
  if (!v.ok) return { ok: false, error: `"${name}" is not available: ${v.tool} failed` };
  return v;
}

/**
 * One tool step (tools spec §6.2, §7.1): its `input` from earlier results, once or once per `forEach` item. Shared by
 * pre-steps and job steps (slice 4), so it assumes nothing about who runs it. A failed call is a result, not a throw, and
 * its message is the registry's (already redacted).
 */
export async function runToolStep(r: StepRegistry, step: ToolStep, values: StepValues, base: StepCallBase): Promise<StepOutcome> {
  const inputs: Record<string, unknown> = {};
  for (const n of step.input ?? []) {
    const v = earlier(values, n);
    if (!v.ok) return v;
    inputs[n] = v.value;
  }
  const one = async (args: Record<string, unknown>): Promise<StepOutcome> => {
    const a = await r.call({ ...base, tool: step.tool, args, ...(step.input ? { inputs } : {}) });
    return a.ok ? { ok: true, value: a.result } : { ok: false, error: a.error };
  };
  if (step.forEach === undefined) return one({ ...(step.args ?? {}) });
  const src = earlier(values, step.forEach);
  if (!src.ok) return src;
  if (!Array.isArray(src.value)) return { ok: false, error: `${step.forEach} is not a list` };
  const items: unknown[] = src.value;
  if (items.length > FOR_EACH_MAX) return { ok: false, error: `forEach over ${items.length} items; at most ${FOR_EACH_MAX}` };
  const meta = await r.meta(step.tool);
  const props = meta?.params?.properties;
  const names = isObject(props) ? Object.keys(props) : [];
  const out: unknown[] = new Array(items.length);
  let failed: string | null = null;
  let next = 0;
  // FOR_EACH_PARALLEL workers take items in order; after a failure no new call starts.
  const worker = async () => {
    while (failed === null && next < items.length) {
      const i = next++;
      const item = items[i];
      const fromItem = isObject(item) ? Object.fromEntries(names.filter((n) => Object.hasOwn(item, n)).map((n) => [n, item[n]])) : {};
      const got = await one({ ...fromItem, ...(step.args ?? {}) });
      if (!got.ok) failed ??= got.error;
      else out[i] = got.value;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FOR_EACH_PARALLEL, items.length) }, worker));
  return failed !== null ? { ok: false, error: failed } : { ok: true, value: out };
}

/** An action's pre-steps (tools spec §6), in order, before its session opens. A failed step is a result. */
export async function runPreSteps(o: { registry: StepRegistry; steps: PreStep[]; task: string; scope: string | null; phase?: string; now?: () => number }): Promise<PreRun> {
  const now = o.now ?? Date.now;
  const start = now();
  const values: StepValues = new Map();
  const results: StepResult[] = [];
  const base: StepCallBase = { caller: "pre", scope: o.scope, task: o.task, ...(o.phase ? { phase: o.phase } : {}) };
  for (const step of o.steps) {
    const t0 = now();
    const got = await runToolStep(o.registry, step, values, base);
    const ms = now() - t0;
    if (step.as !== undefined) values.set(step.as, got.ok ? { ok: true, value: got.value } : { ok: false, tool: step.tool });
    results.push({ ...(step.as !== undefined ? { as: step.as } : {}), tool: step.tool, ok: got.ok, ...(got.ok ? { value: got.value } : { error: got.error }), ms });
    if (!got.ok && step.required) return { results, requiredFailure: { tool: step.tool, error: got.error }, ms: now() - start };
  }
  return { results, ms: now() - start };
}
