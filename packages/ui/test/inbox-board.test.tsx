// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, JobSummary, TaskSummary, TasksState } from "../src/client";
import { boardColumns } from "../src/parallel/board";
import { InboxBoard } from "../src/parallel/InboxBoard";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

describe("boardColumns", () => {
  it("splits tasks into Waiting for you, Working, Queued and adds Jobs (spec §5.4)", () => {
    const cols = boardColumns({
      tasks: [{ id: "a", state: "waiting" }, { id: "b", state: "running" }, { id: "c", state: "queued" }, { id: "d", state: "waiting" }],
      jobs: [{ id: "j1" }, { id: "j2" }],
    });
    expect(cols.map((c) => [c.id, c.tone, c.items.length])).toEqual([["waiting", "orange", 2], ["working", "blue", 1], ["queued", "gray", 1], ["jobs", "violet", 2]]);
  });
  it("has no Jobs column for a harness without jobs", () => {
    expect(boardColumns({ tasks: [], jobs: null }).map((c) => c.id)).toEqual(["waiting", "working", "queued"]);
  });
});

describe("InboxBoard (UI refresh spec §5.4)", () => {
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
  const job = (label: string, extra: Partial<JobSummary> = {}): JobSummary => ({ id: label.toLowerCase(), label, scope: null, manual: false, running: false, ...extra });

  async function renderBoard({
    tasks,
    jobs,
    column,
    actions,
    caps = { tasks: 2, jobs: 1 },
  }: {
    tasks: TaskSummary[];
    jobs: JobSummary[] | null;
    column?: "jobs";
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
    const props = { onNewTask: vi.fn(), onOpened: vi.fn(), onStartAction: vi.fn(() => true), onJobSettings: vi.fn() };
    await renderIn("en", <InboxBoard client={client} state={client.state} tasks={state} {...(column ? { column } : {})} {...props} />);
    if (jobs?.length) await screen.findByText(jobs[0].label);
    return { client, ...props };
  }
  /** The cards of a column, by its heading's name. */
  const column = (name: string) => screen.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) }).closest("section")!;

  it("shows the summary line, a List / Board switch (Board first) and New task", async () => {
    const { onNewTask } = await renderBoard({ tasks: [waiting("The turn"), waiting("Engines"), running("Blocks")], jobs: [job("Sync"), job("Daily"), job("Link")] });
    expect(screen.getByRole("heading", { level: 1, name: "Inbox" })).toBeTruthy();
    expect(screen.getByText("2 waiting for you · 1 working · 3 jobs")).toBeTruthy();
    const switches = within(screen.getByRole("group", { name: "Show as" })).getAllByRole("button");
    expect(switches.map((b) => b.textContent)).toEqual(["Board", "List"]);
    expect(screen.getByRole("button", { name: "Board" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("a task card opens the task; a job card's one action runs it", async () => {
    const { client, onOpened } = await renderBoard({ tasks: [waiting("The turn")], jobs: [job("Sync", { manual: true })] });
    fireEvent.click(screen.getByRole("button", { name: /The turn/ }));
    expect(client.tasks.focus).toHaveBeenCalledWith("t" + n);
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(client.jobs.run).toHaveBeenCalledWith("sync");
  });

  it("List shows today's four sections", async () => {
    await renderBoard({ tasks: [waiting("The turn")], jobs: [] });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("region", { name: "Waiting for you" })).toBeTruthy();
    for (const name of ["Working", "Queued", "Jobs"]) expect(screen.getByRole("region", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Rail › Jobs scrolls to the Jobs column", async () => {
    await renderBoard({ tasks: [], jobs: [job("Sync")], column: "jobs" });
    expect(document.activeElement?.closest("section")?.getAttribute("aria-labelledby")).toContain("jobs");
  });

  it("Waiting shows the latest to wait first, as the list does", async () => {
    await renderBoard({ tasks: [waiting("Older"), waiting("Newer")], jobs: null });
    const board = within(column("Waiting for you")).getAllByRole("button").map((b) => b.querySelector(".hh-board-title")?.textContent);
    expect(board).toEqual(["Newer", "Older"]);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const list = within(screen.getByRole("region", { name: "Waiting for you" })).getAllByRole("button").map((b) => b.querySelector(".hh-tk-label")?.textContent);
    expect(list).toEqual(board);
  });

  it("columns carry their count; no Jobs column without jobs", async () => {
    await renderBoard({ tasks: [waiting("A"), waiting("B"), task("C", "queued")], jobs: null });
    expect(screen.getByRole("heading", { level: 2, name: "Waiting for you 2" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Queued 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: /^Jobs/ })).toBeNull();
    expect(screen.getByText("2 waiting for you · 0 working")).toBeTruthy();
  });

  it("a task card: its reason, phase, tier and progress; a queued one says when it starts", async () => {
    const actions: AppState["actions"] = {
      intro: { label: "Intro", cost: "light", tier: "deep", phases: [{ id: "read", label: "Read" }, { id: "write", label: "Write" }] },
    };
    await renderBoard({
      tasks: [waiting("Asks", { waitingFor: "answer" }), running("Writes", { phase: "write" }), task("Later", "queued")],
      jobs: null,
      actions,
    });
    const asks = within(column("Waiting for you"));
    expect(asks.getByText("Has a question")).toBeTruthy();
    expect(asks.getByText("Deep")).toBeTruthy();
    const writes = within(column("Working"));
    expect(writes.getByText("Write")).toBeTruthy();
    expect(writes.getByRole("img", { name: "Phase 2 of 2" })).toBeTruthy();
    expect(within(column("Queued")).getByText("Starts when a slot frees up · 2 tasks at once")).toBeTruthy();
  });

  it("a same-files conflict is a note in Working, with the files", async () => {
    await renderBoard({ tasks: [running("Blocks", { conflict: ["notes/a.md"] })], jobs: null });
    const note = within(column("Working")).getByRole("note");
    expect(note.textContent).toContain("Another task changed the same files");
    expect(note.textContent).toContain("notes/a.md");
  });

  it("a job card's one action: Open for a needs-you result, Resume when paused, none while it runs", async () => {
    const actions: AppState["actions"] = { intro: { label: "Intro", cost: "light" }, implement: { label: "Implement", cost: "light" } };
    const at = "2026-10-28T09:00:00Z";
    const { onStartAction, onOpened, onJobSettings } = await renderBoard({
      tasks: [],
      jobs: [
        job("Sync", { manual: true, last: { status: "needs-you", summary: "Two conflicts need you", at, action: "implement" } }),
        job("Digest", { paused: "off", last: { status: "ok", summary: "Written", at } }),
        job("Link", { manual: true, running: true }),
      ],
      actions,
    });
    const jobs = within(column("Jobs"));
    expect(jobs.getByText("Needs you")).toBeTruthy();
    expect(jobs.getByText("Two conflicts need you")).toBeTruthy();
    expect(jobs.getAllByRole("button").map((b) => b.textContent)).toEqual(["Open", "Resume"]);
    fireEvent.click(jobs.getByRole("button", { name: "Open" }));
    expect(onStartAction).toHaveBeenCalledWith("implement", null);
    expect(onOpened).toHaveBeenCalled();
    fireEvent.click(jobs.getByRole("button", { name: "Resume" }));
    expect(onJobSettings).toHaveBeenCalled();
  });
});
