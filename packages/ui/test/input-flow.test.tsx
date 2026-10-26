// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockProps, HarnessApp } from "../src";
import type { InputSpec, TaskStatus } from "../src/client";
import { pruneDrafts } from "../src/InputForm";
import { FakeClient } from "./fake-client";

afterEach(() => {
  cleanup();
  // Drafts live in a module map: no test sees another's.
  pruneDrafts(undefined, undefined);
});

const L = (en: string) => ({ es: en, en });
const SPEC: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why?"), optional: false, min: 1 },
  ],
  submitLabel: L("I commit"),
};
const block = (id: string, input?: object) => ({ name: "commit_answer", data: { question: "Who ate more?", options: ["Me", "Both the same"] }, id, ...(input ? { input } : {}) });

function quizClient(opts: { inputs?: boolean; pending?: string; status?: TaskStatus; blocks?: object[] } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Quiz", engineId: "claude" });
  client.state.actions = { practice: { label: L("Practice"), cost: "light" } };
  client.state.path = ["practice"];
  if (opts.inputs !== false) client.state.inputs = { commit_answer: SPEC };
  client.chat = [
    { id: "u", role: "user", text: "Practice", blocks: [], activities: [], at: "t", action: "practice", task: "t1" },
    { id: "a", role: "assistant", text: "Let's see.", blocks: (opts.blocks ?? [block("t1:0:0")]) as never, activities: [], at: "t", task: "t1" },
  ];
  client.tasks = {
    current: { id: "t1", action: "practice", status: opts.status ?? "waiting", ...(opts.pending !== undefined ? { pendingInput: opts.pending } : { pendingInput: "t1:0:0" }) },
    actions: {},
    notes: [],
  };
  return client;
}

