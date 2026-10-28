import { z } from "zod";

/** The most turns of one kind the person can let run at once (Settings › General, parallel spec §7). */
export const PARALLEL_MAX = 8;

/** `parallel` (spec §3): the harness's suggested caps on running turns; each defaults to 1. */
export const parallelSchema = z.object({
  tasks: z.int().min(1).max(PARALLEL_MAX).default(1),
  jobs: z.int().min(1).max(PARALLEL_MAX).default(1),
});
export type ParallelCaps = z.output<typeof parallelSchema>;

/**
 * Several turns may run at once in this harness's folder: it declares `parallel` (part 3 adds `jobs`). False keeps
 * today's single runtime, single task and whole-folder history (D7).
 */
export function isConcurrent(harness: { parallel?: ParallelCaps }): boolean {
  return harness.parallel !== undefined;
}

/** The manifest's suggested caps; { tasks: 1, jobs: 1 } without `parallel`. */
export function parallelCaps(harness: { parallel?: ParallelCaps }): ParallelCaps {
  return harness.parallel ?? { tasks: 1, jobs: 1 };
}

/** Permissions a job may ask for (spec §8): only ever narrower than the harness's. */
export interface PermissionsOverride {
  edit?: "folder" | "none";
  exec?: boolean;
  web?: boolean;
}

/** The stricter of each field: an override can turn something off, never on. Always a new object. */
export function narrowPermissions(
  base: { edit: "folder" | "none"; exec: boolean; web: boolean },
  override: PermissionsOverride | undefined,
): { edit: "folder" | "none"; exec: boolean; web: boolean } {
  if (!override) return { ...base };
  return {
    edit: base.edit === "none" || override.edit === "none" ? "none" : "folder",
    exec: base.exec && override.exec !== false,
    web: base.web && override.web !== false,
  };
}
