// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { JobSummary, ParallelInfo, TaskSummary, TasksState } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

const summary = (id: string, state: TaskSummary["state"], extra: Partial<TaskSummary> = {}): TaskSummary => ({
  id,
  scope: "main",
  action: "intro",
  label: `Task ${id}`,
  state,
  startedAt: "2026-10-28T10:00:00Z",
  tokens: 0,
  ...extra,
});
const parallel = (over: Partial<ParallelInfo> = {}): ParallelInfo => ({
  caps: { tasks: 2, jobs: 1 },
  suggested: { tasks: 2, jobs: 1 },
  inbox: true,
  notifyWaiting: false,
  ...over,
});

function client(info?: ParallelInfo, tasks?: TasksState) {
  const c = new FakeClient(ready);
  if (info) c.state.parallel = info;
  if (tasks) c.tasksState = tasks;
  return c;
}
/** The work screen with its top bar up. */
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  await screen.findByRole("button", { name: "History" });
}
/** `client.tasks`'s methods: the getter answers a new view each time, the methods sit on its prototype. */
const api = (c: FakeClient) => Object.getPrototypeOf(c.tasks) as FakeClient["tasks"];
const inbox = () => screen.findByRole("button", { name: /^Inbox/ });

describe("Inbox (parallel spec §9.2)", () => {
  it("D0: without state.parallel there is no button and no task call", async () => {
    const c = client();
    const list = vi.spyOn(api(c), "list");
    const sub = vi.spyOn(api(c), "onChange");
    await open(c);
    expect(screen.queryByRole("button", { name: /^Inbox/ })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
  });

  it("no button when the manifest says inbox: false; the client API still answers", async () => {
    const c = client(parallel({ inbox: false }));
    await open(c);
    expect(screen.queryByRole("button", { name: /^Inbox/ })).toBeNull();
    expect((await c.tasks.list()).tasks).toEqual([]);
  });

  it("four sections; the button counts waiting tasks; a row focuses its task", async () => {
    const c = client(parallel(), {
      tasks: [summary("a", "waiting", { waitingFor: "answer" }), summary("b", "running"), summary("c", "queued")],
      caps: { tasks: 2, jobs: 1 },
    });
    await open(c);
    const button = await screen.findByRole("button", { name: "Inbox, 1 waiting" });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Inbox" });
    for (const name of ["Waiting for you", "Working", "Queued", "Jobs"]) expect(within(dialog).getByRole("heading", { name })).toBeTruthy();
    expect(within(dialog).getByText("No jobs")).toBeTruthy();
    expect(within(dialog).getByText("Has a question")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Task a/ }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith("a"));
    // Focused: the list closes (the chat follows main's tasks change, never this click).
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inbox" })).toBeNull());
  });

  it("a pushed change updates the count without a refetch", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    await screen.findByRole("button", { name: "Inbox, 0 waiting" });
    const list = vi.spyOn(api(c), "list");
    act(() => c.tasks.set({ tasks: [summary("a", "waiting", { waitingFor: "message" }), summary("b", "waiting")], caps: { tasks: 2, jobs: 1 } }));
    const button = await screen.findByRole("button", { name: "Inbox, 2 waiting" });
    expect(within(button).getByText("2")).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it("waiting rows are newest first and say what they wait for; working rows show the phase and a conflict", async () => {
    const c = client(parallel(), {
      tasks: [
        summary("old", "waiting", { waitingFor: "message" }),
        summary("new", "waiting", { waitingFor: "phase" }),
        summary("w", "running", { phase: "draft", conflict: ["notes/a.md"] }),
      ],
      caps: { tasks: 2, jobs: 1 },
    });
    c.state.actions = { intro: { label: "Intro", cost: "light", phases: [{ id: "draft", label: "Drafting" }] } };
    await open(c);
    fireEvent.click(await inbox());
    const waiting = screen.getByRole("heading", { name: "Waiting for you" }).closest("section")!;
    const rows = within(waiting).getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toContain("Task new");
    expect(rows[0]).toContain("Wants to change phase");
    expect(rows[1]).toContain("Task old");
    expect(rows[1]).toContain("Your turn");
    const working = screen.getByRole("heading", { name: "Working" }).closest("section")!;
    expect(within(working).getByText("Drafting")).toBeTruthy();
    expect(within(working).getByText("Another task changed the same files")).toBeTruthy();
  });

  it("New task focuses the start view", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true })], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(within(screen.getByRole("dialog", { name: "Inbox" })).getByRole("button", { name: "New task" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith(null));
  });

  it("a queued row can be cancelled; a pause shows why and a Resume button", async () => {
    const c = client(parallel({ caps: { tasks: 1, jobs: 1 } }), {
      tasks: [summary("c", "queued")],
      caps: { tasks: 1, jobs: 1 },
      paused: { reason: "out-of-quota", resetsAt: "2026-10-28T15:00:00Z" },
    });
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    expect(screen.getByText(/^Out of quota until /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(c.tasks.resumeQueues).toHaveBeenCalled());
  });

  it("a pause with no reset time still offers Resume; a folder move's pause offers none", async () => {
    const c = client(parallel(), { tasks: [], caps: { tasks: 2, jobs: 1 }, paused: { reason: "out-of-quota" } });
    await open(c);
    fireEvent.click(await inbox());
    expect(screen.getByText("Out of quota")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    act(() => c.tasks.set({ tasks: [], caps: { tasks: 2, jobs: 1 }, paused: { reason: "folder-move" } }));
    await screen.findByText("Paused while the folder moves");
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("cancelling the focused task's queued message puts its text back in the box", async () => {
    const c = client(parallel(), { tasks: [summary("c", "queued", { focused: true })], caps: { tasks: 1, jobs: 1 } });
    c.tasks.cancelQueued.mockResolvedValueOnce("the queued text");
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("the queued text"));
  });

  it("another task's cancelled message never lands in the focused task's box", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true }), summary("c", "queued")], caps: { tasks: 1, jobs: 1 } });
    c.tasks.cancelQueued.mockResolvedValueOnce("someone else's text");
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    // The refill runs in the reply's `.then`: let it settle before checking the box stayed empty.
    await act(async () => {});
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("a queued row's Cancel is described by its task's label", async () => {
    const c = client(parallel(), { tasks: [summary("c", "queued"), summary("d", "queued")], caps: { tasks: 1, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    const cancels = screen.getAllByRole("button", { name: "Cancel" });
    const described = cancels.map((b) => {
      const ref = b.getAttribute("aria-describedby");
      return ref ? document.getElementById(ref)?.textContent : null;
    });
    expect(described).toEqual(["Task c", "Task d"]);
  });

  it("a polite live region announces the waiting count as it changes", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    await screen.findByRole("button", { name: "Inbox, 0 waiting" });
    const region = document.querySelector('.hh-pl-inbox [aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe("");
    act(() => c.tasks.set({ tasks: [summary("a", "waiting"), summary("b", "waiting")], caps: { tasks: 2, jobs: 1 } }));
    await waitFor(() => expect(region!.textContent).toBe("2 waiting for you"));
  });

  describe("the reset time of an out-of-quota pause", () => {
    afterEach(() => vi.useRealTimers());
    const pausedUntil = async (resetsAt: Date) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 28, 10, 0));
      const c = client(parallel(), { tasks: [], caps: { tasks: 2, jobs: 1 }, paused: { reason: "out-of-quota", resetsAt: resetsAt.toISOString() } });
      await open(c);
      fireEvent.click(await inbox());
      return screen.getByText(/^Out of quota until /).textContent;
    };

    it("today: the time alone", async () => {
      expect(await pausedUntil(new Date(2026, 9, 28, 15, 0))).toBe("Out of quota until 3:00 PM");
    });

    it("another day: the weekday too", async () => {
      expect(await pausedUntil(new Date(2026, 9, 29, 9, 30))).toBe("Out of quota until Thursday 9:30 AM");
    });
  });

  it("Escape closes the list and gives focus back to the button", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    const button = await inbox();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Inbox" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inbox" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe("Inbox › Jobs (parallel part 3 Task 8)", () => {
  const jobsInfo = { jobs: [{ id: "sync", label: "Sync inbox", manual: true }, { id: "digest", label: "Digest", every: "1h", dailyTokens: 50_000, manual: false }] };
  const at = "2026-10-28T09:00:00Z";
  const rows = (): JobSummary[] => [
    { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Two conflicts need you", at, action: "implement" }, manual: true, running: false },
    { id: "digest", label: "Digest", scope: null, last: { status: "ok", summary: "Digest written", at }, next: "2026-10-28T10:00:00Z", paused: "daily-cap", manual: false, running: false },
  ];
  function jobsClient(list = rows()) {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    c.state.jobs = jobsInfo;
    c.state.actions = { intro: { label: "Intro", cost: "light" }, implement: { label: "Implement", cost: "light" } };
    c.jobsList = list;
    return c;
  }
  const jobsSection = () => screen.getByRole("heading", { name: "Jobs" }).closest("section")!;

  it("D0: without state.jobs the section says No jobs and no jobs call is made", async () => {
    const c = client(parallel(), { tasks: [], caps: { tasks: 2, jobs: 1 } });
    const list = vi.spyOn(c.jobs, "list");
    const sub = vi.spyOn(c.jobs, "onChange");
    await open(c);
    fireEvent.click(await inbox());
    expect(within(jobsSection()).getByText("No jobs")).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
  });

  it("each job × scope shows its label, last status and summary; the button counts needs-you rows with the waiting tasks", async () => {
    const c = jobsClient();
    await open(c);
    // One waiting task and one job that needs the person.
    fireEvent.click(await screen.findByRole("button", { name: "Inbox, 2 waiting" }));
    const section = jobsSection();
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Sync inbox");
    expect(items[0].textContent).toContain("Needs you");
    expect(items[0].textContent).toContain("Two conflicts need you");
    expect(items[0].textContent).toContain("Last run");
    expect(items[1].textContent).toContain("Digest");
    expect(items[1].textContent).toContain("OK");
    expect(items[1].textContent).toContain("Digest written");
    expect(items[1].textContent).toContain("Paused until tomorrow");
    // Paused by its daily cap: its armed timer runs nothing today, so no "Next run".
    expect(items[1].textContent).not.toContain("Next run");
    expect(within(section).queryByText("No jobs")).toBeNull();
  });

  it("Run now only on manual jobs, and it calls client.jobs.run(id, scope)", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: "physics", manual: true, running: false },
      { id: "digest", label: "Digest", scope: null, next: "2026-10-28T10:00:00Z", manual: false, running: false },
    ]);
    await open(c);
    fireEvent.click(await inbox());
    const section = jobsSection();
    expect(within(section).getAllByRole("listitem")[1].textContent).toContain("Next run");
    const runs = within(section).getAllByRole("button", { name: /Run now/ });
    expect(runs).toHaveLength(1);
    fireEvent.click(runs[0]);
    await waitFor(() => expect(c.jobs.run).toHaveBeenCalledWith("sync", "physics"));
  });

  it("a running job offers no Run now", async () => {
    const c = jobsClient([{ id: "sync", label: "Sync inbox", scope: null, manual: true, running: true }]);
    await open(c);
    fireEvent.click(await inbox());
    expect(within(jobsSection()).queryByRole("button", { name: /Run now/ })).toBeNull();
  });

  it("Start on a needs-you row starts its action through the start path (client.send with the action) and closes the list", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: "physics", last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(within(jobsSection()).getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(c.sentOptions.at(-1)).toEqual({ action: "implement", scope: "physics" }));
    expect(c.sent.at(-1)).toBe("Implement");
    expect(screen.queryByRole("dialog", { name: "Inbox" })).toBeNull();
  });

  it("Start in a scoped harness with no scope open uses the row's scope instead of asking for one", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: "physics", last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    c.state.scopes = { label: "topic", plural: "topics" };
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(within(jobsSection()).getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(c.sentOptions.at(-1)).toEqual({ action: "implement", scope: "physics" }));
  });

  it("a Start that can't go through keeps the list open and says so", async () => {
    // An app-wide row in a scoped harness with no scope open: the start path refuses it.
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    c.state.scopes = { label: "topic", plural: "topics" };
    await open(c);
    fireEvent.click(await inbox());
    const sent = c.sent.length;
    fireEvent.click(within(jobsSection()).getByRole("button", { name: /Start/ }));
    expect(await within(jobsSection()).findByRole("alert")).toHaveProperty("textContent", "Couldn't start it now.");
    expect(screen.getByRole("dialog", { name: "Inbox" })).toBeTruthy();
    expect(c.sent.length).toBe(sent);
  });

  it("Run now that is refused or fails says so", async () => {
    const c = jobsClient([{ id: "sync", label: "Sync inbox", scope: null, manual: true, running: false }]);
    c.jobs.run.mockResolvedValueOnce(false);
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.click(within(jobsSection()).getByRole("button", { name: /Run now/ }));
    expect(await within(jobsSection()).findByRole("alert")).toHaveProperty("textContent", "Couldn't run it now.");
    c.jobs.run.mockRejectedValueOnce(new Error("No jobs"));
    fireEvent.click(within(jobsSection()).getByRole("button", { name: /Run now/ }));
    await waitFor(() => expect(c.jobs.run).toHaveBeenCalledTimes(2));
    expect(within(jobsSection()).getByRole("alert").textContent).toBe("Couldn't run it now.");
  });

  it("no Start for an action the harness doesn't declare, nor without a needs-you result", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Look", at, action: "ghost" }, manual: false, running: false },
      { id: "digest", label: "Digest", scope: null, last: { status: "ok", summary: "Fine", at, action: "implement" }, manual: false, running: false },
    ]);
    await open(c);
    fireEvent.click(await inbox());
    expect(within(jobsSection()).queryByRole("button", { name: /Start/ })).toBeNull();
  });

  it("a pushed change updates the rows and the count", async () => {
    const c = jobsClient([]);
    await open(c);
    await screen.findByRole("button", { name: "Inbox, 1 waiting" });
    act(() => c.jobs.set(rows()));
    await screen.findByRole("button", { name: "Inbox, 2 waiting" });
  });
});
