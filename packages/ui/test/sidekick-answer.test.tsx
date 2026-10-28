// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { InputSpec, SidekickCard } from "../src/client";
import { pruneDrafts } from "../src/InputForm";
import { FakeClient } from "./fake-client";
import { SK_ON } from "./sidekick-fixtures";

afterEach(() => {
  cleanup();
  pruneDrafts(undefined, undefined);
});

const SPEC: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: "I pick", optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: "Why?", optional: false, min: 1 },
  ],
  submitLabel: "I commit",
};
const CARD: SidekickCard = {
  id: "c1",
  prompt: "make it better",
  block: true,
  flags: [],
  issues: [{ kind: "vague", text: "Say what better means." }],
  rewrite: "I had two halves, so more.",
  confidence: 0.8,
  at: "2026-10-27T10:00:00Z",
  moment: "pre",
  speaker: SK_ON.info,
  kind: "vague",
};

function quizClient(withSidekick: boolean) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Quiz", engineId: "claude" });
  client.state.actions = { practice: { label: "Practice", cost: "light" } };
  client.state.path = ["practice"];
  client.state.inputs = { commit_answer: SPEC };
  if (withSidekick) {
    client.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "spark" };
    client.sidekickState = SK_ON;
  }
  client.chat = [
    { id: "u", role: "user", text: "Practice", blocks: [], activities: [], at: "t", action: "practice", task: "t1" },
    {
      id: "a",
      role: "assistant",
      text: "Let's see.",
      blocks: [{ name: "commit_answer", data: { question: "Who ate more?", options: ["Me", "Both the same"] }, id: "t1:0:0" }] as never,
      activities: [],
      at: "t",
      task: "t1",
    },
  ];
  client.tasks = { current: { id: "t1", action: "practice", status: "waiting", pendingInput: "t1:0:0" }, actions: {}, notes: [] };
  return client;
}

async function open(client: FakeClient) {
  render(<HarnessApp client={client} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByText("Let's see.");
  if (client.state.sidekick) await screen.findByRole("button", { name: /Sidekick is/ });
}
const answer = (text: string) => {
  fireEvent.click(screen.getByRole("radio", { name: "Me" }));
  fireEvent.change(screen.getByLabelText("Why?"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "I commit" }));
};

describe("Sidekick on a block answer (sidekick spec §4.1)", () => {
  it("D0: without state.sidekick the answer goes at once and Sidekick is never called", async () => {
    const c = quizClient(false);
    await open(c);
    answer("make it better");
    await waitFor(() => expect(c.responded).toEqual([{ blockId: "t1:0:0", value: { choice: "Me", why: "make it better" } }]));
    expect(c.sidekickCalls).toEqual([]);
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
  });

  it("D0: Sidekick off → the answer goes unreviewed", async () => {
    const c = quizClient(true);
    c.sidekickState = { ...SK_ON, settings: { ...SK_ON.settings, on: false }, status: "off" };
    await open(c);
    answer("make it better");
    await waitFor(() => expect(c.responded).toHaveLength(1));
    expect(c.sidekickCalls.filter((x) => x[0] === "review")).toEqual([]);
  });

  it("the free text is reviewed as a block answer; `send` answers", async () => {
    const c = quizClient(true);
    await open(c);
    answer("make it better");
    await waitFor(() => expect(c.responded).toHaveLength(1));
    expect(c.sidekickCalls).toContainEqual(["review", { text: "make it better", block: true }]);
  });

  it("a card holds the answer; its Send anyway answers with the form and resolves the card", async () => {
    const c = quizClient(true);
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    await open(c);
    answer("make it better");
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    const anyway = await screen.findByRole("button", { name: "Send anyway" });
    expect(c.responded).toEqual([]);
    fireEvent.click(anyway);
    await waitFor(() => expect(c.responded).toEqual([{ blockId: "t1:0:0", value: { choice: "Me", why: "make it better" } }]));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "sent-anyway"]);
    expect(c.sent).toEqual([]);
  });

  it("the same answer sent again while its card waits goes as is", async () => {
    const c = quizClient(true);
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    await open(c);
    answer("make it better");
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    await screen.findByRole("button", { name: "Send anyway" });
    await waitFor(() => expect(screen.getByRole("button", { name: "I commit" }).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    await waitFor(() => expect(c.responded).toHaveLength(1));
    expect(c.sidekickCalls.filter((x) => x[0] === "review")).toHaveLength(1);
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "sent-anyway"]);
  });

  it("Send suggested puts the rewrite in the composer; Edit moves focus to the answer", async () => {
    const c = quizClient(true);
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    await open(c);
    answer("make it better");
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "edited"]);
    expect(document.activeElement).toBe(screen.getByLabelText("Why?"));
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: { ...CARD, id: "c2" } }));
    fireEvent.click(await screen.findByRole("button", { name: "Send suggested" }));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c2", "used"]);
    const composer = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA" && !el.closest("form.hh-input-form")) as HTMLTextAreaElement;
    expect(composer.value).toBe("I had two halves, so more.");
    expect(c.sent).toEqual([]);
    expect(c.responded).toEqual([]);
  });
});
