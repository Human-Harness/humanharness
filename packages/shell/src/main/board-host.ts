import { randomUUID } from "node:crypto";
import { type ParallelCaps, isConcurrent } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace, SessionSlot, SlotRef } from "@humanharness/runtime";
import type { AppConfig, ChatEntry, ChatLoad, TaskView, TasksState } from "@humanharness/ui/client";
import { type History, taskChatFile } from "@humanharness/workspace";
import { ChatLog } from "./chat-log";
import { migrateChats } from "./chat-migration";
import { gatedTurns } from "./gated-turns";
import { type TasksFileStore } from "./lane-store";
import { LaneStore } from "./lane-store";
import { LiveBuffer, laneEmit } from "./live-buffer";
import { type EngineHold, effectiveCaps, engineHold } from "./parallel-config";
import { TaskBoard, type LaneHandle } from "./task-board";
import { type TaskDeps, TaskManager } from "./task-manager";
import { type CurrentTask, TaskStore, emptyTasks, scopeOfTask } from "./task-store";
import { type ChatLogLike, type TurnDeps, type TurnOptions, TurnController, memoise } from "./turn-controller";
import { TurnGate } from "./turn-gate";

export type HostMode = "plain" | "board";

/** Plain: today's single runtime and task (D7). Board: the harness declares `parallel`. Part 3 adds "single" for jobs. */
export function hostMode(harness: { parallel?: unknown }): HostMode {
  return isConcurrent(harness as { parallel?: ParallelCaps }) ? "board" : "plain";
}

/** What the person sees when a sleeping lane's engine couldn't load its earlier conversation (spec §4, PT-S4). */
export const RESUME_FAILED = "Couldn't resume the earlier conversation; started a new one.";

/** How long a lane waits for the person before its engine process goes (spec §4; open question 7). */
const IDLE_SLEEP_MS = 10 * 60_000;
/** How long new turns wait for a gap when AGENTS.md must be rewritten (spec §10). */
const REFRESH_HOLD_MS = 10_000;

type RunningTask = { id: string; action?: string; scope: string };

export interface BoardHostDeps {
  /** The manifest's suggested caps. */
  suggested: ParallelCaps;
  config(): Promise<AppConfig>;
  /** The folder every `.harness/` path starts from, once the app is set up; null before. */
  base(): Promise<string | null>;
  taskStoreOptions(): { modes?: string[]; phases?: Record<string, string[]> };
  /**
   * The shared workspace for the current config, as index.ts builds the plain runtime (same checks, same options);
   * null when the engine CLI isn't installed. `runningTask` answers which task asked, by the asking slot (P3).
   */
  openWorkspace(runningTask: (slot: SlotRef) => Promise<RunningTask | null>): Promise<HarnessWorkspace | null>;
  /** Today's TurnController deps; each lane overrides `ensureRuntime`, `chatLog` and `emit`. */
  turnDeps: TurnDeps;
  /** Throws why a turn can't start now (an engine change, a notice to accept), as today's `ensureRuntime` checks. */
  checkTurn(): Promise<void>;
  /** A task's chat log (`chat`: its scope); null before the app is set up. As today's, with the task's own file. */
  chatLog(chat: string | undefined, task: string): Promise<ChatLogLike | null>;
  /**
   * Today's TaskManager deps, getters kept (they are read when used); each lane overrides `store`, `turns`, `newId`,
   * `changed`, `emit`, `endSession`, `successor` and wraps `betweenTasks`.
   */
  taskDeps: TaskDeps;
  scoped(): boolean;
  scopeExists(id: string): Promise<boolean>;
  /** An event for the window (the focused lane's only). */
  emit(e: Event): void;
  /** A message for the window (`hh:tasks`, `hh:tasksChange`). */
  send(channel: string, value: unknown): void;
  /** The task's name as the history shows it. */
  label(t: CurrentTask): string;
  /** Tests: a held clock for the idle sleep, a shorter wait. */
  idle?: { ms: number; timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void } };
}

