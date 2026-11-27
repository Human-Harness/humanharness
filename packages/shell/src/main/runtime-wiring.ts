import path from "node:path";
import { app } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { type LoadedHarness, hasEnginePresets } from "@humanharness/harness-sdk";
import type { AppConfig, ConfiguredApp } from "@humanharness/protocol";
import {
  type HarnessRuntime,
  type HarnessWorkspace,
  type RuntimeOptions,
  type SessionSlot,
  type SlotRef,
  createRuntime,
  createWorkspace,
  reviewAgent,
} from "@humanharness/runtime";
import { type DataStore, History } from "@humanharness/workspace";
import type { Job } from "@humanharness/material/light";
import type { BoardHost } from "./board-host";
import type { CommandDeps } from "./engine-command";
import { type ConfigStore, historyDir } from "./config";
import { agentDataRequest } from "./data-requests";
import type { EngineHost } from "./engine-config/engine-host";
import { engineCommand } from "./engine-command";
import { detectEngine } from "./engine-status";
import type { Turns } from "./gated-turns";
import { instructionSubagentsOption } from "./instruction-subagents";
import { type JobsHost, isJobSlot, openSingleRuntime, singleBeforeStart, singleCaps } from "./jobs/jobs-host";
import type { MaterialService } from "./material";
import { historyKeep } from "./material-ipc";
import type { MaterialJobs } from "./material-jobs";
import { modHistoryIgnores } from "./mods/services";
import type { ResolvedMod } from "./mods/resolve";
import { engineHold } from "./parallel-config";
import type { PluginsController } from "./plugins";
import { baseFor } from "./profile-base";
import type { ResolvedReference } from "./references";
import type { RestoreGuard } from "./restore-guard";
import { lastOpened } from "./restore-guard";
import type { ReviewService } from "./reviews";
import type { SettingsController } from "./settings";
import type { SharedConfigStore } from "./shared-config";
import type { TaskManager } from "./task-manager";
import type { TestHooks } from "./test-hooks";
import type { ToolsHost } from "./tools/tools-host";
import { EngineUnavailable, memoise } from "./turn-controller";
import type { TurnGate } from "./turn-gate";
import { type ValidationContext, configProblem } from "./validate";
import { isConfigured } from "@humanharness/protocol";

type RunningTask = { id: string; action?: string; scope: string } | null;

/** What the runtime wiring reads from the main entry. Getters for what changes after it is built. */
export interface RuntimeWiringDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  shared(): SharedConfigStore;
  hooks: TestHooks;
  commandDeps: CommandDeps;
  /** The build's folder (the servers' entries). */
  here: string;
  validation(): ValidationContext;
  profilesOn(): boolean;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  restores(): Pick<RestoreGuard, "settled">;
  pluginsCtl(): PluginsController | null;
  settingsCtl(): SettingsController | null;
  toolsHost(): ToolsHost | null;
  reviews(): Pick<ReviewService, "agent">;
  host(): BoardHost | null;
  single(): { gate: TurnGate; turns: Turns } | null;
  singleParts: WeakMap<HarnessRuntime, { workspace: HarnessWorkspace; slot: SessionSlot }>;
  jobsHost(): JobsHost | null;
  materialJobs(): MaterialJobs<Job> | null;
  materialSvc(): MaterialService | null;
  tasks(): Pick<TaskManager, "runningTask" | "currentScope" | "interrupt" | "isBusy">;
  plainTasks(): Pick<TaskManager, "sessionStarted">;
  /** The move's folder change has begun: no history is opened until it ends. */
  historyHeld(): boolean;
  resolvedMods(): ResolvedMod[];
  pluginLog(message: string, err?: unknown): void;
  dataStoreFor(base: string): DataStore;
  materialRequest(base: string, request: unknown, runningTask: () => Promise<{ id: string; scope: string } | null>): Promise<unknown>;
  workReferences(c: AppConfig, base: string, log?: boolean): Promise<ResolvedReference[]>;
  linkedRuntimeOptions(): Pick<RuntimeOptions, "instructionLinked" | "linkedGitdir"> & { onLinkedUnsupported?: () => void };
  engineHost(): EngineHost | undefined;
  kickMaterial(): void;
  announceCommits(history: History): void;
  /** A closed runtime's history keeps no listener of main's. */
  stopAnnouncing(history: History): void;
}

