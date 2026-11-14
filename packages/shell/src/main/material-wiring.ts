import path from "node:path";
import { getEngine } from "@humanharness/engines";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import { type Job, workerRunner } from "@humanharness/material/light";
import type { ConfiguredApp } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { type DataStore, type History, type HistoryTrailer, MAIN_SCOPE } from "@humanharness/workspace";
import { materialOwn, saveAppChange } from "./app-change";
import type { ConfigStore } from "./config";
// Type only: the service and the converters' runner load only for a harness with material (D0).
import type { MaterialService } from "./material";
import { materialItems } from "./material-ipc";
import { MaterialJobs } from "./material-jobs";
import { type MaterialStageDeps, runMaterialStage } from "./material-stage";
import { UsageLog, measuredMaterialCosts, recentUsage } from "./usage-log";

/** What `buildMaterial` reads of the main entry. Getters for what changes after it is built. */
export interface MaterialWiringDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  /** The files the person picks on the window, or null (no window, or cancelled). */
  pickFiles(): Promise<string[] | null>;
  send(channel: PushChannel, value: unknown): void;
  /** Starts the material queue when it can run. */
  kick(): void;
  currentHistory(): Promise<History | null>;
  /** Whether commits are the app's own (board mode or a running job). */
  ownCommits(): boolean;
  trailerNow(): Promise<HistoryTrailer | undefined>;
  /** The main entry's folder: the converter worker is built beside it. */
  here: string;
  stageDeps: MaterialStageDeps;
  trash(file: string): Promise<void>;
  dataStoreFor(base: string): DataStore;
}

/** Loaded only for a harness with material: the service and the converters' runner stay out of every other app (D0). */
export async function buildMaterial(d: MaterialWiringDeps): Promise<MaterialService | null> {
  const harness = d.harness();
  const m = harness.material;
  if (!m) return null;
  const { validConfig, baseOf, scoped, activeScope, kick: kickMaterial } = d;
  const [{ MaterialService }, { fetchLink }] = await Promise.all([import("./material"), import("./material-fetch")]);
  return new MaterialService({
    material: m,
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    scopeOk: async (scope) => (scoped() ? activeScope(scope) : scope === MAIN_SCOPE),
    pickFiles: d.pickFiles,
    fetchLink: (url) => fetchLink(url),
    send: d.send,
    provider: async () => {
      const engineId = (await d.config().load()).engineId;
      return engineId ? getEngine(engineId).provider : "";
    },
    window: async () => {
      const c = await validConfig();
      if (!c) return null;
      const primary = getEngine(c.engineId).limits?.primary;
      const last = recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 50).filter((r) => r.limits?.length).at(-1);
      const w = last?.limits?.find((x) => x.kind === primary) ?? last?.limits?.[0];
      return w && Date.parse(w.resetsAt) > Date.now() ? { kind: w.kind, utilization: w.utilization } : null;
    },
    afterChange: async (scope, what) => {
      kickMaterial();
      const history = await d.currentHistory();
      // Board mode: only this scope's material, never another task's running work (parallel spec §5.3).
      await saveAppChange(history, d.ownCommits(), materialOwn(scope), `Material: ${what}`, await d.trailerNow()).catch((err: unknown) =>
        console.error("Could not record the material change", err),
      );
    },
    // The built converter worker (its own entry beside this file), at most CONVERT_AT_ONCE at a time.
    runner: workerRunner({ entry: path.join(d.here, "material-worker.js") }),
    runStage: (job, prompt, tools, handle, signal, fragments) => runMaterialStage(d.stageDeps, job, prompt, tools, handle, signal, fragments),
    // The stages' costs measured in this base's log (§7): each profile's own.
    measured: async () => {
      const c = await validConfig();
      return c ? measuredMaterialCosts(recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 500)) : undefined;
    },
    kick: kickMaterial,
    trash: d.trash,
    // The links stage's items (§8), from the current base's data store; never throws.
    ...(m.items
      ? {
          items: (scope: string) =>
            materialItems(
              m.items,
              harness.data,
              async () => {
                const c = await validConfig();
                return c ? d.dataStoreFor(baseOf(c)) : null;
              },
              scope,
            ),
        }
      : {}),
  });
}

/**
 * The queue of AI stages over the service (material spec §10): one at a time, started only when `idle` (no turn, task
 * operation, hold, move or quit under way).
 */
export function buildMaterialJobs(svc: MaterialService, idle: () => boolean): MaterialJobs<Job> {
  return new MaterialJobs<Job>({
    idle,
    next: () => svc.nextJob(),
    run: (job, signal) => svc.runJob(job, signal),
  });
}
