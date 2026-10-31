// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const PHASES = [
  { id: "warmup", label: "Warm-up", auto: true as const, modes: "none" as const },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close", close: true as const, modes: "none" as const },
];

function tutor() {
  const client = new FakeClient(ready);
  client.state.actions = { session: { label: "Session", cost: "light", phases: PHASES } };
  client.chat = [
    { id: "u", role: "user", text: "Session", blocks: [], activities: [], at: "t", action: "session", task: "t1" },
    { id: "a", role: "assistant", text: "What do you remember?", blocks: [], activities: [], at: "t", task: "t1" },
  ];
  client.tasks = { current: { id: "t1", action: "session", status: "waiting", phase: "warmup" }, actions: {}, notes: [] };
  return client;
}

async function startWork(chatText?: string) {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  if (chatText) await screen.findByText(chatText);
  else await screen.findByPlaceholderText(/Write a message…/);
}

async function actions() {
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  return within(dialog).findByRole("group", { name: "Actions" });
}
const option = (group: HTMLElement, text: string) =>
  waitFor(() => {
    const o = within(group).getAllByRole("option").find((e) => e.textContent?.includes(text));
    if (!o) throw new Error(`no ${text} row`);
    return o;
  });

describe("actions run only while they still apply (search spec §6)", () => {
  it("with no task open the task's context isn't offered", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open(""));
    const group = await actions();
    expect(within(group).queryByText("Open what the AI takes into account")).toBeNull();
    expect(within(group).getByText("Open History")).toBeTruthy();
  });

  it("Stop the AI, while a turn runs, stops it", async () => {
    const client = tutor();
    render(<HarnessApp client={client} />);
    await startWork("What do you remember?");
    act(() => client.emitTaskTurn({ task: "t1", kind: "phase", phase: "main", by: "person" }));
    act(() => client.search.open(""));
    fireEvent.click(await option(await actions(), "Stop the AI"));
    await waitFor(() => expect(client.cancelled).toBe(1));
  });

  it("the next part runs the part the row named; once the task moved on, the row does nothing and says so", async () => {
    const client = tutor();
    render(<HarnessApp client={client} />);
    await startWork("What do you remember?");
    act(() => client.search.open(""));
    const row = await option(await actions(), "Go on to the next part: Main block");
    // The task moves on while the palette is open: the row still names Main block.
    act(() => client.emitTasks({ ...client.tasks, current: { ...client.tasks.current!, phase: "main" } }));
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(client.phaseCalls).toEqual([]);
    expect((await screen.findByRole("alert")).textContent).toBe("That can't be done right now.");
    act(() => client.search.open(""));
    fireEvent.click(await option(await actions(), "Go on to the next part: Close"));
    await waitFor(() => expect(client.phaseCalls).toEqual([{ taskId: "t1", phaseId: "close" }]));
  });

  it("Switch to <scope>: a turn that started since does nothing and says so; a failed open says so", async () => {
    const client = tutor();
    client.state = { ...client.state, scopes: { label: "topic", plural: "topics" } };
    client.scopeList = [
      { id: "physics", title: "Physics", createdAt: "c", archived: false },
      { id: "maths", title: "Maths", createdAt: "c", archived: false },
    ];
    client.openScope = "physics";
    const open = vi.spyOn(client.scopes, "open");
    render(<HarnessApp client={client} />);
    await startWork("What do you remember?");
    act(() => client.search.open("switch"));
    const row = await option(await actions(), "Switch to Maths");
    act(() => client.emitTaskTurn({ task: "t1", kind: "phase", phase: "main", by: "person" }));
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(open).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe("That can't be done right now.");
    act(() => client.emit({ type: "done", ok: true }));
    open.mockRejectedValueOnce(new Error("turnBlocked"));
    act(() => client.search.open("switch"));
    fireEvent.click(await option(await actions(), "Switch to Maths"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("maths"));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
  });
});