/** The runtime (plain and `single` mode), its options and engine start, its close, and the histories opened beside it. */
export function createRuntimeWiring(d: RuntimeWiringDeps) {
  const { hooks, commandDeps, here, singleParts } = d;

  /**
   * What a runtime (or board mode's workspace) starts with: the config's checks, the engine's command and the plugin
   * catalogue. Null when the engine CLI isn't installed.
   */
  async function prepareEngine() {
    const harness = d.harness();
    const c = await d.config().load();
    if (!isConfigured(c)) throw new Error("The app is not set up yet");
    const problem = await configProblem(c, d.validation());
    if (problem) throw new Error(problem);
    // With profiles, the runtime works in the active profile's folder, with that folder's history (spec D2, D5).
    const base = baseFor(c, d.profilesOn());
    if (base === null) throw new Error("Choose a profile first");
    await d.restores().settled();
    const engine = getEngine(c.engineId);
    let cmd: { command: string[]; env: Record<string, string> } | null;
    const fake = hooks.engines?.[engine.id];
    if (fake) cmd = fake;
    else {
      // Spec §9 "every start": enforce detect.minVersion and a signed-in CLI before the first turn.
      const status = await detectEngine(engine, commandDeps, d.shared());
      if (!status.installed) return null;
      if (status.outdated) throw new EngineUnavailable("outdated-version");
      if (status.loggedIn === false) throw new EngineUnavailable("session-expired");
      cmd = await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) });
    }
    if (!cmd) return null;
    const plugins = d.pluginsCtl();
    // The running plugins' collections the agent reads (plugins spec §3.2), written for this base; none: no file (D0).
    const extra = plugins ? await plugins.catalogueFile(base).catch((err: unknown) => (d.pluginLog("Could not write the plugin data catalogue", err), null)) : null;
    plugins?.markRuntimeBuilt(extra !== null);
    return { c, base, engine, cmd, extra };
  }

  /**
   * The runtime's options (and board mode's workspace's), its session aside. `runningTask` names the task a data or
   * material request is for: the open task's, or in board mode the asking slot's (P3).
   */
  async function runtimeOptions(
    { c, base, engine, cmd, extra }: NonNullable<Awaited<ReturnType<typeof prepareEngine>>>,
    runningTask: (slot?: SlotRef) => Promise<RunningTask>,
  ) {
    const harness = d.harness();
    const settings = d.settingsCtl();
    const plugins = d.pluginsCtl();
    // The core `tools` server for task and job slots (tools spec §5): only with an `agent: "call"` tool (D0).
    const tools = await d.toolsHost()?.workspaceOptions();
    return {
      harness,
      engine,
      folder: base,
      gitdir: historyDir(app.getPath("userData"), base),
      language: c.language,
      launcher: electronLauncher(process.execPath),
      uiServerEntry: path.join(here, "ui-server.js"),
      dataServerEntry: path.join(here, "data-server.js"),
      // The person's store (one write queue per base), for the folder this runtime runs in.
      // A dotted collection name is a running plugin's (read only); absent without plugins (D0).
      data: (request: unknown, slot?: SlotRef) =>
        agentDataRequest({ store: async () => d.dataStoreFor(base), runningTask: () => runningTask(slot), ...(plugins ? { plugin: (r: unknown) => plugins.agentData(r) } : {}) }, request),
      ...(extra ? { extraData: { catalogue: extra } } : {}),
      // The person's material in this folder, for the running task's scope (material spec §9): the base this runtime was
      // built for, so a request never reaches another profile's material. Absent without material (D0).
      ...(harness.material
        ? { material: { request: (request: unknown, slot?: SlotRef) => d.materialRequest(base, request, () => runningTask(slot)), entry: path.join(here, "material-server.js") } }
        : {}),
      // The writing guide, and the review tools in this base through the person's ReviewService, so both sides share its
      // locks. Tools only when the agent may edit the folder (review spec D0).
      ...reviewAgent(harness, (request) => d.reviews().agent(base, request)),
      command: cmd.command,
      env: cmd.env,
      references: (await d.workReferences(c, base, true)).map((r) => ({ label: r.label, path: r.path })),
      // The settings' sentences, read now and on every refresh (harness-settings spec §5). Absent without settings (D0).
      // Plugins' sentences follow the harness's own (Decision 16); none on: the same AGENTS.md as without them.
      ...(settings || plugins
        ? { instructionSettings: async () => [...(settings ? await settings.sentences() : []), ...(plugins ? await plugins.sentences() : [])] }
        : {}),
      // Linked folders (hatches spec §3.3, §3.4): absent without them (D0).
      ...d.linkedRuntimeOptions(),
      // The Subagents part of AGENTS.md follows the open scope's engine preset (agentsFile) when the manifest is silent.
      ...(hasEnginePresets(harness)
        ? { instructionSubagents: instructionSubagentsOption({ engineHost: d.engineHost, currentScope: () => d.tasks().currentScope(), boardMode: () => !!d.host() }) }
        : {}),
      // The asking slot names the caller (P3); createRuntime's only slot is "main".
      ...(tools ? { tools } : {}),
      onModels: (offer: Parameters<NonNullable<RuntimeOptions["onModels"]>>[0]) =>
        void d.shared().update(engine.id, { models: offer.models, efforts: offer.efforts }).catch((err: unknown) => console.error("Could not save the engine's models", err)),
    };
  }

  const runtime = memoise<HarnessRuntime>(async () => {
    const p = await prepareEngine();
    if (!p) return null;
    const rt = d.single()
      ? await openSingle(p)
      : await createRuntime({
          ...(await runtimeOptions(p, () => d.tasks().runningTask())),
          onSession: (s) => void d.plainTasks().sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
        });
    d.announceCommits(rt.history);
    // A new runtime: the material queue, stopped by closeRuntime, goes on (in this base). Without material, nothing.
    d.kickMaterial();
    return rt;
  });

  /**
   * `single` mode's runtime (Decision 12): a workspace whose `"main"` slot runs the task, as `createRuntime`'s; a data or
   * material request from a job's slot is that run's, in its scope (P3), never the open task's.
   */
  async function openSingle(p: NonNullable<Awaited<ReturnType<typeof prepareEngine>>>): Promise<HarnessRuntime> {
    const ws = await createWorkspace(
      await runtimeOptions(p, (slot) => {
        const jobs = d.jobsHost();
        return slot && jobs && isJobSlot(slot.key) ? Promise.resolve(jobs.runningOf(slot.key)) : d.tasks().runningTask();
      }),
    );
    const { runtime: rt, slot } = await openSingleRuntime(ws, {
      onSession: (s) => void d.plainTasks().sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err)),
    });
    singleParts.set(rt, { workspace: ws, slot });
    return rt;
  }

  /**
   * Closes the running runtime and keeps the open task; the next turn starts a new runtime (and engine session). First
   * the person's material stops (material spec §10): its AI stage and its conversions, which belong to this base.
   */
  async function closeRuntime() {
    // Job runs on this workspace end first and are logged "Cancelled" (Decision 11): none is cut off by its slot
    // closing, none queued for this folder or profile runs after. Without jobs, nothing (D0).
    await d.jobsHost()?.cancelAndSettle();
    await d.materialJobs()?.stop();
    await d.materialSvc()?.stop();
    // Board mode: the shared workspace (every lane's slot) closes; the open tasks stay, as today's task does.
    const host = d.host();
    if (host) {
      await host.closeWorkspace();
      // As below: not when a lane has already opened a new workspace, which wrote its own AGENTS.md.
      if (!host.workspaceOpen()) d.settingsCtl()?.forget();
      return;
    }
    const rt = await runtime.peek()?.catch(() => null);
    runtime.clear();
    await rt?.close();
    // A closed runtime's history keeps no listener of main's.
    if (rt) d.stopAnnouncing(rt.history);
    // The next runtime writes AGENTS.md afresh: nothing is pending against this one's. Only once close() resolved (a
    // running refresh would set what was applied again), and not when a new runtime has already written its own.
    if (!runtime.peek()) d.settingsCtl()?.forget();
  }

  /** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
  async function dropRuntime() {
    // Jobs (Decision 11): the runs queued or running are cancelled ("Cancelled"); the `every` timers stay.
    d.jobsHost()?.cancelRuns();
    // Board mode: every lane ends, the queues empty, the workspace closes; a new engine brings its caps (spec §10).
    const host = d.host();
    if (host) {
      await host.dropAll();
      return closeRuntime();
    }
    d.single()?.gate.dropAll();
    await d.tasks().interrupt().catch((err: unknown) => console.error("Could not end the task", err));
    await closeRuntime();
    const single = d.single();
    if (single) {
      // A new engine brings its own hold: one session in all (tasks and jobs together) or two at once.
      const c = await d.config().load();
      single.gate.setCaps(singleCaps(c.engineId, c.parallel), engineHold(c.engineId));
      single.gate.setBeforeStart(singleBeforeStart(c.engineId, singleMainSlot));
    }
  }

  /**
   * "Undo this task" by its own paths (parallel spec §5.3): board mode, and `single` mode, where job runs commit beside
   * the task. Null in plain mode: the whole folder back to the task's start, as always (D0). `busy`: the task's own lane
   * (single mode: the task) or the job run being undone is still running.
   */
  function undoByPaths(): {
    running: () => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
    /** The same in a tracked linked folder (hatches spec §3.4), relative to it. */
    linkedRunning: (realPath: string) => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
    busy: (id: string) => boolean;
  } | null {
    const jobRunning = (id: string) => (d.jobsHost()?.runningOf(`job:${id}`) ?? null) !== null;
    const board = d.host();
    if (board)
      return {
        running: () => board.runningPaths(),
        linkedRunning: (p) => board.linkedRunningPaths(p),
        busy: (id) => (board.lane(id)?.manager.isBusy() ?? false) || jobRunning(id),
      };
    if (!d.single()) return null;
    return {
      running: async () => {
        const rt = await runtime.peek()?.catch(() => null);
        const ws = rt ? singleParts.get(rt)?.workspace : undefined;
        return ws ? ws.runningPaths() : [];
      },
      linkedRunning: async (p) => {
        const rt = await runtime.peek()?.catch(() => null);
        const ws = rt ? singleParts.get(rt)?.workspace : undefined;
        return ws ? ws.linkedRunningPaths(p) : [];
      },
      busy: (id) => d.tasks().isBusy() || jobRunning(id),
    };
  }

  /** `single` mode: the running runtime's `"main"` slot, if one is open (never opens one). */
  async function singleMainSlot(): Promise<SessionSlot | null> {
    const rt = await runtime.peek()?.catch(() => null);
    return rt ? (singleParts.get(rt)?.slot ?? null) : null;
  }

  /** The history of the folder when no runtime runs: one per folder and ignore list (its queue orders every write). */
  const standaloneHistory = lastOpened(async (key) => {
    const { folder, ignore } = JSON.parse(key) as { folder: string; ignore: string[] };
    const history = new History(
      folder,
      historyDir(app.getPath("userData"), folder),
      [...ignore, ...modHistoryIgnores(d.resolvedMods().map((m) => ({ id: m.json.id, history: m.json.history })))],
      historyKeep(d.harness()),
    );
    await history.init();
    d.announceCommits(history);
    return history;
  });

  /**
   * The running runtime's history, or the one opened on the configured folder; none while the folder moves
   * (from the end of its checkpoint turn, whose commit still goes in).
   */
  async function currentHistory(): Promise<History | null> {
    return d.historyHeld() ? null : openHistory();
  }

  async function openHistory(): Promise<History | null> {
    const host = d.host();
    const rt = host ? null : await runtime.peek()?.catch(() => null);
    if (rt) return rt.history;
    // Board mode: the shared workspace's history while it is open.
    const board = d.host();
    if (board) {
      const open = await board.history();
      if (open) return open;
    }
    const c = await d.validConfig();
    if (!c) return null;
    const extra = getEngine(c.engineId).instructionsFile?.path;
    // Same ignore list as the runtime's: its files under .harness/ and the generated instructions.
    return standaloneHistory(JSON.stringify({ folder: d.baseOf(c), ignore: [".harness/", "AGENTS.md", ...(extra ? [extra] : [])] }));
  }

  return {
    prepareEngine,
    runtimeOptions,
    runtime,
    closeRuntime,
    dropRuntime,
    undoByPaths,
    singleMainSlot,
    standaloneHistory,
    currentHistory,
    openHistory,
  };
}
