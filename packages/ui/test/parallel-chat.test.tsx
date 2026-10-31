// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { HarnessClient, ParallelInfo, TaskSummary, TasksState } from "../src/client";
import { TaskStrip } from "../src/parallel/TaskStrip";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const AT = "2026-10-28T10:00:00Z";

const summary = (id: string, extra: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  scope: "main",
  action: "intro",
  label: `Task ${id}`,
  state: "waiting",
  startedAt: AT,
  tokens: 0,
  ...extra,
});
const parallel: ParallelInfo = { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false };
const tasksOf = (focused: string | null, ...ids: string[]): TasksState => ({
  tasks: ids.map((id) => summary(id, id === focused ? { focused: true } : {})),
  caps: { tasks: 2, jobs: 1 },
});

function client(board: boolean, tasks?: TasksState) {
  const c = new FakeClient(ready);
  if (board) c.state.parallel = parallel;
  if (tasks) c.tasksState = tasks;
  return c;
}
/** `client.tasks`'s methods sit on the getter's prototype. */
const api = (c: FakeClient) => Object.getPrototypeOf(c.tasks) as FakeClient["tasks"];
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
}
const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("one chat per open task (parallel spec §6, Decision 6)", () => {
  it("D0: without state.parallel the chat loads once, a tasks change remounts nothing, and there is no task strip", async () => {
    const c = client(false);
    const load = vi.spyOn(c, "loadChat");
    const list = vi.spyOn(api(c), "list");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    act(() => c.tasks.set(tasksOf("b", "a", "b")));
    await new Promise((r) => setTimeout(r, 20));
    expect(load).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Task on screen" })).toBeNull();
  });

  it("board: focus moving to another open task (an inbox row, a notification click in main) remounts the chat; a task this window just started does not", async () => {
    const c = client(true, tasksOf("a", "a", "b"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await screen.findByRole("group", { name: "Task on screen" });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // Main moved the focus to b, which was already open: the chat becomes b's.
    act(() => c.tasks.set(tasksOf("b", "a", "b")));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    // A new lane takes the focus (its task not saved yet: no focused row), then shows up focused: the chat stays.
    act(() => c.tasks.set(tasksOf(null, "a", "b")));
    act(() => c.tasks.set(tasksOf("x", "a", "b", "x")));
    await new Promise((r) => setTimeout(r, 20));
    expect(load).toHaveBeenCalledTimes(2);
    // The same focus again: nothing.
    act(() => c.tasks.set(tasksOf("x", "a", "b", "x")));
    await new Promise((r) => setTimeout(r, 20));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("board: a turn under way replays from the load's `live`: the user line once, then the text streamed so far and after", async () => {
    const c = client(true, tasksOf("a", "a"));
    c.chat = [{ id: "u1", role: "user", text: "Plan my week", blocks: [], activities: [], at: AT }];
    vi.spyOn(c as HarnessClient, "loadChat").mockResolvedValue({
      entries: c.chat,
      live: { user: { text: "Plan my week", at: AT }, events: [{ type: "text", delta: "Monday: " }] },
    });
    await open(c);
    await screen.findByText(/Monday:/);
    act(() => c.emit({ type: "text", delta: "write." }));
    await screen.findByText(/Monday: write\./);
    expect(screen.getAllByText("Plan my week")).toHaveLength(1);
  });

  it("the task strip names the focused task and its phase; New task asks for the start view, and the chat follows once main took it", async () => {
    const c = client(true, tasksOf("a", "a"));
    c.state.actions = { intro: { label: "Intro", phases: [{ id: "draft", label: "Drafting" }] } } as never;
    c.tasksState = { tasks: [summary("a", { focused: true, phase: "draft" })], caps: { tasks: 2, jobs: 1 } };
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    const strip = await screen.findByRole("group", { name: "Task on screen" });
    expect(within(strip).getByText("Task a")).toBeTruthy();
    expect(within(strip).getByText("Drafting")).toBeTruthy();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // New task lives in the task header only (UI refresh spec §5.1).
    expect(within(strip).queryByRole("button", { name: "New task" })).toBeNull();
    fireEvent.click(within(screen.getByRole("heading", { level: 1 }).closest("header")!).getByRole("button", { name: "New task" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith(null));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("the inbox's New task brings the start view's chat too", async () => {
    const c = client(true, tasksOf("a", "a"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // The top bar's pill ("Inbox, N waiting"; the rail's Inbox is named "Inbox" too) opens the Inbox screen.
    fireEvent.click(await screen.findByRole("button", { name: /^Inbox, / }));
    fireEvent.click(within(screen.getByRole("region", { name: "Inbox" })).getByRole("button", { name: "New task" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("a half-typed follow-up for one task never shows up in another's box when the chat remounts on it", async () => {
    const c = client(true, tasksOf("a", "a", "b"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    fireEvent.change(box(), { target: { value: "half a follow-up for a" } });
    act(() => c.tasks.set(tasksOf("b", "a", "b")));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(box().value).toBe("");
  });

  it("a queued message the inbox put back stays in the box when the chat then remounts on another task", async () => {
    const c = client(true, { tasks: [summary("a", { focused: true, state: "queued" }), summary("b")], caps: { tasks: 1, jobs: 1 } });
    api(c).cancelQueued.mockResolvedValueOnce("Draft the intro");
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    fireEvent.click(await screen.findByRole("button", { name: /^Inbox, / }));
    const inboxScreen = screen.getByRole("region", { name: "Inbox" });
    fireEvent.click(within(inboxScreen).getByRole("button", { name: "List" }));
    fireEvent.click(within(inboxScreen).getByRole("button", { name: "Cancel" }));
    // The text waits in the chat's box, which the Inbox screen covers: back to it through the rail's Tasks.
    await waitFor(() => expect(api(c).cancelQueued).toHaveBeenCalled());
    fireEvent.click(within(screen.getByRole("navigation", { name: "App" })).getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(box().value).toBe("Draft the intro"));
    act(() => c.tasks.set(tasksOf("b", "a", "b")));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(box().value).toBe("Draft the intro");
  });
});

describe("task tabs (UI refresh spec §5.1)", () => {
  it("TaskStrip is a tab per open task; a waiting one carries a dot named for screen readers", async () => {
    const onFocus = vi.fn();
    const c = client(true);
    const tasks: TasksState = {
      tasks: [summary("a", { label: "The turn", focused: true, state: "running" }), summary("b", { label: "Engines", state: "waiting" })],
      caps: { tasks: 2, jobs: 1 },
    };
    await renderIn("en", <TaskStrip state={c.state} tasks={tasks} onFocus={onFocus} />);
    const tabs = screen.getByRole("tablist", { name: "Open tasks" });
    expect(within(tabs).getByRole("tab", { name: "The turn" }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).getByRole("tab", { name: "Engines, waiting for you" }).getAttribute("aria-selected")).toBe("false");
    fireEvent.click(within(tabs).getByRole("tab", { name: "Engines, waiting for you" }));
    expect(onFocus).toHaveBeenCalledWith("b");
    // The tab on screen asks nothing.
    fireEvent.click(within(tabs).getByRole("tab", { name: "The turn" }));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("a tab click in the app asks main to focus that task, and the chat follows main", async () => {
    const c = client(true, tasksOf("a", "a", "b"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    fireEvent.click(within(await screen.findByRole("tablist", { name: "Open tasks" })).getByRole("tab", { name: "Task b, waiting for you" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith("b"));
  });
});
