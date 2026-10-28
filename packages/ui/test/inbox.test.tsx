// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { ParallelInfo, TaskSummary, TasksState } from "../src/client";
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
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
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
