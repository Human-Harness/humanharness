// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { CurrentTaskView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const PHASES = [
  { id: "warmup", label: "Warm-up", auto: true as const, modes: "none" as const },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close", close: true as const, modes: "none" as const },
];

function tutorClient(opts: { current?: Partial<CurrentTaskView> | null; timeBox?: boolean; modes?: boolean } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Tutor", engineId: "claude" });
  client.state.actions = {
    session: {
      label: "Session",
      cost: "light",
      phases: PHASES,
      ...(opts.timeBox ? { timeBox: { options: [15, 30], default: null } } : {}),
      ...(opts.modes ? { modes: ["socratic", "feynman"], defaultMode: "socratic" } : {}),
    },
    quiz: { label: "Quiz", cost: "light" },
  };
  client.state.path = ["session", "quiz"];
  if (opts.modes) client.state.modes = { socratic: { label: "Socratic" }, feynman: { label: "Feynman" } };
  if (opts.current !== null) {
    client.chat = [
      { id: "u", role: "user", text: "Session", blocks: [], activities: [], at: "t", action: "session", task: "t1" },
      { id: "a", role: "assistant", text: "What do you remember?", blocks: [], activities: [], at: "t", task: "t1" },
    ];
    client.tasks = { current: { id: "t1", action: "session", status: "waiting", phase: "warmup", ...opts.current }, actions: {}, notes: [] };
  }
  return client;
}

async function open(client: FakeClient, text: string | null = "What do you remember?") {
  render(<HarnessApp client={client} blocks={{}} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  if (text) await screen.findByText(text);
}

// The chat and the tasks load on their own: wait for the stepper rather than expect it right after the chat shows.
const steps = () => screen.findByRole("navigation", { name: "Task parts" });
const pill = async (name: string) => (await within(await steps()).findByRole("button", { name })) as HTMLButtonElement;

describe("task phases in the chat", () => {
  it("D0: an action without phases has no stepper and no time picker", async () => {
    const client = tutorClient({ current: { action: "quiz", phase: undefined } });
    await open(client);
    expect(screen.queryByRole("navigation", { name: "Task parts" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How long?" })).toBeNull();
  });

  it("D0: an action without a time box starts at once, with no timeBox option", async () => {
    const client = tutorClient({ current: null });
    await open(client, null);
    fireEvent.click((await screen.findAllByRole("button", { name: /Session/ }))[0]);
    await waitFor(() => expect(client.sentOptions.at(-1)).toEqual({ action: "session" }));
    expect(screen.queryByRole("dialog", { name: "How long?" })).toBeNull();
  });

  it("shows the stepper and moves the task; the change's line comes before its answer", async () => {
    const client = tutorClient();
    await open(client);
    fireEvent.click(await pill("Main block"));
    await waitFor(() => expect(client.phaseCalls).toEqual([{ taskId: "t1", phaseId: "main" }]));
    act(() => client.emitTaskTurn({ task: "t1", kind: "phase", phase: "main", by: "person" }));
    expect(await screen.findByText("— Main block —")).toBeTruthy();
    // While the change's turn runs, the stepper can't move the task again.
    expect((await pill("Close")).disabled).toBe(true);
    act(() => client.emit({ type: "text", delta: "Now the main block." }));
    act(() => client.emit({ type: "done", ok: true }));
    const close = await pill("Close");
    await waitFor(() => expect(close.disabled).toBe(false));
  });

  it("a refused move shows a short error", async () => {
    const client = tutorClient();
    client.phaseResult = { ok: false, reason: "unknown" };
    await open(client);
    fireEvent.click(await pill("Main block"));
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
  });

  it("a change the app makes on its own (auto, the time box) draws its line too", async () => {
    const client = tutorClient();
    await open(client);
    act(() => client.emitTaskTurn({ task: "t1", kind: "wrap-up" }));
    expect(await screen.findByText("Time is almost up")).toBeTruthy();
  });

  it("Finish closes the task and reads the tasks again: the stepper goes once the task is gone", async () => {
    const client = tutorClient({ current: { phase: "close" } });
    await open(client);
    client.tasks = { ...client.tasks, current: null };
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
    await waitFor(() => expect(client.taskCalls).toEqual(["finish"]));
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Task parts" })).toBeNull());
  });

  it("asks how long before an action with a time box starts, and sends the pick", async () => {
    const client = tutorClient({ current: null, timeBox: true });
    await open(client, null);
    fireEvent.click((await screen.findAllByRole("button", { name: /Session/ }))[0]);
    const picker = await screen.findByRole("dialog", { name: "How long?" });
    // The default ("No limit" here) comes first.
    expect(within(picker).getAllByRole("button").map((b) => b.textContent)).toEqual(["No limit", "15 min", "30 min", "Not now"]);
    expect(client.sent).toEqual([]);
    fireEvent.click(within(picker).getByRole("button", { name: "30 min" }));
    await waitFor(() => expect(client.sentOptions.at(-1)).toMatchObject({ action: "session", timeBox: 30 }));
  });

  it("Try again on a failed start keeps the length picked: no second How long?", async () => {
    const client = tutorClient({ current: null, timeBox: true });
    client.sendError = new Error("boom");
    await open(client, null);
    fireEvent.click((await screen.findAllByRole("button", { name: /Session/ }))[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "How long?" })).getByRole("button", { name: "30 min" }));
    client.sendError = null;
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.sentOptions).toHaveLength(2));
    expect(client.sentOptions[1]).toMatchObject({ action: "session", timeBox: 30 });
    expect(screen.queryByRole("dialog", { name: "How long?" })).toBeNull();
  });

  it("a failed change turn or wrap-up turn offers no Try again on its line", async () => {
    for (const notice of [{ task: "t1", kind: "phase" as const, phase: "main", by: "agent" as const }, { task: "t1", kind: "wrap-up" as const }]) {
      const client = tutorClient();
      await open(client);
      act(() => client.emitTaskTurn(notice));
      act(() => client.emit({ type: "done", ok: false, error: { code: "agent-crashed", detail: "boom" } }));
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      cleanup();
    }
  });

  it("a time box without phases shows its time and controls, with no parts; time up offers Finish", async () => {
    const client = tutorClient({ current: { action: "quiz", phase: undefined } });
    client.state.actions = { ...client.state.actions, quiz: { label: "Quiz", cost: "light", timeBox: { options: [15], default: 15 } } };
    client.tasks.current!.timeBox = { minutes: 15, totalMs: 900_000, usedMs: 900_000, at: new Date().toISOString(), paused: false, wrappedUp: true, ended: true };
    await open(client);
    expect(screen.queryByRole("navigation", { name: "Task parts" })).toBeNull();
    const box = await screen.findByRole("group", { name: "How long?" });
    expect(within(box).getByText("Time is up")).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(client.taskCalls).toEqual(["finish"]));
  });

  it("a refused pause shows a short error", async () => {
    const client = tutorClient({ current: { timeBox: { minutes: 15, totalMs: 900_000, usedMs: 0, at: new Date().toISOString(), paused: false } } });
    client.pauseTask = async () => {
      client.taskCalls.push("pause");
      return false;
    };
    await open(client);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
  });

  it("the mode bar lists only the modes the part allows, and hides when it allows none", async () => {
    const client = tutorClient({ modes: true });
    await open(client);
    expect(screen.queryByRole("group", { name: "Task mode" })).toBeNull();
    act(() => client.emitTasks({ ...client.tasks, current: { ...client.tasks.current!, phase: "main", mode: "socratic" } }));
    expect(await screen.findByRole("group", { name: "Task mode" })).toBeTruthy();
  });
});
