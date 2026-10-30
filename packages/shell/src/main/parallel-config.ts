import { PARALLEL_MAX, type ParallelCaps } from "@humanharness/harness-sdk";
import type { AppConfig, ParallelInfo } from "@humanharness/protocol";

/** What an engine allows at once. `singleSession`: one live engine process in all, jobs included. */
export interface EngineHold {
  singleSession?: boolean;
}

const clamp = (n: unknown, fallback: number) => (typeof n === "number" && Number.isInteger(n) ? Math.min(PARALLEL_MAX, Math.max(1, n)) : fallback);

/** The engines a spike ran two at once: Claude (PT-S1) and Codex (PT-S3). */
const CHECKED_PARALLEL = new Set(["claude", "codex"]);

/**
 * Every other engine is held at one session until a spike checks two of its processes at once. OpenCode is one:
 * spike PT-S5 couldn't run (OpenCode wasn't installed), so it stays unverified, not refused.
 */
export function engineHold(engineId: string | undefined): EngineHold {
  return engineId === undefined || CHECKED_PARALLEL.has(engineId) ? {} : { singleSession: true };
}

/**
 * The caps in force (parallel spec §7): the person's, clamped to 1..8, else the manifest's. An engine held at one
 * session holds tasks and jobs at 1 (the gate must also count them together, and sleep idle lanes).
 */
export function effectiveCaps(suggested: ParallelCaps, person: AppConfig["parallel"], engine: EngineHold = {}): ParallelCaps {
  if (engine.singleSession) return { tasks: 1, jobs: 1 };
  return { tasks: clamp(person?.tasks, suggested.tasks), jobs: clamp(person?.jobs, suggested.jobs) };
}

/**
 * The caps a config change brings (Settings › General): only `tasks` and `jobs`, each a whole number 1..PARALLEL_MAX.
 * A bad entry is dropped, never a reason to refuse the change (like `cleanModels`); nothing valid → undefined.
 */
export function cleanCaps(v: unknown): AppConfig["parallel"] | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= PARALLEL_MAX;
  const out: { tasks?: number; jobs?: number } = {};
  if (ok(o.tasks)) out.tasks = o.tasks;
  if (ok(o.jobs)) out.jobs = o.jobs;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `AppState.parallel`: undefined without `parallel` (D7). */
export function parallelInfo(
  harness: { parallel?: ParallelCaps; inbox?: boolean },
  config: Pick<AppConfig, "parallel" | "notifyWaiting">,
  engine: EngineHold = {},
): ParallelInfo | undefined {
  if (!harness.parallel) return undefined;
  return {
    caps: effectiveCaps(harness.parallel, config.parallel, engine),
    suggested: { ...harness.parallel },
    inbox: harness.inbox !== false,
    notifyWaiting: config.notifyWaiting === true,
    ...(engine.singleSession ? { heldReason: "engine" as const } : {}),
  };
}
