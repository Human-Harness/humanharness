import { describe, expect, it, vi } from "vitest";
import { LaneStore } from "../src/main/lane-store";
import { type BoardDeps, TaskBoard, type LaneHandle } from "../src/main/task-board";
import { TurnGate } from "../src/main/turn-gate";
import type { CurrentTask, TasksFile } from "../src/main/task-store";

/** A lane double with the TaskManager surface the board uses; state lives in the shared memory file through `file`. */
function harness(init: Partial<TasksFile> = {}, deps: Partial<BoardDeps> = {}) {
  let file: TasksFile = { version: 1, current: null, actions: {}, lanes: [], ...init };
  const made: FakeLane[] = [];
  const holds = new Map<string, Promise<void>>();
  class FakeLane implements LaneHandle {
    status: "idle" | "running" | "waiting" = "idle";
    started: string[] = [];
    asked: string[] = [];
    closed = false;
    interrupted = false;
    constructor(readonly id: string) {}
    async start(action: string, _display?: string, scope?: string) {
      if (action === "refused") throw new Error("That mode isn't offered");
      this.started.push(action);
      this.status = "running";
      // A test holds this action's first turn open.
      await holds.get(action);
      this.status = "waiting";
      file = { ...file, lanes: [...(file.lanes ?? []), { id: this.id, action, status: "waiting", startedAt: `2026-10-28T10:00:${String(made.indexOf(this)).padStart(2, "0")}Z`, turns: 1, ...(scope ? { scope } : {}) }] };
    }
    async ask(text: string) {
      this.asked.push(text);
      if (this.status === "idle") await this.start(`q:${text}`);
    }
    isBusy() {
      return this.status === "running";
    }
    async view() {
      return { current: this.status === "idle" ? null : ({ id: this.id, status: "waiting" } as never), actions: {}, notes: [] };
    }
    async finish() {
      this.closed = true;
      file = { ...file, lanes: (file.lanes ?? []).filter((l) => l.id !== this.id) };
      return true;
    }
    cancel() {}
    async interrupt() {
      this.interrupted = true;
      await this.finish();
    }
    async close() {}
  }
  let n = 0;
  const changed = vi.fn();
  const store = { load: async () => structuredClone(file), save: async (s: TasksFile) => void (file = structuredClone(s)) };
  const board = new TaskBoard({
    file: store,
    newLane: (id) => {
      const l = new FakeLane(id);
      made.push(l);
      return l;
    },
    newId: () => `t${++n}`,
    changed,
    ...deps,
  });
  return { board, made, file: () => file, store, changed, holds };
}

const task = (id: string, extra: Partial<CurrentTask> = {}): CurrentTask => ({
  id,
  action: "intro",
  status: "waiting",
  startedAt: "2026-10-28T10:00:00Z",
  turns: 1,
  ...extra,
});

