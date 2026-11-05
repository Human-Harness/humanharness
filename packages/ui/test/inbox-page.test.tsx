// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, JobSummary, TaskSummary, TasksState } from "../src/client";
import { taskGroups } from "../src/parallel/board";
import { InboxPage } from "../src/parallel/Inbox";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

describe("taskGroups", () => {
  it("splits tasks into Waiting for you (latest first), Working and Queued", () => {
    const groups = taskGroups([{ id: "a", state: "waiting" }, { id: "b", state: "running" }, { id: "c", state: "queued" }, { id: "d", state: "waiting" }, { id: "e", state: "closing" }]);
    expect([groups.waiting, groups.working, groups.queued].map((g) => g.map((s) => s.id))).toEqual([["d", "a"], ["b", "e"], ["c"]]);
  });
});

describe("InboxPage (DESIGN.md Secondary pages, stage 4a)", () => {
  afterEach(cleanup);
  let n = 0;
  const task = (label: string, state: TaskSummary["state"], extra: Partial<TaskSummary> = {}): TaskSummary => ({
    id: `t${++n}`,
    scope: "main",
    action: "intro",
    label,
    state,
    startedAt: "2026-10-28T10:00:00Z",
    tokens: 0,
    ...extra,
  });
  const waiting = (label: string, extra: Partial<TaskSummary> = {}) => task(label, "waiting", extra);
  const running = (label: string, extra: Partial<TaskSummary> = {}) => task(label, "running", extra);
  const at = "2026-10-28T09:00:00Z";
  const job = (label: string, extra: Partial<JobSummary> = {}): JobSummary => ({ id: label.toLowerCase(), label, scope: null, manual: false, running: false, ...extra });
  const needsYou = (label: string, action?: string) => job(label, { last: { status: "needs-you", summary: `${label} needs you`, at, ...(action ? { action } : {}) } });

  async function renderPage({
    tasks,
    jobs,
    actions,
    caps = { tasks: 2, jobs: 1 },
  }: {
    tasks: TaskSummary[];
    jobs?: JobSummary[];
    actions?: AppState["actions"];
    caps?: TasksState["caps"];
  }) {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.state.parallel = { caps, suggested: caps, inbox: true, notifyWaiting: false };
    if (actions) client.state.actions = actions;
    const state: TasksState = { tasks, caps };
    client.tasksState = state;
    if (jobs) {
      client.state.jobs = { jobs: jobs.map((j) => ({ id: j.id, label: j.label, manual: j.manual })) };
      client.jobsList = jobs;
    }
    const props = { onNewTask: vi.fn(), onOpened: vi.fn(), onBack: vi.fn(), onStartAction: vi.fn(() => true), onRefill: vi.fn() };
    await renderIn("en", <InboxPage client={client} state={client.state} tasks={state} {...props} />, { theme: true });
    const shown = jobs?.find((j) => j.last?.status === "needs-you");
    if (shown) await screen.findByText(shown.label);
    return { client, ...props };
  }
  /** A section, by its heading's name. */
  const section = (name: string) => screen.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) }).closest("section")!;

  it("is a page: the 20 title has the focus, a summary line, New task; no board switch", async () => {
    const { onNewTask } = await renderPage({ tasks: [waiting("The turn"), waiting("Engines"), running("Blocks")] });
    const page = screen.getByRole("region", { name: "Inbox" });
    expect(document.activeElement).toBe(within(page).getByRole("heading", { level: 1, name: "Inbox" }));
    expect(screen.getByText("2 waiting for you · 1 working")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("three sections, each with its count; None when empty; no jobs section without results", async () => {
    await renderPage({ tasks: [waiting("A"), waiting("B"), task("C", "queued")], jobs: [job("Sync", { manual: true })] });
    expect(screen.getByRole("heading", { level: 2, name: "Waiting for you 2 in this section" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Queued 1 in this section" })).toBeTruthy();
    expect(within(section("Working")).getByText("None")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: /^Job results/ })).toBeNull();
    // Jobs live on their own page: no Run now here.
    expect(screen.queryByRole("button", { name: /Run now/ })).toBeNull();
  });

  it("a row focuses its task, then the chat shows", async () => {
    const { client, onOpened } = await renderPage({ tasks: [waiting("The turn")] });
    fireEvent.click(screen.getByRole("button", { name: /^The turn/ }));
    expect(client.tasks.focus).toHaveBeenCalledWith("t" + n);
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
  });

  it("a row: its reason, phase, tier and progress; the task on screen says so; a queued one says when it starts", async () => {
    const actions: AppState["actions"] = {
      intro: { label: "Intro", cost: "light", tier: "deep", phases: [{ id: "read", label: "Read" }, { id: "write", label: "Write" }] },
    };
    await renderPage({
      tasks: [waiting("Asks", { waitingFor: "answer" }), running("Writes", { phase: "write", focused: true }), task("Later", "queued")],
      actions,
    });
    const asks = within(section("Waiting for you"));
    expect(asks.getByText("Has a question")).toBeTruthy();
    expect(asks.getByText("Deep")).toBeTruthy();
    const writes = within(section("Working"));
    expect(writes.getByText("Write")).toBeTruthy();
    expect(writes.getByText("On screen")).toBeTruthy();
    expect(writes.getByRole("progressbar", { name: "Phase 2 of 2" })).toBeTruthy();
    expect(writes.getByRole("button", { name: /^Writes/ }).getAttribute("aria-current")).toBe("true");
    expect(within(section("Queued")).getByText("Starts when a slot frees up · 2 tasks at once")).toBeTruthy();
  });

  it("a same-files conflict shows on its row, with the files", async () => {
    await renderPage({ tasks: [running("Blocks", { conflict: ["notes/a.md"] })] });
    const row = within(section("Working")).getByRole("button", { name: /^Blocks/ });
    expect(row.textContent).toContain("Another task changed the same files");
    expect(row.textContent).toContain("notes/a.md");
  });

  it("a queued row's Cancel gives the focused task's text back; another task's text never", async () => {
    const { client, onRefill } = await renderPage({ tasks: [task("Mine", "queued", { focused: true }), task("Other", "queued")] });
    client.tasks.cancelQueued.mockResolvedValueOnce("my text").mockResolvedValueOnce("other text");
    const [mine, other] = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(mine);
    await waitFor(() => expect(onRefill).toHaveBeenCalledWith("my text"));
    fireEvent.click(other);
    await waitFor(() => expect(client.tasks.cancelQueued).toHaveBeenCalledTimes(2));
    expect(onRefill).toHaveBeenCalledTimes(1);
  });

  it("job results that wait for you: Start runs the declared action; one turned off doesn't show", async () => {
    const actions: AppState["actions"] = { intro: { label: "Intro", cost: "light" }, implement: { label: "Implement", cost: "light" } };
    const { onStartAction, onOpened } = await renderPage({
      tasks: [],
      jobs: [needsYou("Sync", "implement"), job("Digest", { paused: "off", last: { status: "needs-you", summary: "Off", at } }), job("Fine", { last: { status: "ok", summary: "Ok", at } })],
      actions,
    });
    const results = within(section("Job results for you"));
    expect(results.getAllByRole("listitem")).toHaveLength(1);
    expect(results.getByText("Needs you")).toBeTruthy();
    expect(results.getByText("Sync needs you")).toBeTruthy();
    fireEvent.click(results.getByRole("button", { name: "Start" }));
    expect(onStartAction).toHaveBeenCalledWith("implement", null);
    expect(onOpened).toHaveBeenCalled();
  });

  it("a Start that can't go through says so and keeps the page", async () => {
    const actions: AppState["actions"] = { implement: { label: "Implement", cost: "light" } };
    const { onStartAction, onOpened } = await renderPage({ tasks: [], jobs: [needsYou("Sync", "implement")], actions });
    onStartAction.mockReturnValueOnce(false);
    fireEvent.click(within(section("Job results")).getByRole("button", { name: "Start" }));
    expect(within(section("Job results")).getByRole("alert").textContent).toBe("Couldn't start it now.");
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("no Start for an action the harness doesn't declare", async () => {
    await renderPage({ tasks: [], jobs: [needsYou("Sync", "ghost")] });
    expect(within(section("Job results")).queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("Escape goes back, but not from inside a field that handles it", async () => {
    const { onBack } = await renderPage({ tasks: [waiting("Write A")] });
    const page = screen.getByRole("region", { name: "Inbox" });
    const field = document.createElement("input");
    page.appendChild(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
    field.remove();
    fireEvent.keyDown(within(page).getByRole("button", { name: /^Write A/ }), { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
