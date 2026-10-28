import { describe, expect, it, vi } from "vitest";
import { LaneStore } from "../src/main/lane-store";
import { TaskBoard, type LaneHandle } from "../src/main/task-board";
import type { CurrentTask, TasksFile } from "../src/main/task-store";

/** A lane double with the TaskManager surface the board uses; state lives in the shared memory file through `file`. */
function harness(init: Partial<TasksFile> = {}) {
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
    async start(action: string) {
      if (action === "refused") throw new Error("That mode isn't offered");
      this.started.push(action);
      this.status = "running";
      // A test holds this action's first turn open.
      await holds.get(action);
      this.status = "waiting";
      file = { ...file, lanes: [...(file.lanes ?? []), { id: this.id, action, status: "waiting", startedAt: "2026-10-28T10:00:00Z", turns: 1 }] };
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
  it("a start that leaves no task (refused, failed) drops its lane and shows the start view", async () => {
    const { board, made, file } = harness();
    await board.start("intro");
    await expect(board.start("refused")).rejects.toThrow("That mode isn't offered");
    expect(board.laneIds()).toEqual(["t1"]);
    expect(file().focus).toBeNull();
    expect(made[0].closed).toBe(false);
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