describe("TaskBoard (parallel spec §6)", () => {
  it("starting a task never closes another; each gets its own lane", async () => {
    const { board, made } = harness();
    await board.start("intro");
    await board.start("plan");
    expect(made.filter((l) => l.started.length > 0).map((l) => l.started[0])).toEqual(["intro", "plan"]);
    expect(made.some((l) => l.closed)).toBe(false);
    expect((await board.list()).map((s) => s.id)).toEqual(["t1", "t2"]);
  });
  it("the new task is focused; focus(id) switches; unknown ids are refused (P1)", async () => {
    const { board, file } = harness();
    await board.start("intro");
    await board.start("plan");
    expect(file().focus).toBe("t2");
    await board.focus("t1");
    expect(file().focus).toBe("t1");
    await expect(board.focus("nope")).rejects.toThrow("Unknown task");
    await board.focus(null);
    expect(file().focus).toBeNull();
  });
  it("finish acts on the focused task only", async () => {
    const { board, made } = harness();
    await board.start("intro");
    await board.start("plan");
    await board.focus("t1");
    await board.finish();
    expect(made.find((l) => l.id === "t1")?.closed).toBe(true);
    expect(made.find((l) => l.id === "t2")?.closed).toBe(false);
  });
  it("loads open lanes from tasks.json at start (resume after a restart)", async () => {
    const h = harness();
    await h.board.start("intro");
    const again = new TaskBoard({
      file: { load: async () => structuredClone(h.file()), save: async () => {} },
      newLane: (id) => ({
        id,
        start: async () => {},
        ask: async () => {},
        isBusy: () => false,
        view: async () => ({ current: null, actions: {}, notes: [] }),
        finish: async () => true,
        cancel: () => {},
        interrupt: async () => {},
        close: async () => {},
      }),
      newId: () => "x",
      changed: () => {},
    });
    await again.restore();
    expect(again.laneIds()).toEqual(["t1"]);
    expect(again.focusedId()).toBe("t1");
  });

  it("two quick starts get two lanes: a lane's first turn never holds up the next start", async () => {
    const { board, made, file, holds } = harness();
    let release!: () => void;
    holds.set("intro", new Promise<void>((r) => (release = r)));
    const first = board.start("intro");
    await vi.waitFor(() => expect(made[0]?.started).toEqual(["intro"]));
    expect(board.isBusy()).toBe(true);
    const second = board.start("plan");
    await vi.waitFor(() => expect(made[1]?.started).toEqual(["plan"]));
    await second;
    expect(board.laneIds()).toEqual(["t1", "t2"]);
    expect(file().focus).toBe("t2");
    release();
    await first;
    expect(made.some((l) => l.closed)).toBe(false);
  });
  it("a question at the start view starts a new task; one in an open task's chat is its follow-up", async () => {
    const { board, made } = harness();
    await board.ask("hello");
    expect(board.laneIds()).toEqual(["t1"]);
    await board.ask("more");
    expect(made[0].asked).toEqual(["hello", "more"]);
    expect(board.laneIds()).toEqual(["t1"]);
    await board.focus(null);
    await board.ask("other");
    expect(board.laneIds()).toEqual(["t1", "t2"]);
  });
  it("a start that leaves no task (refused, failed) drops its lane and gives the focus back to the task shown before", async () => {
    const { board, made, file } = harness();
    await board.start("intro");
    await board.start("plan");
    await board.focus("t1");
    await expect(board.start("refused")).rejects.toThrow("That mode isn't offered");
    expect(board.laneIds()).toEqual(["t1", "t2"]);
    expect(file().focus).toBe("t1");
    expect(board.focusedId()).toBe("t1");
    expect(made.some((l) => l.closed)).toBe(false);
    // From the start view, it stays there.
    await board.focus(null);
    await expect(board.start("refused")).rejects.toThrow("That mode isn't offered");
    expect(file().focus).toBeNull();
  });
  it("no more than LANES_MAX open tasks: one more is refused before any lane is made", async () => {
    const { board, made, file } = harness();
    for (let i = 0; i < 32; i++) await board.start(`a${i}`);
    await expect(board.start("one-more")).rejects.toThrow("Too many open tasks");
    await expect(board.ask("one more")).resolves.toBeUndefined();
    await board.focus(null);
    await expect(board.ask("one more")).rejects.toThrow("Too many open tasks");
    expect(board.laneIds()).toHaveLength(32);
    expect(file().lanes).toHaveLength(32);
    expect(made).toHaveLength(32);
    // A task handed over by a lane that is closing takes that lane's place.
    await expect(board.handOver(async (l) => (await made[0].finish(), await l.start("next")), "t1")).resolves.toBeUndefined();
    expect(file().lanes?.length).toBeLessThanOrEqual(32);
    expect(file().lanes?.some((l) => l.id === "t1")).toBe(false);
  });
  it("a start asked for during interruptAll runs after it: its lane stays open, on the board and in the file", async () => {
    const { board, made, file } = harness();
    await board.start("a");
    const slow = made[0].interrupt.bind(made[0]);
    let release!: () => void;
    made[0].interrupt = async () => {
      await new Promise<void>((r) => (release = r));
      await slow();
    };
    const all = board.interruptAll();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const started = board.start("b");
    release();
    await all;
    await started;
    expect(board.laneIds()).toEqual(["t2"]);
    expect(file().lanes?.map((l) => l.id)).toEqual(["t2"]);
    expect(file().actions).toEqual({});
    expect(file().focus).toBe("t2");
  });
  it("a hand-over while every lane ends is refused at once, so interruptAll never waits on it", async () => {
    const { board, made } = harness();
    await board.start("a");
    const refused: string[] = [];
    const end = made[0].interrupt.bind(made[0]);
    // The lane's operation hands its next task over while it is being ended.
    made[0].interrupt = async () => {
      await board.handOver((l) => l.start("next"), "t1").catch((err: Error) => refused.push(err.message));
      await end();
    };
    await board.interruptAll();
    expect(refused).toEqual(["Every task is ending"]);
    expect(board.laneIds()).toEqual([]);
    expect(made).toHaveLength(1);
    // Afterwards a hand-over works again.
    await board.handOver((l) => l.start("later"));
    expect(board.laneIds()).toEqual(["t2"]);
  });
  it("interruptAll closes the idle lane too: the next start gets a new one, made for the new engine", async () => {
    const { board, made } = harness();
    const spare = board.focused();
    const close = vi.fn(async () => {});
    spare.close = close;
    await board.interruptAll();
    expect(close).toHaveBeenCalledTimes(1);
    expect(board.focused()).not.toBe(spare);
    expect(made).toHaveLength(2);
  });
  it("focus refuses ids that aren't a lane id (P1), and never a lane that is gone", async () => {
    const { board } = harness();
    await board.start("intro");
    for (const bad of ["__proto__", "constructor", "../t1", "x".repeat(201), 3 as unknown as string]) {
      await expect(board.focus(bad)).rejects.toThrow("Unknown task");
    }
    await board.finish();
    await expect(board.focus("t1")).rejects.toThrow("Unknown task");
  });
  it("a focus written in tasks.json that names no open lane reads as the start view", async () => {
    const { board } = harness({ lanes: [task("a")], focus: "gone" });
    await board.restore();
    expect(board.laneIds()).toEqual(["a"]);
    expect(board.focusedId()).toBeNull();
  });
  it("a bad or repeated task id never opens a lane", async () => {
    const made: string[] = [];
    const ids = ["t1", "t1", "../x"];
    const board = new TaskBoard({
      file: { load: async () => ({ version: 1, current: null, actions: {} }), save: async () => {} },
      newLane: (id) => {
        made.push(id);
        return { id, start: async () => {}, ask: async () => {}, isBusy: () => false, view: async () => ({ current: { id } as never, actions: {}, notes: [] }), finish: async () => true, cancel: () => {}, interrupt: async () => {}, close: async () => {} };
      },
      newId: () => ids.shift() ?? "never",
      changed: () => {},
    });
    await board.start("a");
    await expect(board.start("b")).rejects.toThrow("Could not make a task id");
    await expect(board.start("c")).rejects.toThrow("Could not make a task id");
    expect(board.laneIds()).toEqual(["t1"]);
    expect(made).toEqual(["t1"]);
  });
  it("writing the focus never undoes a lane's change to the shared fields (one write chain)", async () => {
    const { board, store, file } = harness({ actions: { intro: "done" } });
    await board.start("intro");
    const lane = new LaneStore(store, "t1");
    const view = await lane.load();
    // A lane's save and a focus write race: neither loses the other's change.
    await Promise.all([lane.save({ ...view, actions: { ...view.actions, plan: "unfinished" } }), board.focus(null)]);
    expect(file().actions).toEqual({ intro: "done", plan: "unfinished" });
    expect(file().focus).toBeNull();
    expect(file().lanes?.map((l) => l.id)).toEqual(["t1"]);
  });
  it("per-task calls go to the focused lane only", async () => {
    const { board, made } = harness();
    await board.start("intro");
    await board.start("plan");
    const calls: string[] = [];
    for (const l of made) {
      (l as unknown as Record<string, unknown>).runningTask = async () => (calls.push(l.id), null);
      (l as unknown as Record<string, unknown>).cancel = () => calls.push(`cancel ${l.id}`);
    }
    await board.focus("t1");
    await board.runningTask();
    board.cancel();
    expect(calls).toEqual(["t1", "cancel t1"]);
  });
  it("a lane without a forwarded method refuses the call", async () => {
    const { board } = harness();
    await board.start("intro");
    expect(() => board.trailerNow()).toThrow("This task can't trailerNow");
  });
});

