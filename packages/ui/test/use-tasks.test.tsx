// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessClient, TasksState } from "../src/client";
import { useTasks } from "../src/parallel/useTasks";

afterEach(cleanup);

const state = (label: string): TasksState => ({
  tasks: [{ id: label, scope: "main", action: "intro", label, state: "running", startedAt: "2026-10-28T10:00:00Z", tokens: 0 }],
  caps: { tasks: 2, jobs: 1 },
});

/** A `client.tasks` whose `list` replies only when the test says so, and whose pushes the test sends. */
function tasksClient() {
  const listeners = new Set<(s: TasksState) => void>();
  const replies: ((s: TasksState) => void)[] = [];
  const off = vi.fn();
  const tasks = {
    list: vi.fn(() => new Promise<TasksState>((resolve) => replies.push(resolve))),
    onChange: vi.fn((l: (s: TasksState) => void) => {
      listeners.add(l);
      return () => {
        off();
        listeners.delete(l);
      };
    }),
  };
  return {
    client: { tasks } as unknown as HarnessClient,
    tasks,
    off,
    listeners,
    push: (s: TasksState) => act(() => listeners.forEach((l) => l(s))),
    reply: (s: TasksState) => act(async () => replies.shift()!(s)),
  };
}

describe("useTasks (parallel spec §9.1)", () => {
  it("disabled: asks nothing and stays null", () => {
    const f = tasksClient();
    const { result } = renderHook(() => useTasks(f.client, false));
    expect(result.current).toBeNull();
    expect(f.tasks.list).not.toHaveBeenCalled();
    expect(f.tasks.onChange).not.toHaveBeenCalled();
  });

  it("a push that arrives before a slow list keeps the pushed state", async () => {
    const f = tasksClient();
    const { result } = renderHook(() => useTasks(f.client, true));
    f.push(state("pushed"));
    expect(result.current).toEqual(state("pushed"));
    await f.reply(state("stale"));
    expect(result.current).toEqual(state("pushed"));
  });

  it("the list answers when no push came first", async () => {
    const f = tasksClient();
    const { result } = renderHook(() => useTasks(f.client, true));
    expect(result.current).toBeNull();
    await f.reply(state("listed"));
    expect(result.current).toEqual(state("listed"));
  });

  it("enabled → false unsubscribes and resets to null; back to true lists and subscribes again", async () => {
    const f = tasksClient();
    const { result, rerender } = renderHook(({ on }) => useTasks(f.client, on), { initialProps: { on: true } });
    await f.reply(state("first"));
    expect(result.current).toEqual(state("first"));

    rerender({ on: false });
    expect(f.off).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
    expect(result.current).toBeNull();

    rerender({ on: true });
    expect(f.tasks.list).toHaveBeenCalledTimes(2);
    expect(f.tasks.onChange).toHaveBeenCalledTimes(2);
    expect(f.listeners.size).toBe(1);
    await f.reply(state("again"));
    expect(result.current).toEqual(state("again"));
  });

  it("unmount unsubscribes, and a list resolving after it sets nothing", async () => {
    const f = tasksClient();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useTasks(f.client, true));
    unmount();
    expect(f.off).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
    await f.reply(state("late"));
    expect(result.current).toBeNull();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("a list that fails leaves the state null and pushes still land", async () => {
    const f = tasksClient();
    f.tasks.list.mockImplementationOnce(() => Promise.reject(new Error("No parallel tasks")));
    const { result } = renderHook(() => useTasks(f.client, true));
    await act(async () => {});
    expect(result.current).toBeNull();
    f.push(state("pushed"));
    expect(result.current).toEqual(state("pushed"));
  });
});
