import type { ModelProfile } from "@humanharness/engines";
import { type AiStep, aiOutputSchema, STEP_OUTPUT_TOOL } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace, SessionSlot, SlotSendOptions } from "@humanharness/runtime";
import { pauseOutOfQuota, resetOf } from "../gated-turns";
import type { StepValues } from "../tools/pre-steps";
import { plainLine } from "../tools/one-line";
import type { TurnGate } from "../turn-gate";
import { capTokens } from "../usage-log";
import { jobRunTrailer } from "./job-runner";
import { dataSection } from "./step-data";

type Usage = Extract<Event, { type: "usage" }>;

/** The first message's last line (Decision 9). */
export const STEP_END_LINE = "End by calling step_output once with the whole result. Nothing you write besides it is read.";
/** The only error text of a step that could not run: the cause is logged in main, never shown. */
const COULD_NOT_RUN = "Could not run the AI step";
/** The longest problem kept for the retry message and the run's error. */
const PROBLEM_CHARS = 200;

export interface AiStepDeps {
  workspace(): Promise<HarnessWorkspace>;
  /** The step's brief text (its file in the harness folder). */
  readBrief(path: string): Promise<string>;
  /** The model of the step's tier, as a job's (Decision 9). Absent or undefined: the engine's defaults. */
  profileFor?(tier: AiStep["tier"]): Promise<ModelProfile | undefined>;
  /** A job usage line for the run (part 3's, `task: <run>`), as runJob's recordUsage. A failure is logged, never fails the step. */
  recordUsage(e: Usage, meta: { job: string; task: string; scope?: string }): Promise<void>;
  /** The jobs' gate: an out-of-quota turn pauses it, as a job's does. */
  gate: TurnGate;
  now?: () => Date;
}

export type AiStepResult = { ok: true; value: Record<string, unknown>; tokens: number } | { ok: false; error: string; tokens: number; cancelled?: boolean };

/** A setup step lost the race with an abort. */
class Halted extends Error {}

/** A path segment shown as it is only when it is a plain name or an index: a record key the model wrote is not echoed. */
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/** Every property name the output's JSON Schema declares, at any depth: the only names a problem's path may show. */
export function declaredKeys(step: AiStep): Set<string> {
  const keys = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, child] of Object.entries(v)) {
      if (k === "properties" && child && typeof child === "object" && !Array.isArray(child)) for (const name of Object.keys(child)) keys.add(name);
      walk(child);
    }
  };
  walk(aiOutputSchema(step));
  return keys;
}

/** An index as it is; a name only when the schema declares it (a z.record key is the model's own text), else "?". */
const segment = (declared: ReadonlySet<string>) => (p: PropertyKey) =>
  typeof p === "number" ? String(p) : typeof p === "string" && PLAIN_KEY.test(p) && declared.has(p) ? p : "?";

type Issue = { code?: string; path: PropertyKey[]; message: string };
/**
 * The first problem of a zod result, as "path: message" on one plain line. The messages are zod's or the harness's own
 * (they describe the schema); an unrecognized key's message names the model's keys, so it is a fixed text instead.
 */
function firstProblem(issues: readonly Issue[], declared: ReadonlySet<string>): string {
  const i = issues[0];
  if (!i) return "invalid";
  const message = i.code === "unrecognized_keys" ? "unrecognized key" : i.message;
  const at = i.path.length ? `${i.path.map(segment(declared)).join(".")}: ` : "";
  return plainLine(`${at}${message}`, PROBLEM_CHARS) || "invalid";
}

/** The AI step's first message (Decision 9): the brief, then `## Data`, then the closing line. */
export function aiStepMessage(brief: string, data: { name: string; value: unknown }[]): string {
  return `${brief.trim()}\n\n${dataSection(data)}\n\n${STEP_END_LINE}`;
}

/** The retry (Decision 10), in the same session. */
const retryMessage = (problem: string) => `Your turn ended without a valid step_output: ${problem}. Call step_output once with the whole result.`;

/**
 * The AI step's `## Data` parts from the run's values, in the step's `input` order. A missing or failed input is a
 * problem, worded as a tool step's (pre-steps.ts): in a recipe a failed step already failed the run, so the runner
 * only meets one when its own order is broken, and then it runs no AI step.
 */
export function aiStepParts(step: AiStep, values: StepValues): { ok: true; parts: { name: string; value: unknown }[] } | { ok: false; error: string } {
  const parts: { name: string; value: unknown }[] = [];
  for (const name of step.input) {
    const v = values.get(name);
    if (!v) return { ok: false, error: `"${name}" is not available` };
    if (!v.ok) return { ok: false, error: `"${name}" is not available: ${v.tool} failed` };
    parts.push({ name, value: v.value });
  }
  return { ok: true, parts };
}

