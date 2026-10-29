// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TasksState } from "../src/client";
import { useFocusEpoch } from "../src/parallel/useTasks";

afterEach(cleanup);

/** Task "a" open, focused or not (a new lane whose task isn't saved has the focus). */
const open = (focused: boolean): TasksState => ({
  tasks: [{ id: "a", scope: "main", action: "write", label: "Write", state: "waiting", startedAt: "2026-10-28T10:00:00Z", tokens: 0, ...(focused ? { focused: true as const } : {}) }],
  caps: { tasks: 2, jobs: 1 },
});

/**
 * Board mode, a start a required pre-step refused (tools spec §6.5): main's pushes as board-host-pre.test.ts sees them.
 * The chat on screen (with its "Couldn't prepare this task" card and Try again) is never swapped for another.
 */
describe("useFocusEpoch: a refused start keeps the chat on screen", () => {
  it("started from an open task's chat: the focus goes to the new lane, then back to that task; no remount", () => {
    const { result, rerender } = renderHook(({ s }) => useFocusEpoch(s), { initialProps: { s: open(true) } });
    const epoch = result.current.epoch;
    rerender({ s: open(false) });
    rerender({ s: open(true) });
    expect(result.current.epoch).toBe(epoch);
  });

  it("started from the start view with a task open: the focus stays there; no remount", () => {
    const { result, rerender } = renderHook(({ s }) => useFocusEpoch(s), { initialProps: { s: open(true) } });
    act(() => result.current.toStart());
    const epoch = result.current.epoch;
    rerender({ s: open(false) });
    rerender({ s: open(false) });
    expect(result.current.epoch).toBe(epoch);
  });
});
