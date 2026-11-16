// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../mods/home/test/home-block";
import { HarnessApp } from "../src";
import type { ParallelInfo, TaskSummary } from "../src/client";
import { HhTheme } from "../src/guide";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const parallel: ParallelInfo = { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false };
const summary = (id: string, extra: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  scope: "main",
  action: "intro",
  label: `Task ${id}`,
  state: "waiting",
  startedAt: "2026-10-28T10:00:00Z",
  tokens: 0,
  ...extra,
});

/** The demo with two open tasks, t1 on screen at 44% of its context, and an ended task t9 in History. */
async function openTask() {
  const client = new FakeClient(ready);
  client.state.parallel = parallel;
  client.state.actions = { intro: { label: "Intro", cost: "light" } };
  client.tasksState = { tasks: [summary("t1", { focused: true }), summary("t2", { state: "running" })], caps: parallel.caps };
  client.tasks = { current: { id: "t1", action: "intro", status: "waiting", context: { used: 88_000, cap: 200_000 } }, actions: {}, notes: [] };
  client.historyGroups = [
    { taskId: "t9", actionId: null, noteTitle: "Old plan", start: "s0", end: "abc", date: "2026-10-10T12:00:00.000Z", changes: [], entries: [] },
  ];
  render(
    <HhTheme>
      <HarnessApp client={client} locales={{ en: {} }} />
    </HhTheme>,
  );
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("button", { name: "Task t1" });
  return client;
}

const openMenu = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });

describe("the task bar (task view one column, T3)", () => {
  it("is the one banner: harness, task switcher, status and context; no History, no New task, no gear", async () => {
    await openTask();
    const banners = screen.getAllByRole("banner");
    expect(banners).toHaveLength(1);
    const bar = banners[0];
    expect(bar.textContent).toContain("Demo");
    expect(within(bar).getByRole("button", { name: "Task t1" }).getAttribute("aria-haspopup")).toBe("menu");
    expect(bar.textContent).toContain("Waiting for you");
    expect(within(bar).getByRole("button", { name: "Context 44%" })).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: "History" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "New task" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Settings" })).toBeNull();
    // The title shows once on screen: in the switcher, not in a header of its own.
    expect(screen.queryByRole("heading", { level: 1, name: "Task t1" })).toBeNull();
  });

  it("the switcher lists the open tasks, the recent ones and New task, and switches", async () => {
    const client = await openTask();
    openMenu(screen.getByRole("button", { name: "Task t1" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Task t2/ })).toBeTruthy();
    expect(await within(menu).findByRole("menuitem", { name: /Old plan/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Task t2/ }));
    await waitFor(() => expect(client.tasks.focus).toHaveBeenCalledWith("t2"));
    openMenu(screen.getByRole("button", { name: "Task t1" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "New task" }));
    await waitFor(() => expect(client.tasks.focus).toHaveBeenCalledWith(null));
  });
});