describe("TaskBoard start and recovery (Decisions 8, 16)", () => {
  it("interrupt ends every lane tasks.json lists, each through its own lane, and shows the start view", async () => {
    const { board, made, file } = harness({ lanes: [task("a"), task("b", { action: "plan" })], focus: "b" });
    await board.interrupt();
    expect(made.map((l) => [l.id, l.interrupted])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(board.laneIds()).toEqual([]);
    expect(file().lanes).toEqual([]);
    expect(file().focus).toBeNull();
  });
  it("lanes the file still lists after their interrupt failed end unfinished in the file", async () => {
    const { board, made, file } = harness({ lanes: [task("a"), task("b", { action: "plan" })], focus: "a" });
    await board.restore();
    for (const l of made) l.interrupt = async () => Promise.reject(new Error("engine gone"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await board.interrupt();
    error.mockRestore();
    expect(file().lanes).toEqual([]);
    expect(file().focus).toBeNull();
    expect(file().actions).toEqual({ intro: "unfinished", plan: "unfinished" });
  });
  it("a `current` left by plain mode or an older app becomes a lane, then ends with the others", async () => {
    const { board, file } = harness({ current: task("old", { action: "plan" }), lanes: [task("a")] });
    await board.restore();
    expect(board.laneIds()).toEqual(["old", "a"]);
    expect(file().current).toBeNull();
    expect(file().lanes?.map((l) => l.id)).toEqual(["old", "a"]);
  });
  it("a `current` that can't become a lane (bad id, board full) ends unfinished", async () => {
    const { board, file } = harness({ current: task("../old", { action: "plan" }) });
    await board.restore();
    expect(board.laneIds()).toEqual([]);
    expect(file().current).toBeNull();
    expect(file().actions).toEqual({ plan: "unfinished" });
  });
  it("whenNoTask runs only with no task open, and no lane starts while it runs", async () => {
    const { board, made } = harness();
    let release!: () => void;
    const order: string[] = [];
    const ran = board.whenNoTask(async () => {
      order.push("fn start");
      await new Promise<void>((r) => (release = r));
      order.push("fn end");
    });
    const started = board.start("intro").then(() => order.push("started"));
    await vi.waitFor(() => expect(order).toEqual(["fn start"]));
    expect(made).toEqual([]);
    release();
    expect(await ran).toBe(true);
    await started;
    expect(order).toEqual(["fn start", "fn end", "started"]);
    expect(await board.whenNoTask(async () => {})).toBe(false);
  });
});

type Timer = { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
/** A held clock: timers fire only when the test calls them. */
function heldTimers() {
  const armed = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  const timer: Timer = {
    set: (fn, ms) => (armed.set(++n, { fn, ms }), n),
    clear: (h) => void armed.delete(h as number),
  };
  return { timer, armed, fireAll: () => [...armed.entries()].forEach(([h, t]) => (armed.delete(h), t.fn())) };
}
const setOn = (l: object, name: string, fn: unknown) => ((l as Record<string, unknown>)[name] = fn);

describe("board edge cases (parallel spec §10)", () => {
  it("switchScope never closes a lane; focus goes to that scope's newest lane or the start view (Decision 5)", async () => {
    const { board, made, file } = harness();
    await board.start("intro", undefined, "s1");
    await board.start("plan", undefined, "s2");
    await board.start("more", undefined, "s1");
    expect(await board.switchScope("s1")).toBe(true);
    expect(file().focus).toBe("t3");
    expect(file().open).toBe("s1");
    expect(made.some((l) => l.closed)).toBe(false);
    await board.switchScope("s3");
    expect(file().focus).toBeNull();
    expect(file().open).toBe("s3");
    await board.switchScope(null);
    expect("open" in file()).toBe(false);
    expect(board.laneIds()).toEqual(["t1", "t2", "t3"]);
  });
  it("switchScope(null) focuses the newest task that runs outside any scope", async () => {
    const { board, file } = harness();
    await board.start("intro", undefined, "_app");
    await board.start("plan", undefined, "s1");
    await board.switchScope(null);
    expect(file().focus).toBe("t1");
  });
  it("switchScope refuses a bad or unknown scope, and any scope in a harness without scopes", async () => {
    const { board } = harness({}, { scopes: { scoped: true, exists: async (id) => id === "s1" } });
    await expect(board.switchScope("../x")).rejects.toThrow("Unknown scope");
    await expect(board.switchScope("s2")).rejects.toThrow("Unknown scope");
    expect(await board.switchScope("s1")).toBe(true);
    const plain = harness({}, { scopes: { scoped: false } });
    await expect(plain.board.switchScope("s1")).rejects.toThrow("This harness has no scopes");
  });
  it("chatScope is the focused task's own scope, wherever the open scope is", async () => {
    const { board } = harness();
    await board.start("intro", undefined, "s1");
    await board.switchScope("s2");
    await board.focus("t1");
    expect(await board.chatScope()).toBe("s1");
  });

  it("checkpointAllBeforeMove runs each lane's checkpoint one at a time; a failed one is logged and the rest go on", async () => {
    const { board, made } = harness();
    await board.start("a");
    await board.start("b");
    await board.start("c");
    const order: string[] = [];
    let inFlight = 0;
    for (const l of made)
      setOn(l, "checkpointBeforeMove", async () => {
        inFlight++;
        expect(inFlight).toBe(1);
        await Promise.resolve();
        order.push(l.id);
        inFlight--;
        if (l.id === "t2") throw new Error("engine gone");
      });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await board.checkpointAllBeforeMove();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    expect(order).toEqual(["t1", "t2", "t3"]);
  });
  it("a move with two lanes completes: their checkpoint turns run through the gate before it pauses the queues", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const { board, made } = harness({}, { gate });
    await board.start("a");
    await board.start("b");
    const ran: string[] = [];
    // As gatedTurns does: each checkpoint is a turn that waits for a slot.
    for (const l of made)
      setOn(l, "checkpointBeforeMove", async () => {
        const release = await gate.acquire("tasks", { id: l.id });
        ran.push(l.id);
        release();
      });
    await board.checkpointAllBeforeMove();
    expect(ran).toEqual(["t1", "t2"]);
    // The queues wait while the folder moves; a new turn queues.
    expect(gate.paused()).toEqual({ reason: "folder-move" });
    let started = false;
    const later = gate.acquire("tasks", { id: "t1" }).then((r) => ((started = true), r()));
    await Promise.resolve();
    expect(started).toBe(false);
    board.moveEnded();
    await later;
    expect(gate.paused()).toBeNull();
  });
  it("a move while the queues are paused out of quota completes: no checkpoint turn waits on the pause", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const { board, made } = harness({}, { gate });
    await board.start("a");
    await board.start("b");
    const ran: string[] = [];
    for (const l of made)
      setOn(l, "checkpointBeforeMove", async () => {
        const release = await gate.acquire("tasks", { id: l.id });
        ran.push(l.id);
        release();
      });
    // Codex and OpenCode report no reset: this pause waits for the person's Resume.
    gate.pause({ reason: "out-of-quota" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await board.checkpointAllBeforeMove();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("no checkpoint before the move"));
    error.mockRestore();
    expect(ran).toEqual([]);
    board.moveEnded();
    expect(gate.paused()).toEqual({ reason: "out-of-quota" });
  });
  it("a move never replaces or lifts an out-of-quota pause", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const { board } = harness({}, { gate });
    gate.pause({ reason: "out-of-quota" });
    await board.checkpointAllBeforeMove();
    board.moveEnded();
    expect(gate.paused()).toEqual({ reason: "out-of-quota" });
  });

  it("interruptAll ends every lane (engine switch) and drops the queued turns first", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const { board, made } = harness({}, { gate });
    await board.start("a");
    await board.start("b");
    const order: string[] = [];
    const running = await gate.acquire("tasks", { id: "t1" });
    const queued = gate.acquire("tasks", { id: "t2" }).then(
      () => order.push("started"),
      (err: Error) => order.push(err.message),
    );
    for (const l of made) {
      const end = l.interrupt.bind(l);
      l.interrupt = async () => {
        order.push(`interrupt ${l.id}`);
        // The running turn's slot frees as its lane ends: the queued one must already be gone.
        if (l.id === "t1") running();
        await end();
      };
    }
    await board.interruptAll();
    await queued;
    // Dropped before any lane ended: the slot t1's end freed never started it.
    expect(order).toEqual(["The queued turn was cancelled", "interrupt t1", "interrupt t2"]);
    expect(gate.running("tasks")).toBe(0);
    expect(made.filter((l) => l.started.length > 0).every((l) => l.closed)).toBe(true);
    expect(board.laneIds()).toEqual([]);
  });
  it("engineChanged lifts the old engine's pause and takes the new caps and hold", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const setCaps = vi.spyOn(gate, "setCaps");
    const { board } = harness({}, { gate });
    gate.pause({ reason: "out-of-quota", resetsAt: "2099-01-01T00:00:00Z" });
    board.engineChanged({ tasks: 3, jobs: 1 }, { singleSession: true });
    expect(gate.paused()).toBeNull();
    expect(setCaps).toHaveBeenCalledWith({ tasks: 3, jobs: 1 }, { singleSession: true });
    gate.dispose();
  });

  it("closeAll (quit) cancels and closes every lane, drops the queues, disarms the timers, and leaves tasks.json as is", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const dispose = vi.spyOn(gate, "dispose");
    const { board, made, file } = harness({}, { gate });
    const clock = heldTimers();
    const sleep = vi.fn(async () => {});
    board.setIdleSleep({ ms: 600_000, timer: clock.timer, sleep });
    await board.start("a");
    await board.start("b");
    board.laneWaiting("t1");
    const calls: string[] = [];
    for (const l of made) {
      l.cancel = () => calls.push(`cancel ${l.id}`);
      l.close = async () => void calls.push(`close ${l.id}`);
    }
    const running = await gate.acquire("tasks", { id: "t1" });
    const queued = gate.acquire("tasks", { id: "t2" }).catch((err: Error) => err.message);
    const before = structuredClone(file());
    await board.closeAll();
    expect(await queued).toBe("The queued turn was cancelled");
    expect(calls).toEqual(["cancel t1", "cancel t2", "close t1", "close t2"]);
    expect(dispose).toHaveBeenCalled();
    expect(clock.armed.size).toBe(0);
    expect(file()).toEqual(before);
    running();
  });

  it("a waiting ACP lane sleeps after 10 minutes; a new turn disarms it (spec §4, open question 7)", async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const sleep = vi.fn(async () => {});
    const { board } = harness();
    board.setIdleSleep({ ms: 600_000, timer: { set: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => {} }, sleep });
    await board.start("a");
    board.laneWaiting("t1");
    expect(timers.at(-1)?.ms).toBe(600_000);
    timers.at(-1)!.fn();
    expect(sleep).toHaveBeenCalledWith("t1");
  });
  it("laneActive and laneEnded disarm a lane's sleep; a lane busy when its timer fires is left awake", async () => {
    const clock = heldTimers();
    const sleep = vi.fn(async () => {});
    const { board, made } = harness();
    board.setIdleSleep({ ms: 600_000, timer: clock.timer, sleep });
    await board.start("a");
    await board.start("b");
    await board.start("c");
    board.laneWaiting("t1");
    board.laneActive("t1");
    board.laneWaiting("t2");
    await board.laneEnded("t2");
    expect(clock.armed.size).toBe(0);
    board.laneWaiting("t3");
    made[2].status = "running";
    clock.fireAll();
    expect(sleep).not.toHaveBeenCalled();
    board.laneWaiting("nope");
    expect(clock.armed.size).toBe(0);
  });
  it("on an engine held at one session, a turn first puts every other lane to sleep, one between two turns of an operation too", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 }, { hold: { singleSession: true } });
    const { board, made } = harness({}, { gate, hold: { singleSession: true } });
    const slept: string[] = [];
    board.setIdleSleep({ ms: 600_000, timer: heldTimers().timer, sleep: async (id) => void slept.push(id) });
    await board.start("a");
    await board.start("b");
    await board.start("c");
    // t3 is busy with an operation (a checkpoint ran, its follow-up comes next) but holds no slot: not in a turn.
    made[2].status = "running";
    const release = await gate.acquire("tasks", { id: "t1" });
    expect(slept).toEqual(["t2", "t3"]);
    release();
    // A sleep that fails fails the turn: two engine processes must never run at once.
    board.setIdleSleep({ ms: 600_000, timer: heldTimers().timer, sleep: async () => Promise.reject(new Error("still running")) });
    await expect(gate.acquire("tasks", { id: "t1" })).rejects.toThrow("still running");
    // Another engine: no hook.
    board.engineChanged({ tasks: 2, jobs: 1 }, {});
    expect(gate.tryAcquire("tasks", { id: "t1" })).not.toBeNull();
  });
});


