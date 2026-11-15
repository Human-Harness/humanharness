import { promises as fs } from "node:fs";
import { type LoadedHarness, hasLinkedFolders, resolveInHarness } from "@humanharness/harness-sdk";
import type { HarnessWorkspace, SessionSlot } from "@humanharness/runtime";
import type { AppConfig, ConfiguredApp } from "@humanharness/protocol";
import { MAIN_SCOPE, type ScopeStore } from "@humanharness/workspace";
import type { ConfigStore } from "../config";
import type { Turns } from "../gated-turns";
import type { LinkedInstructions, ScopeAccess } from "../scope-access";
import type { TaskDeps } from "../task-manager";
import { type ToolsHost, jobLimits, lastCallOf } from "../tools/tools-host";
import type { TurnGate } from "../turn-gate";
import { type JobsHost, type JobsHostDeps, createJobsHost, singleBeforeStart, singleGate, singleTurns } from "./jobs-host";

/** What `buildJobsHost` reads of the main entry. Getters for what changes after it is built. */
export interface JobsWiringDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  turnBlocked(): string | null;
  checkTurn(): Promise<void>;
  /** Why a turn waits for an undo running now, or null. */
  restoreBlocked(): string | null;
  currentBase: JobsHostDeps["base"];
  taskDeps: TaskDeps;
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  scopeStoreFor(base: string): ScopeStore;
  linked(): { access: ScopeAccess; instructions: LinkedInstructions } | null;
  /** Settings › Jobs, as saved now. */
  jobSettings(): AppConfig["jobs"];
  changed: JobsHostDeps["changed"];
  sharedAttention(): { forBase(base: string, create: boolean): ReturnType<NonNullable<JobsHostDeps["attention"]>> } | null;
  refreshJobBadge(): Promise<void>;
  toolsHost(): ToolsHost | null;
}

/**
 * The jobs' wiring (part 3) over the app's own: the brief from the harness folder, the task deps' notes, data and
 * material for the first message, the active scopes. `workspace` is single mode's or the board's.
 */
export function buildJobsHost(d: JobsWiringDeps, gate: TurnGate, workspace: () => Promise<HarnessWorkspace>): JobsHost {
  const harness = d.harness();
  const { validConfig, baseOf, scoped, activeScope, taskDeps } = d;
  const toolsHost = d.toolsHost();
  const linked_ = d.linked;
  return createJobsHost({
    jobs: harness.jobs ?? {},
    actions: harness.actions,
    // Only a prompt job's run reads a brief; a recipe has none (a job declares prompt or steps).
    readBrief: (job) => (job.prompt !== undefined ? fs.readFile(resolveInHarness(harness, job.prompt), "utf8") : Promise.reject(new Error("A recipe has no brief"))),
    workspace: async () => {
      if (d.quitting()) throw new Error("The app is closing");
      const blocked = d.turnBlocked();
      if (blocked) throw new Error(blocked);
      await d.checkTurn();
      // As a lane's turn: a run never edits a file an undo is putting back.
      while (d.restoreBlocked()) await new Promise((r) => setTimeout(r, 50));
      return workspace();
    },
    gate,
    base: d.currentBase,
    // A job is not a task (replaceable-parts §8 fixes ids per task): its picks read config.json's ids, as material does.
    taskDeps: { ...taskDeps, profileFor: async (a, f, t) => taskDeps.profileFor!(a, f, t, (await d.config().load()).policies) },
    scoped,
    scopes: async () => {
      const c = await validConfig();
      if (!c) return [];
      if (!scoped()) return [MAIN_SCOPE];
      return (await d.scopeStoreFor(baseOf(c)).list()).filter((sc) => !sc.archived).map((sc) => sc.id);
    },
    scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
    // A scoped run reaches its own scope's linked folders, checked as a task's turn (hatches). None without (D0).
    ...(hasLinkedFolders(harness)
      ? { linked: { access: async (sc: string) => linked_()?.access.access(sc), section: async (sc: string) => (await linked_()?.access.section(sc)) ?? "" } }
      : {}),
    engine: async () => (await d.config().load()).engineId ?? "",
    // Settings › Jobs, read at each trigger: a change applies from the next one, without a restart.
    settings: (id) => d.jobSettings()?.[id],
    changed: d.changed,
    // Needs-you results in the base's shared store (Task 8), and the Dock badge.
    attention: async (b) => d.sharedAttention()?.forBase(b, true) ?? null,
    needsYouChanged: () => void d.refreshJobBadge(),
    // A recipe's tools (tools spec §7): only with tools (D0). toolsHost is set before "ready", so before this runs.
    ...(toolsHost ? { tools: recipeTools(harness, toolsHost) } : {}),
  });
}

/**
 * What a recipe run needs of the tools host (tools spec §7): its registry, the run's trailer on its calls, the job's
 * limits, the run's last tool call (trace notes, such as an AI round's, skipped) and the AI step's brief.
 */
function recipeTools(harness: LoadedHarness, t: ToolsHost): NonNullable<JobsHostDeps["tools"]> {
  return {
    registry: t.registry,
    withRunTrailer: (trailer, fn) => t.withRunTrailer(trailer, fn),
    limits: (job) => jobLimits(harness, job),
    lastCall: async (run) => lastCallOf(await t.trace(run)),
    readAiBrief: (p) => fs.readFile(resolveInHarness(harness, p), "utf8"),
  };
}

/** What single mode adds to the jobs' wiring: the main slot, today's turns, and the runtime's workspace. */
export interface SingleJobsDeps {
  mainSlot(): Promise<SessionSlot | null>;
  turns: Turns;
  emit: Parameters<typeof singleTurns>[2];
  /** The runtime's workspace; throws when the engine isn't installed. */
  workspace(): Promise<HarnessWorkspace>;
  /** Keeps the gate and the gated turns, before the jobs host is built. */
  setSingle(single: { gate: TurnGate; turns: Turns }): void;
}

/**
 * `single` mode (Decision 12): the gate (tasks 1, the jobs' cap beside), today's TurnController through its `tasks` cap,
 * and the jobs host on the runtime's workspace.
 */
export function buildSingleJobs(d: JobsWiringDeps, s: SingleJobsDeps, c: AppConfig): JobsHost {
  const gate = singleGate(c.engineId, c.parallel);
  gate.setBeforeStart(singleBeforeStart(c.engineId, s.mainSlot));
  s.setSingle({ gate, turns: singleTurns(gate, s.turns, s.emit) });
  return buildJobsHost(d, gate, s.workspace);
}
