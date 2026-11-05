// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HhTheme } from "../src/guide";
import { HarnessApp } from "../src";
import type { JobSummary, ParallelInfo, TaskSummary, TasksState } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

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
  // Settings shows Radix pieces that read the theme: mount inside the app's Radix root, as the shell does.
  render(
    <HhTheme>
      <HarnessApp client={c} />
    </HhTheme>,
  );
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  await screen.findByRole("button", { name: "History" });
}
/** `client.tasks`'s methods: the getter answers a new view each time, the methods sit on its prototype. */
const api = (c: FakeClient) => Object.getPrototypeOf(c.tasks) as FakeClient["tasks"];
const rail = () => screen.getByRole("navigation", { name: "App" });
/** The rail's Inbox entry: "Inbox", or "Inbox, N waiting" with its count. */
const inbox = () => within(rail()).findByRole("button", { name: /^Inbox/ });
/** The Inbox page (stage 4a). */
const inboxScreen = () => screen.getByRole("region", { name: "Inbox" });
/** Opens the Inbox page through the rail. */
async function openList() {
  fireEvent.click(await inbox());
  // The page reads the jobs as it opens: let that answer land.
  await act(async () => {});
}
/** Back to the chat from a page: the rail's Tasks. */
const toChat = () => fireEvent.click(within(rail()).getByRole("button", { name: "Tasks" }));

describe("Inbox (parallel spec §9.2)", () => {
  it("D0: without state.parallel there is no Inbox and no task call", async () => {
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

  it("three sections; the rail counts waiting tasks; a row focuses its task", async () => {
    const c = client(parallel(), {
      tasks: [summary("a", "waiting", { waitingFor: "answer" }), summary("b", "running"), summary("c", "queued")],
      caps: { tasks: 2, jobs: 1 },
    });
    await open(c);
    const button = await screen.findByRole("button", { name: "Inbox, 1 waiting" });
    expect(button.closest("nav")).toBe(rail());
    fireEvent.click(button);
    const dialog = inboxScreen();
    for (const name of ["Waiting for you", "Working", "Queued"]) expect(within(dialog).getByRole("heading", { name: new RegExp(`^${name}`) })).toBeTruthy();
    expect(within(dialog).getByText("Has a question")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Task a/ }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith("a"));
    // Focused: the Inbox screen gives way to the chat (it follows main's tasks change, never this click).
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull());
  });

  it("a pushed change updates the count without a refetch", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    await within(rail()).findByRole("button", { name: "Inbox" });
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
    await openList();
    const waiting = screen.getByRole("heading", { name: /^Waiting for you/ }).closest("section")!;
    const rows = within(waiting).getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toContain("Task new");
    expect(rows[0]).toContain("Wants to change phase");
    expect(rows[1]).toContain("Task old");
    expect(rows[1]).toContain("Your turn");
    const working = screen.getByRole("heading", { name: /^Working/ }).closest("section")!;
    expect(within(working).getByText("Drafting")).toBeTruthy();
    expect(within(working).getByText("Another task changed the same files")).toBeTruthy();
  });

  it("New task focuses the start view", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true })], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    await openList();
    fireEvent.click(within(inboxScreen()).getByRole("button", { name: "New task" }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith(null));
  });

  it("a queued row can be cancelled; a pause shows why and a Resume button", async () => {
    const c = client(parallel({ caps: { tasks: 1, jobs: 1 } }), {
      tasks: [summary("c", "queued")],
      caps: { tasks: 1, jobs: 1 },
      paused: { reason: "out-of-quota", resetsAt: "2026-10-28T15:00:00Z" },
    });
    await open(c);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    expect(screen.getByText(/^Out of quota until /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(c.tasks.resumeQueues).toHaveBeenCalled());
  });

  it("a pause with no reset time still offers Resume; a folder move's pause offers none", async () => {
    const c = client(parallel(), { tasks: [], caps: { tasks: 2, jobs: 1 }, paused: { reason: "out-of-quota" } });
    await open(c);
    await openList();
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
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    toChat();
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("the queued text"));
  });

  it("another task's cancelled message never lands in the focused task's box", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true }), summary("c", "queued")], caps: { tasks: 1, jobs: 1 } });
    c.tasks.cancelQueued.mockResolvedValueOnce("someone else's text");
    await open(c);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    // The refill runs in the reply's `.then`: let it settle before checking the box stayed empty.
    await act(async () => {});
    toChat();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("a queued row's Cancel is described by its task's label", async () => {
    const c = client(parallel(), { tasks: [summary("c", "queued"), summary("d", "queued")], caps: { tasks: 1, jobs: 1 } });
    await open(c);
    await openList();
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
    await within(rail()).findByRole("button", { name: "Inbox" });
    const region = document.querySelector('[aria-live="polite"]');
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
      await openList();
      return screen.getByText(/^Out of quota until /).textContent;
    };

    it("today: the time alone", async () => {
      expect(await pausedUntil(new Date(2026, 9, 28, 15, 0))).toBe("Out of quota until 3:00 PM");
    });

    it("another day: the weekday too", async () => {
      expect(await pausedUntil(new Date(2026, 9, 29, 9, 30))).toBe("Out of quota until Thursday 9:30 AM");
    });
  });
});

