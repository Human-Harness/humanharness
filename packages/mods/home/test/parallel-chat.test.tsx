// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render, renderIn } from "./home-block";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../../../ui/src";
import type { HarnessClient, ParallelInfo, TaskSummary, TasksState } from "../../../ui/src/client";
import { FakeClient } from "../../../ui/test/fake-client";

afterEach(cleanup);
/** Radix opens a menu on pointer down. */
const openMenu = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
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
  // The switcher's menu is a Radix piece that reads the theme (task view one column).
  await renderIn("en", <HarnessApp client={c} />, { theme: true });
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
    await screen.findByRole("button", { name: "Task a" });
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

  it("the bar's switcher names the focused task; its New task asks for the start view, and the chat follows once main took it", async () => {
    const c = client(true, tasksOf("a", "a"));
    c.state.actions = { intro: { label: "Intro", phases: [{ id: "draft", label: "Drafting" }] } } as never;
    c.tasksState = { tasks: [summary("a", { focused: true, phase: "draft" })], caps: { tasks: 2, jobs: 1 } };
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    // The one bar (task view one column): the title once, as the switcher; New task is in its menu.
    const switcher = await screen.findByRole("button", { name: "Task a" });
    expect(screen.queryByRole("heading", { level: 1, name: "Task a" })).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    openMenu(switcher);
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "New task" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith(null));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("the inbox's New task brings the start view's chat too", async () => {
    const c = client(true, tasksOf("a", "a"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // The rail's Inbox ("Inbox, N waiting") opens the Inbox page.
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
    fireEvent.click(within(inboxScreen).getByRole("button", { name: "Cancel" }));
    // The text waits in the chat's box, which the Inbox page covers: back to it through the rail's Tasks.
    await waitFor(() => expect(api(c).cancelQueued).toHaveBeenCalled());
    fireEvent.click(within(screen.getByRole("navigation", { name: "App" })).getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(box().value).toBe("Draft the intro"));
    act(() => c.tasks.set(tasksOf("b", "a", "b")));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(box().value).toBe("Draft the intro");
  });
});

describe("the task switcher (task view one column)", () => {
  it("an open task picked in the switcher asks main to focus that task, and the chat follows main", async () => {
    const c = client(true, tasksOf("a", "a", "b"));
    const load = vi.spyOn(c, "loadChat");
    await open(c);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    openMenu(await screen.findByRole("button", { name: "Task a" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Task b, waiting for you" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith("b"));
  });
});
