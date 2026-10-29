import { describe, expect, it, vi } from "vitest";
import { type TasksIpcHost, restoreTaskArgs, tasksIpc, undoRefusalOf, validTaskId } from "../src/main/tasks-ipc";

function fakeHost(paused: { reason: string } | null = null) {
  const h = {
    tasksState: vi.fn(async () => ({ tasks: [], caps: { tasks: 2, jobs: 1 } })),
    board: { focus: vi.fn(async () => {}) },
    gate: { drop: vi.fn(() => "queued text"), paused: vi.fn(() => paused), resume: vi.fn() },
  } satisfies TasksIpcHost;
  return h;
}

describe("the task inbox channels (parallel spec §9.1, P1)", () => {
  it("plain mode: every channel refuses with No parallel tasks", async () => {
    const ipc = tasksIpc(() => null);
    expect(() => ipc.list()).toThrow("No parallel tasks");
    expect(() => ipc.focus("t1")).toThrow("No parallel tasks");
    expect(() => ipc.cancelQueued("t1")).toThrow("No parallel tasks");
    expect(() => ipc.resume()).toThrow("No parallel tasks");
  });

  it("ids: a string of 1..200 characters; anything else is refused before the board sees it", async () => {
    const h = fakeHost();
    const ipc = tasksIpc(() => h);
    for (const bad of ["", "x".repeat(201), 7, undefined, { id: "t1" }]) {
      expect(() => ipc.focus(bad)).toThrow("Invalid task");
      expect(() => ipc.cancelQueued(bad)).toThrow("Invalid task");
    }
    expect(h.board.focus).not.toHaveBeenCalled();
    expect(h.gate.drop).not.toHaveBeenCalled();
    await ipc.focus(null);
    await ipc.focus("x".repeat(200));
    expect(h.board.focus.mock.calls).toEqual([[null], ["x".repeat(200)]]);
    expect(ipc.cancelQueued("t1")).toBe("queued text");
    expect(await ipc.list()).toEqual({ tasks: [], caps: { tasks: 2, jobs: 1 } });
    expect(validTaskId("t1")).toBe("t1");
  });

  it("Resume lifts an out-of-quota pause only, never a folder move's", () => {
    const quota = fakeHost({ reason: "out-of-quota" });
    tasksIpc(() => quota).resume();
    expect(quota.gate.resume).toHaveBeenCalledTimes(1);
    const move = fakeHost({ reason: "folder-move" });
    tasksIpc(() => move).resume();
    expect(move.gate.resume).not.toHaveBeenCalled();
  });

  it("undo's arguments: a valid id, and includeShared only as a boolean (absent: false)", () => {
    expect(restoreTaskArgs("t1", undefined)).toEqual({ id: "t1", includeShared: false });
    expect(restoreTaskArgs("t1", true)).toEqual({ id: "t1", includeShared: true });
    expect(() => restoreTaskArgs("t1", "yes")).toThrow("Invalid choice");
    expect(() => restoreTaskArgs("t1", 1)).toThrow("Invalid choice");
    expect(() => restoreTaskArgs("", false)).toThrow("Invalid task");
    expect(() => restoreTaskArgs("x".repeat(201), false)).toThrow("Invalid task");
  });

  it("a refused undo tells the window its reason and file, never the other tasks' ids", () => {
    expect(undoRefusalOf({ ok: false, reason: "running", path: "a.md" })).toEqual({ reason: "running", path: "a.md" });
    expect(undoRefusalOf({ ok: false, reason: "uncommitted", path: "a.md" })).toEqual({ reason: "uncommitted", path: "a.md" });
    expect(undoRefusalOf({ ok: false, reason: "later", path: "a.md", tasks: ["t2"], outside: 1 })).toEqual({ reason: "later", path: "a.md", by: "task" });
    expect(undoRefusalOf({ ok: false, reason: "later", path: "a.md", tasks: [], outside: 2 })).toEqual({ reason: "later", path: "a.md", by: "outside" });
    expect(undoRefusalOf({ ok: false, reason: "too-far" })).toEqual({ reason: "too-far" });
    expect(undoRefusalOf({ ok: false, reason: "nothing" })).toEqual({ reason: "nothing" });
  });
});