async function open(client: FakeClient, blocks: Record<string, ComponentType<BlockProps>> = {}) {
  render(<HarnessApp client={client} blocks={blocks} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByText("Let's see.");
}

describe("input blocks in the chat", () => {
  it("answers the open question: the person's line shows, then the answer replaces the form", async () => {
    const client = quizClient();
    await open(client);
    expect(screen.getByRole("heading", { name: "Who ate more?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Me" }));
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "I had two halves" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    await waitFor(() => expect(client.responded).toEqual([{ blockId: "t1:0:0", value: { choice: "Me", why: "I had two halves" } }]));
    expect(await screen.findByText("answered")).toBeTruthy();
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I commit" })).toBeNull();
    act(() => {
      client.emit({ type: "text", delta: "Good thinking." });
      client.emit({ type: "done", ok: true });
    });
    // The reply shows in the chat (and is announced to screen readers, hence a second match).
    expect((await screen.findAllByText("Good thinking.")).some((el) => el.closest("article.hh-message"))).toBe(true);
  });

  it("a refused answer shows its errors and keeps the form", async () => {
    const client = quizClient();
    client.respondResult = { ok: false, reason: "invalid", errors: [{ path: "why", message: "Too small" }] };
    await open(client);
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Check the marked fields.");
    expect(screen.getByLabelText("Why?").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("answered")).toBeNull();
  });

  it("a call that fails, or a question closed meanwhile, says so", async () => {
    const client = quizClient();
    client.respondError = new Error("boom");
    await open(client);
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Try again.");
    client.respondError = null;
    client.respondResult = { ok: false, reason: "stale", errors: [{ path: "", message: "This question is closed" }] };
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This question is closed."));
  });

  it("an earlier question is closed, an answered one shows its answer, and a running task disables the form", async () => {
    const answered = { blockId: "t1:0:0", value: { why: "because" }, answeredAt: "a" };
    const client = quizClient({ blocks: [block("t1:0:0", answered), block("t1:0:1"), block("t1:0:2")], pending: "t1:0:2", status: "running" });
    await open(client);
    expect(screen.getByText("because")).toBeTruthy();
    expect(screen.getByText("This question is closed.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "I commit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("while the answer is on its way the form stays (never 'closed'), even once the app clears the pending question", async () => {
    const client = quizClient();
    let release!: () => void;
    client.respondGate = new Promise<void>((r) => (release = r));
    await open(client);
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    // The main process clears pendingInput (and tells the window) before `accepted` resolves.
    act(() => client.emitTasks({ current: { id: "t1", action: "practice", status: "waiting" }, actions: {}, notes: [] }));
    expect((await screen.findByRole("button", { name: "Sending…" })) as HTMLButtonElement).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("This question is closed.")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText("Your answer")).toBeTruthy();
    expect(screen.queryByText("This question is closed.")).toBeNull();
  });

  it("an answer whose turn fails offers no 'Try again' (the form opens again), and resends nothing as text", async () => {
    const client = quizClient();
    await open(client);
    fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "kept" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect(await screen.findByText("Your answer")).toBeTruthy();
    act(() => {
      client.emit({ type: "done", ok: false, error: { code: "agent-crashed" } });
      client.emitTasks({ current: { id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:0" }, actions: {}, notes: [] });
    });
    expect(await screen.findByLabelText("Why?")).toBeTruthy();
    expect((screen.getByLabelText("Why?") as HTMLTextAreaElement).value).toBe("kept");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(client.sent).toEqual([]);
  });

  it("a question the app reopened (stopped send) shows its form again, though its block was marked answered", async () => {
    const answered = { blockId: "t1:0:0", value: { why: "first try" }, answeredAt: "a" };
    const client = quizClient({ blocks: [block("t1:0:0", answered)], pending: "t1:0:0", status: "waiting" });
    await open(client);
    expect(screen.queryByText("Your answer")).toBeNull();
    expect((screen.getByRole("button", { name: "I commit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe("drafts", () => {
    const view = (current: object | null) => ({ current: current as never, actions: {}, notes: [] });
    const why = () => (screen.getByLabelText("Why?") as HTMLTextAreaElement).value;

    it("a send stopped before its turn reopens the form with the text the person wrote", async () => {
      const client = quizClient();
      await open(client);
      fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "kept" } });
      fireEvent.click(screen.getByRole("button", { name: "I commit" }));
      expect(await screen.findByText("Your answer")).toBeTruthy();
      act(() => client.emitTasks(view({ id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:0" })));
      expect(await screen.findByLabelText("Why?")).toBeTruthy();
      expect(why()).toBe("kept");
    });

    it("a newer question drops the older one's draft", async () => {
      const client = quizClient({ blocks: [block("t1:0:0"), block("t1:0:1")] });
      await open(client);
      fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "dropped" } });
      act(() => client.emitTasks(view({ id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:1" })));
      act(() => client.emitTasks(view({ id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:0" })));
      expect(why()).toBe("");
    });

    it("the task closing drops its drafts", async () => {
      const client = quizClient();
      await open(client);
      fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "dropped" } });
      act(() => client.emitTasks(view(null)));
      expect(screen.getByText("This question is closed.")).toBeTruthy();
      act(() => client.emitTasks(view({ id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:0" })));
      expect(why()).toBe("");
    });

    it("the chat drawn again keeps the draft", async () => {
      await open(quizClient());
      fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "kept" } });
      cleanup();
      await open(quizClient());
      expect(why()).toBe("kept");
    });
  });

  it("a harness component gets `input`; D0: without input specs it gets none", async () => {
    const Probe = (p: BlockProps) => <p>{p.input ? `input ${p.input.blockId} ${p.input.pending}` : "no input"}</p>;
    const client = quizClient();
    await open(client, { commit_answer: Probe });
    expect(screen.getByText("input t1:0:0 true")).toBeTruthy();
    cleanup();
    await open(quizClient({ inputs: false }), { commit_answer: Probe });
    expect(screen.getByText("no input")).toBeTruthy();
  });

  it("a block named like an Object method (`constructor`) is no component and no input block, with or without inputs", async () => {
    const constructorBlock = { name: "constructor", data: { a: 1 }, id: "t1:0:0" };
    await open(quizClient({ inputs: false, blocks: [constructorBlock] }));
    expect(screen.queryByText("This question is closed.")).toBeNull();
    cleanup();
    await open(quizClient({ blocks: [constructorBlock] }));
    expect(screen.queryByText("This question is closed.")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Why?" })).toBeNull();
  });
});
