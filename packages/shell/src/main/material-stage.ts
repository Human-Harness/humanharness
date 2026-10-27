import type { EngineDef, ModelProfile } from "@humanharness/engines";
import type { Job } from "@humanharness/material/light";
import type { SystemTaskOptions, SystemTaskResult } from "@humanharness/runtime";
import { type UsageRecord, materialRecord } from "./usage-log";

export interface MaterialStageDeps {
  /** The set-up app's engine and base; null when it isn't set up (or has no material). */
  setup(): Promise<{ engineId: string; base: string } | null>;
  hasNotice(engineId: string): Promise<boolean>;
  engine(engineId: string): EngineDef;
  /** The engine's CLI; null when it can't be found. */
  command(engine: EngineDef): Promise<{ command: string[]; env: Record<string, string> } | null>;
  /** The stage's model (keyed by the stage's reserved id in Settings › Models). */
  profile(engine: EngineDef, job: Job): Promise<ModelProfile>;
  run(o: Omit<SystemTaskOptions, "launcher" | "entry">): Promise<SystemTaskResult>;
  log(base: string, record: UsageRecord): Promise<void>;
}

/**
 * One AI stage's session (material spec §10): the engine in use, the stage's model, only the `material` server, and
 * one usage line. A stage needs what a turn needs: a set-up app, the engine's notice accepted and its CLI; otherwise it
 * fails (and is not retried on its own). Never throws.
 */
export async function runMaterialStage(
  d: MaterialStageDeps,
  job: Job,
  prompt: string,
  tools: readonly string[],
  handle: (request: unknown) => Promise<unknown>,
  signal: AbortSignal,
): Promise<{ ok: boolean }> {
  try {
    const c = await d.setup();
    if (!c || !(await d.hasNotice(c.engineId))) return { ok: false };
    const engine = d.engine(c.engineId);
    const cmd = await d.command(engine).catch(() => null);
    if (!cmd || signal.aborted) return { ok: false };
    const profile = await d.profile(engine, job);
    const r = await d.run({ engine, command: cmd.command, env: cmd.env, prompt, tools, handle, profile, signal });
    // A stage stopped by closeRuntime runs again later: its line would count it twice.
    if (!signal.aborted) {
      const record = materialRecord({
        engine: engine.id,
        stage: job.stage,
        scope: job.scope,
        ...(job.source ? { source: job.source } : {}),
        profile,
        ok: r.ok,
        ...(r.usage ? { usage: r.usage } : {}),
        ...(r.limits ? { limits: r.limits } : {}),
      });
      await d.log(c.base, record).catch((err: unknown) => console.error("Could not record the material stage", err));
    }
    return { ok: r.ok };
  } catch (err) {
    console.error("A material stage could not run", err);
    return { ok: false };
  }
}