describe("Inbox's job results and the Jobs page (stage 4a)", () => {
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
  const results = () => screen.getByRole("heading", { name: /^Job results for you/ }).closest("section")!;

  it("D0: without state.jobs no jobs call is made and there is no results section", async () => {
    const c = client(parallel(), { tasks: [], caps: { tasks: 2, jobs: 1 } });
    const list = vi.spyOn(c.jobs, "list");
    const sub = vi.spyOn(c.jobs, "onChange");
    await open(c);
    await openList();
    expect(screen.queryByRole("heading", { name: /^Job results/ })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
  });

  it("the rail counts needs-you results with the waiting tasks; the Inbox lists only those results", async () => {
    const c = jobsClient();
    await open(c);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox, 2 waiting" }));
    const items = await within(await waitFor(results)).findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Sync inbox");
    expect(items[0].textContent).toContain("Two conflicts need you");
    expect(items[0].textContent).toContain("Last run");
  });

  it("a job turned off doesn't count, as the Dock badge doesn't", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Two conflicts need you", at }, paused: "off", manual: true, running: false },
    ]);
    await open(c);
    expect(await screen.findByRole("button", { name: "Inbox, 1 waiting" })).toBeTruthy();
  });

  it("Start on a needs-you result starts its action through the start path and shows the chat", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: "physics", last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    await open(c);
    await openList();
    fireEvent.click(within(await waitFor(results)).getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(c.sentOptions.at(-1)).toEqual({ action: "implement", scope: "physics" }));
    expect(c.sent.at(-1)).toBe("Implement");
    expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull();
  });

  it("Start in a scoped harness with no scope open uses the row's scope instead of asking for one", async () => {
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: "physics", last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    c.state.scopes = { label: "topic", plural: "topics" };
    await open(c);
    await openList();
    fireEvent.click(within(await waitFor(results)).getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(c.sentOptions.at(-1)).toEqual({ action: "implement", scope: "physics" }));
  });

  it("a Start that can't go through keeps the page and says so", async () => {
    // An app-wide row in a scoped harness with no scope open: the start path refuses it.
    const c = jobsClient([
      { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    c.state.scopes = { label: "topic", plural: "topics" };
    await open(c);
    await openList();
    const sent = c.sent.length;
    fireEvent.click(within(await waitFor(results)).getByRole("button", { name: /Start/ }));
    expect(await within(results()).findByRole("alert")).toHaveProperty("textContent", "Couldn't start it now.");
    expect(inboxScreen()).toBeTruthy();
    expect(c.sent.length).toBe(sent);
  });

  it("a pushed change updates the count", async () => {
    const c = jobsClient([]);
    await open(c);
    await screen.findByRole("button", { name: "Inbox, 1 waiting" });
    act(() => c.jobs.set(rows()));
    await screen.findByRole("button", { name: "Inbox, 2 waiting" });
  });

  it("rail › Jobs opens the Jobs page: one card per job, Run now on a manual one", async () => {
    const c = jobsClient();
    await open(c);
    fireEvent.click(within(rail()).getByRole("button", { name: "Jobs" }));
    const page = screen.getByRole("region", { name: "Jobs" });
    expect(document.activeElement).toBe(within(page).getByRole("heading", { level: 1, name: "Jobs" }));
    expect(within(rail()).getByRole("button", { name: "Jobs" }).getAttribute("aria-current")).toBe("page");
    expect(await within(page).findByText("Sync inbox")).toBeTruthy();
    expect(within(page).getByText("Digest")).toBeTruthy();
    fireEvent.click(within(page).getAllByRole("button", { name: /Run now/ })[0]);
    await waitFor(() => expect(c.jobs.run).toHaveBeenCalledWith("sync"));
  });
});

describe("the rail's Inbox count (stage 4a)", () => {
  it("is an orange badge on the rail's Inbox, with the count in its name; no top-bar pill", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting"), summary("b", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    const button = await screen.findByRole("button", { name: "Inbox, 2 waiting" });
    expect(button.closest("nav")).toBe(rail());
    expect(button.querySelector(".hh-rail-count")?.textContent).toBe("2");
    expect((document.querySelector(".hh-shell header.hh-topbar") as HTMLElement).querySelector("button[aria-label^='Inbox']")).toBeNull();
  });

  it("shows no badge when nothing waits", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    const button = await within(rail()).findByRole("button", { name: "Inbox" });
    expect(button.querySelector(".hh-rail-count")).toBeNull();
  });
});