describe("summaries (parallel spec §9.1)", () => {
  it("lists every open task with its state; queued wins over running", async () => {
    const { board } = harness();
    await board.start("intro");
    await board.start("plan");
    board.setQueued((id) => id === "t2");
    const list = await board.summaries({ label: (t) => t.action ?? "Question" });
    expect(list).toEqual([
      expect.objectContaining({ id: "t1", state: "waiting", waitingFor: "message", action: "intro", label: "intro", tokens: 0, scope: "main" }),
      expect.objectContaining({ id: "t2", state: "queued", action: "plan", focused: true }),
    ]);
    expect(list[0]).not.toHaveProperty("focused");
    expect(list[1]).not.toHaveProperty("waitingFor");
  });

  it("names what a waiting task waits for, its phase, tokens and conflicts, and nothing else of the task", async () => {
    const lanes = [
      task("c", { startedAt: "2026-10-28T10:02:00Z", status: "running", scope: "s1", tokens: 1200, conflict: ["spec.md"] }),
      task("a", {
        startedAt: "2026-10-28T10:00:00Z",
        action: undefined,
        question: "a secret question",
        session: { id: "sess", engine: "claude" } as never,
        pendingInput: { blockId: "b", name: "choices" } as never,
        phase: { id: "draft", startedAt: "2026-10-28T10:00:00Z" },
      }),
      task("b", { startedAt: "2026-10-28T10:01:00Z", phaseProposal: { to: "review", reason: "done" } }),
    ];
    const { board } = harness({ lanes, focus: "b" });
    await board.restore();
    const list = await board.summaries({ label: (t) => t.action ?? "Question" });
    expect(list.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(list[0]).toEqual({ id: "a", scope: "main", action: null, label: "Question", state: "waiting", waitingFor: "answer", phase: "draft", startedAt: "2026-10-28T10:00:00Z", tokens: 0 });
    expect(list[1]).toMatchObject({ waitingFor: "phase", focused: true });
    expect(list[2]).toEqual({ id: "c", scope: "s1", action: "intro", label: "intro", state: "running", startedAt: "2026-10-28T10:02:00Z", tokens: 1200, conflict: ["spec.md"] });
    expect(JSON.stringify(list)).not.toMatch(/secret|sess/);
  });

  it("leaves out a lane the board no longer holds and a lane with no task yet", async () => {
    const { board, file, store, holds } = harness();
    await board.start("intro");
    let release!: () => void;
    holds.set("plan", new Promise<void>((r) => (release = r)));
    const starting = board.start("plan");
    await vi.waitFor(() => expect(board.laneIds()).toEqual(["t1", "t2"]));
    // t2's task isn't in tasks.json yet; a stray lane the board doesn't hold is ignored too.
    await store.save({ ...file(), lanes: [...(file().lanes ?? []), task("stray")] });
    expect((await board.summaries({ label: () => "x" })).map((s) => s.id)).toEqual(["t1"]);
    release();
    await starting;
    expect((await board.summaries({ label: () => "x" })).map((s) => s.id)).toEqual(["t1", "t2"]);
  });

  it("isFocused names only the focused lane; none at the start view", async () => {
    const { board } = harness();
    await board.start("intro");
    await board.start("plan");
    expect([board.isFocused("t1"), board.isFocused("t2")]).toEqual([false, true]);
    await board.focus(null);
    expect([board.isFocused("t1"), board.isFocused("t2")]).toEqual([false, false]);
  });
});