/**
 * One round of a recipe's AI step (tools spec §7.1, Decisions 9–10): a fresh session on its own `step:<run>:<round>`
 * slot (which reaches `step_output` alone, R1), the brief and `## Data`, and the first valid `step_output`, parsed here
 * with the job's own zod output (R2: the MCP server's schema check is not the trust boundary). A turn without one gets
 * one retry in the same session; an out-of-quota turn gets none and pauses the gate. `signal` cancels the running turn
 * at once ("Cancelled"). The slot is always closed. Every error text is fixed or built from the schema's problem, never
 * the engine's own words.
 */
export async function runAiStep(
  d: AiStepDeps,
  o: { job: string; run: string; round: number; scope: string | null; step: AiStep; data: { name: string; value: unknown }[]; signal?: AbortSignal },
): Promise<AiStepResult> {
  if (o.signal?.aborted) return { ok: false, error: "Cancelled", cancelled: true, tokens: 0 };
  const now = d.now ?? (() => new Date());
  const meta = { job: o.job, task: o.run, ...(o.scope ? { scope: o.scope } : {}) };
  let tokens = 0;
  const recording: Promise<void>[] = [];
  let value: Record<string, unknown> | undefined;
  let problem = "it was not called";
  /** The output's declared names, read on the first invalid output. */
  let declared: Set<string> | undefined;
  // Set by the turns' handlers too: cast so that TypeScript does not narrow it to its first value.
  let end = "done" as "done" | "cancelled" | "out-of-quota" | "error";
  let aborted = false;
  let cancelTurn: (() => void) | null = null;
  let stop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onAbort = () => {
    aborted = true;
    stop();
    cancelTurn?.();
  };
  o.signal?.addEventListener("abort", onAbort);
  /** A setup step raced with an abort: one that hangs (a slot that never opens) can't hold the run. */
  const step = <T>(p: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      p.then(resolve, reject);
      void stopped.then(() => reject(new Halted()));
    });
  let slot: SessionSlot | undefined;

  /** One turn: the first valid step_output is kept; the turn's first problem replaces the last one. */
  async function turn(s: SessionSlot, message: string, options: SlotSendOptions): Promise<void> {
    let first: string | undefined;
    let resetsAt: string | undefined;
    const running = s.send(
      message,
      (e) => {
        if (e.type === "block" && e.name === STEP_OUTPUT_TOOL) {
          if (value) console.error(`Job ${o.job}'s AI step sent more than one output: the first valid one stands`);
          else {
            const parsed = o.step.output.safeParse(e.data);
            if (parsed.success) value = parsed.data as Record<string, unknown>;
            else first ??= firstProblem(parsed.error.issues as Issue[], (declared ??= declaredKeys(o.step)));
          }
        }
        if (e.type === "usage") {
          tokens += capTokens(e);
          recording.push(d.recordUsage(e, meta).catch((err: unknown) => console.error("Could not record a job's usage", err)));
        }
        if (e.type === "limits") resetsAt = resetOf(e.windows) ?? resetsAt;
        if (e.type === "done" && !e.ok && e.error.code === "out-of-quota") {
          pauseOutOfQuota(d.gate, resetsAt, now().getTime());
          if (end === "done") end = "out-of-quota";
        }
        if (e.type === "done" && !e.ok && e.error.code === "cancelled" && end === "done") end = "cancelled";
      },
      options,
    );
    cancelTurn = running.cancel;
    if (aborted) running.cancel();
    await running.done;
    cancelTurn = null;
    if (!value) problem = first ?? "it was not called";
  }

  try {
    const profile = await step(Promise.resolve(d.profileFor?.(o.step.tier)));
    const ws = await step(d.workspace());
    const opening = ws.openSlot({ key: `step:${o.run}:${o.round}`, kind: "step", job: o.job });
    slot = await step(opening).catch((err: unknown) => {
      // Aborted while it opened: it is closed once it does, so its key and sockets are never left behind.
      if (err instanceof Halted) void opening.then((s) => s.close()).catch((e: unknown) => console.error("Could not close an AI step's slot", e));
      throw err;
    });
    const brief = await step(d.readBrief(o.step.ai));
    // No scope access: the step slot reaches no folder (R1). The trailer is the run's, as a job turn's, but a step turn
    // opens no turn window and makes no history commits, so nothing is written under it.
    const options: SlotSendOptions = { ...(profile ? { profile } : {}), trailer: jobRunTrailer(o.run, o.job, o.scope) };
    await turn(slot, aiStepMessage(brief, o.data), options);
    if (!value && end === "done" && !aborted) await turn(slot, retryMessage(problem), options);
  } catch (err) {
    if (!(err instanceof Halted)) {
      console.error(`Job ${o.job}'s AI step could not run`, err);
      end = "error";
    }
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
    await slot?.close().catch((err: unknown) => console.error("Could not close an AI step's slot", err));
  }
  await Promise.all(recording);

  if (aborted || end === "cancelled") return { ok: false, error: "Cancelled", cancelled: true, tokens };
  if (end === "error") return { ok: false, error: COULD_NOT_RUN, tokens };
  if (value) return { ok: true, value, tokens };
  if (end === "out-of-quota") problem = "the engine is out of quota";
  return { ok: false, error: `The AI step gave no valid output: ${problem}`, tokens };
}
