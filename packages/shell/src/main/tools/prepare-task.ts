import { type ActionLike, PRE_TOKENS_DEFAULT } from "@humanharness/harness-sdk";
import type { ToolCallView } from "@humanharness/runtime";
import type { ContextItem } from "@humanharness/ui/client";
import { type StepRegistry, runPreSteps } from "./pre-steps";
import { preparedSection } from "./prepared-section";
import type { ToolRegistry } from "./tool-registry";

/**
 * An action's pre-steps for a new task (tools spec §6), as TaskDeps.prepare answers them: the app's tools host and
 * `humanharness run` both call this, so the terminal prepares a task exactly as the app does. Electron-free (exported
 * through tool-cli.ts). What differs stays with the caller: the app runs the steps under the task's trailer and shows
 * its pre calls with the first turn; the terminal writes no history and prints its lines.
 */

/** The `pre` usage row's fields, without the engine (each caller knows its own). */
export interface PreRowFields {
  action: string;
  task: string;
  scope?: string;
  steps: number;
  ms: number;
  preparedTokens: number;
  ok: boolean;
}

export interface PrepareTaskDeps {
  registry: StepRegistry & Pick<ToolRegistry, "note">;
  /** The action the task starts (absent: no pre-steps, an empty section). */
  action: ActionLike | undefined;
  /** Whether the harness has scopes: the row names the task's scope only then. */
  scoped: boolean;
  /** Runs the pre-steps; the app runs them under the task's trailer. Absent: just runs them. */
  around?<T>(run: () => Promise<T>): Promise<T>;
  /** The tools' descriptions for the section, asked after the steps ran ({} with tools off). */
  descriptions(): Promise<Record<string, string>>;
  /** Writes the `pre` usage row; never throws (each caller logs its own failure). */
  row(fields: PreRowFields): Promise<void>;
  /** The pre calls the answer shows with the first turn (the app's, filled from the trace as they run). Absent: []. */
  views?: ToolCallView[];
}

/** TaskManager's PrepareAnswer (task-manager.ts), by shape: this module stays out of the task manager's imports. */
export interface PreparedTask {
  text: string;
  items: ContextItem[];
  views: ToolCallView[];
  /** A required pre-step failed: `<tool> failed: <error>` (the registry's text, keys hidden). */
  failed?: string;
}

/** Runs the action's pre-steps and builds the `## Prepared data` section. Throws only on an unexpected error. */
export async function prepareTask(o: { action: string; scope: string; task: string; phase?: string }, d: PrepareTaskDeps): Promise<PreparedTask> {
  const steps = d.action?.pre ?? [];
  const phase = o.phase !== undefined ? { phase: o.phase } : {};
  const views = d.views ?? [];
  // The task's scope as is (`_app` and `main` included), as its agent calls.
  const go = () => runPreSteps({ registry: d.registry, steps, task: o.task, scope: o.scope, ...phase });
  const run = await (d.around ? d.around(go) : go());
  const part = preparedSection(run.results, { descriptions: await d.descriptions(), preTokens: d.action?.preTokens ?? PRE_TOKENS_DEFAULT });
  // After the calls, so each cut joins the group under them; sent even when nothing is left of the section.
  for (const c of part.cuts) await d.registry.note({ tool: c.tool, caller: "pre", task: o.task, ...phase, text: c.text });
  // A refused start sent no section: its row counts no prepared tokens.
  await d.row({
    action: o.action,
    task: o.task,
    ...(d.scoped ? { scope: o.scope } : {}),
    steps: steps.length,
    ms: run.ms,
    preparedTokens: run.requiredFailure ? 0 : part.tokens,
    ok: run.results.every((r) => r.ok),
  });
  // The step's message is the registry's (secrets hidden, P5).
  if (run.requiredFailure) return { text: "", items: [], views, failed: `${run.requiredFailure.tool} failed: ${run.requiredFailure.error}` };
  return { text: part.text, items: part.items, views };
}
