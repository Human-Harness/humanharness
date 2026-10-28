import { PARALLEL_MAX, type ParallelCaps } from "@humanharness/harness-sdk";
import type { AppConfig, ParallelInfo } from "@humanharness/ui/client";

/** What an engine allows at once. `singleSession`: one live engine process in all, jobs included. */
export interface EngineHold {
  singleSession?: boolean;
}

const clamp = (n: unknown, fallback: number) => (typeof n === "number" && Number.isInteger(n) ? Math.min(PARALLEL_MAX, Math.max(1, n)) : fallback);

/**
 * OpenCode is held at one session: spike PT-S5 couldn't check two `opencode acp` processes at once (OpenCode wasn't
 * installed), so it stays unverified, not refused. Claude and Codex ran two at once (PT-S1, PT-S3).
 */
export function engineHold(engineId: string | undefined): EngineHold {
  return engineId === "opencode" ? { singleSession: true } : {};
}

/**
 * The caps in force (parallel spec §7): the person's, clamped to 1..8, else the manifest's. An engine held at one
 * session holds tasks and jobs at 1 (the gate must also count them together, and sleep idle lanes).
 */
export function effectiveCaps(suggested: ParallelCaps, person: AppConfig["parallel"], engine: EngineHold = {}): ParallelCaps {
  if (engine.singleSession) return { tasks: 1, jobs: 1 };
  return { tasks: clamp(person?.tasks, suggested.tasks), jobs: clamp(person?.jobs, suggested.jobs) };
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
