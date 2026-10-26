// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { CurrentTaskView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const MODES = {
  socratic: { label: "Socratic", description: "Questions that lead you to the idea." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const RECOMMEND = {
  name: "recommend_mode",
  id: "t1:0:0",
  data: { recommended: "socratic", reasons: ["One key idea to discover."], alternatives: [{ mode: "feynman", why: "To explain it back." }] },
};

function coachClient(opts: { modes?: boolean; current?: Partial<CurrentTaskView> | null; defaultMode?: string } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Coach", engineId: "claude" });
  client.state.actions = {
    study: { label: "Study", cost: "light", ...(opts.modes === false ? {} : { modes: ["socratic", "feynman", "worked"], defaultMode: opts.defaultMode ?? "recommend" }) },
    quiz: { label: "Quiz", cost: "light" },
  };
  client.state.path = ["study", "quiz"];
  if (opts.modes !== false) client.state.modes = MODES;
  if (opts.current !== null) {
    client.chat = [
      { id: "u", role: "user", text: "Study", blocks: [], activities: [], at: "t", action: "study", task: "t1" },
      { id: "a", role: "assistant", text: "Let's pick a way.", blocks: (opts.modes === false ? [] : [RECOMMEND]) as never, activities: [], at: "t", task: "t1" },
    ];
    client.tasks = {
      current: { id: "t1", action: "study", status: "waiting", ...(opts.modes === false ? {} : { tier: "standard" as const }), ...opts.current },
      actions: {},
      notes: [],
    };
  }
  return client;
}

async function open(client: FakeClient, text = "Let's pick a way.") {
  render(<HarnessApp client={client} blocks={{}} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  if (text) await screen.findByText(text);
}

const bar = () => screen.getByRole("group", { name: "Task mode" });
const pickInBar = (name: string) => {
  fireEvent.click(within(bar()).getByRole("button", { name: "Change mode" }));
  fireEvent.click(within(bar()).getByRole("button", { name }));
};

describe("task modes in the chat", () => {
  it("D0: an action without modes has no mode bar and no recommendation block", async () => {
    await open(coachClient({ modes: false }));
    expect(screen.queryByRole("group", { name: "Task mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change mode" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How do we work?" })).toBeNull();
  });

  it("the recommended mode switches the task: a system line, then the mode bar names it", async () => {
    const client = coachClient();
    await open(client);
    expect(bar().textContent).toContain("No mode chosen yet");
    fireEvent.click(within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[0]);
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "socratic", choice: {} }]));
    const line = await screen.findByText("Switched to Socratic");
    expect(line.className).toBe("hh-mode-line");
    act(() => {
      client.emit({ type: "text", delta: "What do you think a half is?" });
      client.emit({ type: "done", ok: true });
      client.emitTasks({ ...client.tasks, current: { ...client.tasks.current!, mode: "socratic", modes: ["socratic"] } });
    });
    await waitFor(() => expect(bar().textContent).toContain("Mode: Socratic"));
  });

  it("a switch the harness's own UI starts shows its line and its turn too", async () => {
    const client = coachClient();
    await open(client);
    await act(() => client.chooseMode("feynman"));
    expect((await screen.findByText("Switched to Feynman")).className).toBe("hh-mode-line");
    act(() => {
      client.emit({ type: "text", delta: "Explain it to me." });
      client.emit({ type: "done", ok: true });
    });
    await screen.findAllByText("Explain it to me.");
  });

  it("a mode above the task's tier asks first: continue, or a new task in that mode", async () => {
    const client = coachClient();
    await open(client);
    pickInBar("Worked examples");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Worked examples asks for more power");
    expect(dialog.textContent).toContain("It works best at the Deep level; this task runs at Standard.");
    expect(client.modeChoices).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue with the current model" }));
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "worked", choice: { belowTier: "continue" } }]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await screen.findByText("Switched to Worked examples");
  });

  it("the tier question takes focus on 'Not now'; Escape closes it, sends nothing and gives focus back", async () => {
    const client = coachClient();
    await open(client);
    pickInBar("Worked examples");
    const dialog = await screen.findByRole("alertdialog", { name: "Worked examples asks for more power" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Not now" })));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(client.modeChoices).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change mode" }));
  });

  it("'Start a new task' puts the new task on screen", async () => {
    const client = coachClient();
    client.modeResult = { ok: true, switched: "new-task" };
    await open(client);
    pickInBar("Worked examples");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start a new task with Worked examples" }));
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "worked", choice: { belowTier: "new-task" } }]));
    await waitFor(() => expect(screen.queryByText("Let's pick a way.")).toBeNull());
    expect(screen.queryByText("Switched to Worked examples")).toBeNull();
  });

  it("a refusal the window didn't foresee says so and leaves the block usable", async () => {
    const client = coachClient();
    client.modeResult = { ok: false, reason: "unknown" };
    await open(client);
    fireEvent.click(within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[1]);
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Pick a mode again.");
    const again = within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[1] as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });

  it("a failed call says so too", async () => {
    const client = coachClient();
    client.modeError = new Error("The app is closing");
    await open(client);
    pickInBar("Feynman");
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Pick a mode again.");
    expect(screen.queryByText("Switched to Feynman")).toBeNull();
  });

  it("the main process's tier refusal opens the same question", async () => {
    const client = coachClient({ current: { tier: undefined } });
    client.modeResult = { ok: false, reason: "tier", required: "deep", current: "light" };
    await open(client);
    pickInBar("Worked examples");
    expect((await screen.findByRole("alertdialog")).textContent).toContain("this task runs at Light.");
  });

  it("'ask': starting the action shows its modes first and sends the pick with it", async () => {
    const client = coachClient({ current: null, defaultMode: "ask" });
    await open(client, "");
    fireEvent.click((await screen.findAllByRole("button", { name: "Study" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "How do you want to work?" });
    expect(client.sent).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getAllByRole("button")[0]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Feynman" }));
    await waitFor(() => expect(client.sentOptions.at(-1)).toEqual({ action: "study", mode: "feynman" }));
    expect(screen.queryByRole("dialog", { name: "How do you want to work?" })).toBeNull();
  });

  it("'ask': Escape and Not now send nothing", async () => {
    const client = coachClient({ current: null, defaultMode: "ask" });
    await open(client, "");
    fireEvent.click((await screen.findAllByRole("button", { name: "Study" }))[0]);
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "How do you want to work?" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "How do you want to work?" })).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: "Study" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "How do you want to work?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: "How do you want to work?" })).toBeNull();
    expect(client.sent).toEqual([]);
  });

  it("a saved switch shows as a system line, never as the person's message", async () => {
    const client = coachClient();
    client.chat.push({ id: "s", role: "user", text: "Switched to Feynman", blocks: [], activities: [], at: "t", task: "t1", mode: "feynman" });
    await open(client);
    const line = screen.getByText("Switched to Feynman");
    expect(line.className).toBe("hh-mode-line");
    expect(line.closest("article")?.querySelector(".hh-who")).toBeNull();
  });
});
