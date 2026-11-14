import type { LoadedHarness } from "@humanharness/harness-sdk";
import { type HarnessWorkspace, type RuntimeOptions, type SlotRef, createWorkspace } from "@humanharness/runtime";
import type { AppConfig } from "@humanharness/protocol";
import type { History } from "@humanharness/workspace";
import { saveAppChange } from "./app-change";
import { type BoardHost, type BoardHostDeps, createBoardHost } from "./board-host";
import type { ConfigStore } from "./config";
import { type JobsHost, isJobSlot } from "./jobs/jobs-host";
import type { TaskDeps } from "./task-manager";
import type { TurnDeps } from "./turn-controller";

type RunningTask = { id: string; action?: string; scope: string };

/** What `buildBoardHost` reads of the main entry. Getters for what changes after it is built. `P` is a prepared engine. */
export interface BoardWiringDeps<P> {
  harness(): LoadedHarness;
  config(): ConfigStore;
  currentBase(): Promise<string | null>;
  taskStoreOptions: BoardHostDeps["taskStoreOptions"];
  /** The engine ready for a workspace, or null when its CLI isn't installed. */
  prepareEngine(): Promise<P | null>;
  runtimeOptions(p: P, runningTask: (slot?: SlotRef) => Promise<RunningTask | null>): Promise<RuntimeOptions>;
  jobsHost(): JobsHost | null;
  /** A workspace's commits reach the file timelines. */
  announceCommits(history: History): void;
  kickMaterial(): void;
  turnDeps: TurnDeps;
  checkTurn(): Promise<void>;
  /** Why a turn waits for an undo running now, or null: a lane's turn waits for it. */
  restoreBlocked(): string | null;
  turnChatLog: BoardHostDeps["chatLog"];
  taskDeps: TaskDeps;
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  emit: BoardHostDeps["emit"];
  send: BoardHostDeps["send"];
  currentHistory(): Promise<History | null>;
  /** The waiting tasks' attention, built once the host is (board mode only). */
  attention(): NonNullable<BoardHostDeps["attention"]>;
}

/**
 * Board mode's host (parallel spec §6) over the app's own wiring: the plain runtime's checks and options for its
 * workspace, today's turn and task deps for its lanes.
 */
export function buildBoardHost<P>(d: BoardWiringDeps<P>, c: AppConfig): BoardHost {
  const { prepareEngine, runtimeOptions, announceCommits, kickMaterial, checkTurn, currentHistory } = d;
  return createBoardHost(
    {
      suggested: d.harness().parallel ?? { tasks: 1, jobs: 1 },
      config: () => d.config().load(),
      base: d.currentBase,
      taskStoreOptions: d.taskStoreOptions,
      openWorkspace: async (runningTask) => {
        const p = await prepareEngine();
        if (!p) return null;
        const ws: HarnessWorkspace = await createWorkspace(
          await runtimeOptions(p, (slot) => {
            // A job run's slot: that run, in its scope (P3); never a lane's task.
            const jobs = d.jobsHost();
            if (slot && jobs && isJobSlot(slot.key)) return Promise.resolve(jobs.runningOf(slot.key));
            return slot ? runningTask(slot) : Promise.resolve(null);
          }),
        );
        // A new workspace: the material queue goes on (in this base), and its commits reach the file timelines, as with
        // a new runtime.
        announceCommits(ws.history);
        kickMaterial();
        return ws;
      },
      turnDeps: d.turnDeps,
      checkTurn: async () => {
        await checkTurn();
        // A lane let in while an undo runs waits for it: it never edits a file being put back.
        while (d.restoreBlocked()) await new Promise((r) => setTimeout(r, 50));
      },
      chatLog: (chat, task) => d.turnChatLog(chat, task),
      taskDeps: d.taskDeps,
      scoped: d.scoped,
      scopeExists: d.activeScope,
      emit: d.emit,
      send: d.send,
      label: (t) => {
        const harness = d.harness();
        return t.action && Object.hasOwn(harness.actions, t.action) ? harness.actions[t.action].label : (t.question ?? "").slice(0, 60);
      },
      // A lane's note commits its file alone (parallel spec §5.3).
      saveOwn: async (paths, message, trailer) => saveAppChange(await currentHistory(), true, paths, message, trailer),
      attention: d.attention(),
    },
    { engineId: c.engineId, parallel: c.parallel },
  );
}