describe("the rail's Inbox and Jobs (UI refresh spec §4.2)", () => {

  it("Inbox opens the Inbox page; Tasks goes back to the chat", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    expect(within(rail()).queryByRole("button", { name: "Jobs" })).toBeNull(); // no declared jobs
    fireEvent.click(within(rail()).getByRole("button", { name: /^Inbox/ }));
    expect(within(inboxScreen()).getByRole("button", { name: /^Task a/ })).toBeTruthy();
    expect(within(rail()).getByRole("button", { name: /^Inbox/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(rail()).getByRole("button", { name: "Tasks" }));
    expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(await inbox()).toBeTruthy();
  });

  it("D0: no Inbox nor Jobs without parallel, nor when the manifest turns the inbox off", async () => {
    const plain = client();
    plain.state.jobs = { jobs: [{ id: "sync", label: "Sync inbox", manual: true }] };
    await open(plain);
    for (const name of ["Inbox", "Jobs"]) expect(within(rail()).queryByRole("button", { name })).toBeNull();
    cleanup();
    const off = client(parallel({ inbox: false }));
    off.state.jobs = { jobs: [{ id: "sync", label: "Sync inbox", manual: true }] };
    await open(off);
    for (const name of ["Inbox", "Jobs"]) expect(within(rail()).queryByRole("button", { name })).toBeNull();
  });
});

describe("the Inbox page's focus and its way back to the chat (stage 4a)", () => {
  const tasksButton = () => within(rail()).getByRole("button", { name: "Tasks" });

  it("opening it puts the focus on its title", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    expect(document.activeElement).toBe(within(inboxScreen()).getByRole("heading", { level: 1, name: "Inbox" }));
  });

  it("the top bar's Volver names the task and goes back; no crumbs on the page", async () => {
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true }), summary("b", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    const bar = (document.querySelector(".hh-shell header.hh-topbar") as HTMLElement);
    expect(within(bar).queryByRole("navigation")).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Back to Task a" }));
    expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull();
    expect(within((document.querySelector(".hh-shell header.hh-topbar") as HTMLElement)).getByRole("navigation")).toBeTruthy();
  });

  it("Escape goes back to the chat and the focus to the rail's Tasks", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    fireEvent.keyDown(within(inboxScreen()).getByRole("button", { name: /^Task a/ }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(document.activeElement).toBe(tasksButton());
    expect(await inbox()).toBeTruthy();
  });

  it("a card opened leaves the focus on the rail's Tasks, not the page", async () => {
    const c = client(parallel(), { tasks: [summary("a", "waiting")], caps: { tasks: 2, jobs: 1 } });
    await open(c);
    fireEvent.click(await inbox());
    const card = within(inboxScreen()).getByRole("button", { name: /^Task a/ });
    card.focus();
    fireEvent.click(card);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull());
    expect(document.activeElement).toBe(tasksButton());
  });

  it("main focusing another task (a notification click) shows the chat", async () => {
    const caps = { tasks: 2, jobs: 1 };
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true }), summary("b", "waiting")], caps });
    await open(c);
    fireEvent.click(await inbox());
    act(() => c.tasks.set({ tasks: [summary("a", "running"), summary("b", "waiting", { focused: true })], caps }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull());
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("main focusing another task while Settings is open closes Settings and shows the chat", async () => {
    const caps = { tasks: 2, jobs: 1 };
    const c = client(parallel(), { tasks: [summary("a", "running", { focused: true }), summary("b", "waiting")], caps });
    await open(c);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
    act(() => c.tasks.set({ tasks: [summary("a", "running"), summary("b", "waiting", { focused: true })], caps }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Settings" })).toBeNull());
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("a cancelled message of the focused task shows the chat with its text back in the box", async () => {
    const c = client(parallel(), { tasks: [summary("c", "queued", { focused: true })], caps: { tasks: 1, jobs: 1 } });
    c.tasks.cancelQueued.mockResolvedValueOnce("the queued text");
    await open(c);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull());
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("the queued text"));
  });
});