interface Lane {
  readonly id: string;
  manager: TaskManager & LaneHandle;
  controller: TurnController;
  turns: ReturnType<typeof gatedTurns>;
  slot: ReturnType<typeof memoise<SessionSlot>>;
  /** The engine session this lane last had: a different one starting means the earlier one couldn't be loaded. */
  known: string | null;
  /** Set by a gated turn whose `beforeStart` failed: its TurnController start ends with that failure. */
  startFailed: boolean;
}

export type BoardHost = ReturnType<typeof createBoardHost>;

/**
 * Board mode's wiring (parallel spec §6, Decision 3): one shared workspace, one TaskBoard, one gate, and per open task a
 * lane of today's machinery (a TaskManager over a LaneStore, its own TurnController through the gate, its own session
 * slot keyed by the task id). Only the focused lane talks to the window; the others' turns are buffered.
 */
export function createBoardHost(d: BoardHostDeps, initial: { engineId: string | undefined; parallel: AppConfig["parallel"] }) {
  const lanes = new Map<string, Lane>();
  const buffer = new LiveBuffer();
  let engineId = initial.engineId;
  let hold: EngineHold = engineHold(engineId);
  let caps = effectiveCaps(d.suggested, initial.parallel, hold);
  const gate = new TurnGate(caps, { hold });
  /** Lane sleeps under way: a second asks for the same one, and a turn waits for it before its send (sleep holds busy). */
  const sleeps = new Map<string, Promise<void>>();
  /** The last chat move: no lane writes its chat before it ended. */
  let migrated: Promise<unknown> = Promise.resolve();
  /** A refresh was refused because a turn ran: the next `betweenTasks` waits for a gap. */
  let refreshRefused = false;
  /** The plugin catalogue changed while lanes were open (Decision 13): the workspace closes once none is. */
  let workspaceStale = false;

  // tasks.json of the current base. `file` names it, so every writer of that file (the lanes, the board's focus, the
  // engine change's TaskStore) shares one write chain (withTasksFile).
  let lastFile: string | undefined;
  const store = async (): Promise<TaskStore | null> => {
    const base = await d.base();
    if (!base) return null;
    const s = new TaskStore(base, d.taskStoreOptions());
    lastFile = s.file;
    return s;
  };
  const file: TasksFileStore = {
    get file() {
      return lastFile;
    },
    load: async () => (await store())?.load() ?? emptyTasks(),
    save: async (state) => {
      await (await store())?.save(state);
    },
  };

  const workspace = memoise<HarnessWorkspace>(() => d.openWorkspace((slot) => runningTaskOf(slot.key)));

  const board: TaskBoard = new TaskBoard({
    file,
    newLane: (id) => newLane(id).manager,
    newId: () => randomUUID(),
    changed: () => {
      void board.view().then(
        (view) => d.send("hh:tasks", view),
        (err: unknown) => console.error("Could not read the focused task", err),
      );
      tasksChanged();
    },
    gate,
    hold,
    scopes: { scoped: d.scoped(), exists: (id) => d.scopeExists(id) },
  });
  board.setQueued((id) => gate.isQueued(id));
  board.setIdleSleep({
    ms: d.idle?.ms ?? IDLE_SLEEP_MS,
    timer: d.idle?.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    sleep: sleepLane,
  });
  gate.onChange(() => tasksChanged());

  function tasksChanged(): void {
    void tasksState().then(
      (state) => d.send("hh:tasksChange", state),
      (err: unknown) => console.error("Could not read the open tasks", err),
    );
  }

  async function tasksState(): Promise<TasksState> {
    const p = gate.paused();
    return { tasks: await board.summaries({ label: d.label }), ...(p ? { paused: { ...p } } : {}), caps: { ...caps } };
  }

  /** The task lane `key` runs now (P3: a data request's task comes from the asking slot, never from the request). */
  async function runningTaskOf(key: string): Promise<RunningTask | null> {
    const lane = lanes.get(key);
    return lane ? lane.manager.runningTask() : null;
  }

  /** Puts lane `id`'s engine process to sleep; one sleep per lane at a time. */
  function sleepLane(id: string): Promise<void> {
    const running = sleeps.get(id);
    if (running) return running;
    const open = lanes.get(id)?.slot.peek();
    if (!open) return Promise.resolve();
    const p: Promise<void> = open
      .then((slot) => slot?.sleep())
      .finally(() => {
        if (sleeps.get(id) === p) sleeps.delete(id);
      });
    sleeps.set(id, p);
    return p;
  }

  function newLane(id: string): Lane {
    const emit = laneEmit(id, buffer, { isFocused: (x) => board.isFocused(x), toWindow: (e) => d.emit(e) });
    const lane = { id, known: null, startFailed: false } as unknown as Lane;
    lane.slot = memoise<SessionSlot>(async () => {
      const ws = await workspace.get();
      if (!ws) return null;
      const stored = (await file.load()).lanes?.find((t) => t.id === id)?.session;
      lane.known = stored?.started ? stored.id : null;
      return ws.openSlot({ key: id, ...(stored ? { session: stored } : {}), onSession: (s) => sessionStarted(lane, s) });
    });
    lane.controller = new TurnController({
      ...d.turnDeps,
      ensureRuntime: async () => {
        if (lane.startFailed) {
          lane.startFailed = false;
          throw new Error("Couldn't get ready for this turn");
        }
        await migrated.catch(() => undefined);
        await d.checkTurn();
        // A sleep started just before this turn (the idle timer): the slot is busy until it ends.
        await sleeps.get(id)?.catch(() => undefined);
        return lane.slot.get();
      },
      chatLog: async (chat) => {
        await migrated.catch(() => undefined);
        return d.chatLog(chat, id);
      },
      emit,
    });
    lane.turns = gatedTurns(id, gate, lane.controller, {
      cap: "tasks",
      emit,
      startFailed: (message, options) => {
        lane.startFailed = true;
        return lane.controller.send(message, options);
      },
    });
    const turns = {
      send(message: string, options: TurnOptions) {
        // The person's line starts the buffer of what focusing this lane replays (Decision 6).
        if (!lane.turns.isBusy() && !options.quiet && !options.skipUserEntry) buffer.user(id, { text: options.display ?? message, at: new Date().toISOString() });
        return lane.turns.send(message, options);
      },
      isBusy: () => lane.turns.isBusy(),
      cancel: () => lane.turns.cancel(),
    };
    const overrides: Partial<TaskDeps> = {
      store: new LaneStore(file, id),
      turns,
      newId: () => id,
      changed: (view) => laneChanged(id, view),
      emit,
      endSession: async () => {
        const slot = await lane.slot.peek()?.catch(() => null);
        await slot?.endSession();
      },
      successor: (start) => board.handOver((next) => start(lanes.get(next.id)!.manager), id),
      // A phase separator or wrap-up line belongs in this task's chat: only the window that shows it draws one.
      taskTurn: (notice) => {
        if (board.isFocused(id)) d.taskDeps.taskTurn?.(notice);
      },
    };
    const deps = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(d.taskDeps), ...Object.getOwnPropertyDescriptors(overrides) }) as TaskDeps;
    // betweenTasks stays a getter (the controllers exist only once the harness is loaded); it waits for a gap.
    Object.defineProperty(deps, "betweenTasks", {
      get: () => {
        const fn = d.taskDeps.betweenTasks;
        return fn ? () => refreshSoon(fn) : undefined;
      },
    });
    const manager = new TaskManager(deps);
    const close = async () => {
      await TaskManager.prototype.close.call(manager);
      buffer.drop(id);
      if (lanes.get(id) === lane) lanes.delete(id);
      const slot = await lane.slot.peek()?.catch(() => null);
      lane.slot.clear();
      await slot?.close();
    };
    lane.manager = Object.assign(manager, { id, close });
    lanes.set(id, lane);
    return lane;
  }

  /** A lane's TaskManager `changed`: the window's view when it is the focused one, the inbox, the idle sleep, settling. */
  function laneChanged(id: string, view: TaskView): void {
    if (board.isFocused(id)) d.send("hh:tasks", view);
    if (view.current?.status === "waiting") board.laneWaiting(id);
    else board.laneActive(id);
    void board.laneSettled(id).catch((err: unknown) => console.error("Could not settle a task", err));
    tasksChanged();
  }

  /** The slot's engine started a session: a new one where an earlier one was to be loaded tells the person (PT-S4). */
  function sessionStarted(lane: Lane, s: { id: string; started: boolean }): void {
    const resumed = lane.known === null || lane.known === s.id;
    lane.known = s.id;
    void lane.manager.sessionStarted(s).catch((err: unknown) => console.error("Could not record the session", err));
    if (resumed) return;
    console.error(`Task ${lane.id}: the earlier engine session couldn't be loaded; a new one started`);
    const notice = randomUUID();
    const emit = laneEmit(lane.id, buffer, { isFocused: (x) => board.isFocused(x), toWindow: (e) => d.emit(e) });
    emit({ type: "activity", id: notice, kind: "other", detail: RESUME_FAILED, state: "start" });
    emit({ type: "activity", id: notice, kind: "other", detail: RESUME_FAILED, state: "end" });
  }

  /**
   * TaskManager's `betweenTasks` in board mode (spec §10): AGENTS.md can only be rewritten while no turn runs. When a
   * refresh was refused for that, new turns are held for up to 10 s while it waits for a gap; then it runs again. Past
   * that, the change stays pending (the controllers keep it stale) for the next gap.
   */
  async function refreshSoon(fn: () => Promise<void>): Promise<void> {
    refreshRefused = false;
    await fn();
    if (workspaceStale && board.laneIds().length === 0) await closeWorkspace();
    if (!refreshRefused) return;
    const release = gate.hold(REFRESH_HOLD_MS);
    try {
      if (await gap(REFRESH_HOLD_MS)) {
        refreshRefused = false;
        await fn();
      }
    } finally {
      release();
    }
  }

  /** Resolves true once no turn runs in the workspace, false after `ms`. */
  async function gap(ms: number): Promise<boolean> {
    const ws = await workspace.peek()?.catch(() => null);
    if (!ws?.anyRunning()) return true;
    return new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(timer);
        off();
        resolve(v);
      };
      const timer = setTimeout(() => done(false), ms);
      const off = gate.onChange(() => {
        if (!ws.anyRunning()) done(true);
      });
    });
  }

  /** Closes the workspace (every lane's slot); the lanes stay open and their next turns open new slots. */
  async function closeWorkspace(): Promise<void> {
    workspaceStale = false;
    for (const l of lanes.values()) l.slot.clear();
    const ws = await workspace.peek()?.catch(() => null);
    workspace.clear();
    await ws?.close();
  }

  return {
    board,
    gate,
    buffer,
    /** The lane of task `id` (tests, P3). */
    lane: (id: string) => lanes.get(id),
    runningTaskOf,
    /** The open workspace's history, if one is open. */
    async history(): Promise<History | null> {
      return (await workspace.peek()?.catch(() => null))?.history ?? null;
    },
    /** Each running turn's task and the paths it touched (undo by paths, P2). */
    async runningPaths(): Promise<{ task: string; paths: ReadonlySet<string> }[]> {
      const ws = await workspace.peek()?.catch(() => null);
      return ws ? ws.runningPaths() : [];
    },
    /**
     * The settings' and plugins' AGENTS.md rewrite. True when it wrote; false when unchanged or no workspace is open
     * (the next one writes it afresh). A refusal because a turn runs throws, so the caller keeps its change stale.
     */
    async refreshInstructions(): Promise<boolean> {
      const ws = await workspace.peek()?.catch(() => null);
      if (!ws) return false;
      const wrote = await ws.refreshInstructions();
      if (!wrote && ws.anyRunning()) {
        refreshRefused = true;
        throw new Error("A turn is running: AGENTS.md waits for a gap");
      }
      return wrote;
    },
    /** The plugin collections changed (Decision 13): the workspace closes now if no task is open, else once none is. */
    async runtimeStale(): Promise<void> {
      if (board.laneIds().length === 0 && !board.isBusy()) await closeWorkspace();
      else {
        workspaceStale = true;
        console.error("The plugin collections changed: the agent gets them once no task is open");
      }
    },
    /**
     * At start, after a profile switch or a folder change: the chats move to per-task files (once per folder, before
     * any lane writes), then every task left open ends unfinished.
     */
    async interrupt(): Promise<void> {
      const move = (async () => {
        const base = await d.base();
        if (!base) return;
        const f = await file.load();
        // `current` first: plain mode's (or an older app's) open task keeps its scope's chat.
        const open = [...(f.current ? [f.current] : []), ...(f.lanes ?? [])]
          .map((t) => ({ scope: scopeOfTask(t), task: t.id }))
          .filter((o) => {
            try {
              taskChatFile(base, o.scope, o.task);
              return true;
            } catch {
              return false;
            }
          });
        const r = await migrateChats(base, open);
        if (r.kept.length > 0) console.error(`Chats kept as they were (their task's chat had lines of its own): ${r.kept.join(", ")}`);
      })();
      migrated = move;
      await move.catch((err: unknown) => console.error("Could not move the chats to per-task files", err));
      await board.interrupt();
    },
    /**
     * An engine change, a folder change, an engine update: every lane ends, the queues empty and the workspace closes.
     * On a new engine the caps and hold become its own.
     */
    async dropAll(): Promise<void> {
      await board.interruptAll().catch((err: unknown) => console.error("Could not end the open tasks", err));
      gate.dropAll();
      await closeWorkspace();
      const c = await d.config();
      if (c.engineId !== engineId) {
        engineId = c.engineId;
        hold = engineHold(engineId);
        caps = effectiveCaps(d.suggested, c.parallel, hold);
        board.engineChanged(caps, hold);
      }
    },
    closeWorkspace,
    /** Quit (Decision 16): every lane's turn stops, its slot closes; tasks.json stays for the next start to end them. */
    async closeAll(): Promise<void> {
      await board.closeAll();
      await closeWorkspace().catch((err: unknown) => console.error("Could not close the agent cleanly", err));
    },
    /** Every lane's turn ended and its chat writes settled. */
    async flush(): Promise<void> {
      await Promise.all([...lanes.values()].map((l) => l.controller.flush()));
    },
    /** The focused task's chat (the start view has none), and its turn still running to replay (Decision 6). */
    async loadChat(base: string): Promise<Pick<ChatLoad, "entries" | "live">> {
      const id = board.focusedId();
      if (id === null) return { entries: [] };
      const scope = await board.chatScope();
      const entries: ChatEntry[] = await new ChatLog(base, undefined, scope, id).load();
      // Read last, after every await: an event sent meanwhile is in it. Only a turn under way replays.
      const lane = lanes.get(id);
      const live = lane && board.focusedId() === id && lane.turns.isBusy() ? buffer.live(id) : undefined;
      if (!live) return { entries };
      // The turn's user line is written without waiting: until it is in the file, it comes from the buffer.
      const last = entries.at(-1);
      if (!(last?.role === "user" && last.text === live.user.text)) {
        entries.push({ id: `live-${id}`, role: "user", text: live.user.text, blocks: [], activities: [], at: live.user.at });
      }
      return { entries, live };
    },
    tasksState,
  };
}
