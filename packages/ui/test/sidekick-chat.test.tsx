// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { SidekickCard, SidekickReview } from "../src/client";
import { FakeClient } from "./fake-client";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const CARD: SidekickCard = {
  id: "c1",
  prompt: "make it better",
  flags: [{ kind: "vague", match: "better", span: [8, 14] }],
  issues: [{ kind: "vague", text: "Say what better means." }],
  rewrite: "make the intro shorter",
  confidence: 0.8,
  at: "2026-10-27T10:00:00Z",
};

function client(withSidekick = true) {
  const c = new FakeClient(ready);
  if (withSidekick) {
    c.state.sidekick = { id: "sidekick", name: "Sidekick" };
    c.sidekickState = SK_ON;
  }
  return c;
}
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  // The Sidekick state has loaded (when there is one) before anything is typed.
  if (c.state.sidekick) await screen.findByRole("button", { name: /Sidekick is/ });
  return box;
}
const type = (box: HTMLTextAreaElement, text: string) => fireEvent.change(box, { target: { value: text } });
const enter = (box: HTMLTextAreaElement, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(box, { key: "Enter", ...mods });

describe("Sidekick in the chat", () => {
  it("D0: without state.sidekick, Enter sends at once and there is no toggle or panel", async () => {
    const c = client(false);
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toEqual([]);
    expect(screen.queryByRole("button", { name: /Sidekick is/ })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Sidekick" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("Enter asks for a review; `send` sends as typed", async () => {
    const c = client();
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls[0]).toEqual(["review", { text: "make it better" }]);
    expect(box.value).toBe("");
  });

  it.each(["timeout", "error"] as const)("a %s sends as typed", async (kind) => {
    const c = client();
    c.sidekickReviews = [{ kind }];
    const box = await open(c);
    type(box, "first one");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["first one"]));
  });

  it("a cancelled (superseded) review sends nothing and keeps the draft", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "cancelled" }];
    const box = await open(c);
    type(box, "second one");
    enter(box);
    await waitFor(() => expect(c.sidekickCalls.filter(([k]) => k === "review")).toHaveLength(1));
    await act(async () => undefined);
    expect(c.sent).toEqual([]);
    expect(box.value).toBe("second one");
  });

  it("a card holds the prompt: nothing is sent; Send suggested sends the rewrite and resolves the card", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Send suggested" }));
    await waitFor(() => expect(c.sent).toEqual(["make the intro shorter"]));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "used"]);
    expect(box.value).toBe("");
  });

  it("a card underlines its spans in the composer while the draft is the prompt it read; the field is never remounted", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: { ...CARD, issues: [{ kind: "other", text: "x", span: [0, 99] }] } }));
    await waitFor(() => expect(document.querySelector(".hh-sk-backdrop mark")?.textContent).toBe("make it better"));
    // The model's span past the end is clamped to the prompt.
    type(box, "make it better now");
    expect(document.querySelector(".hh-sk-backdrop")).toBeNull();
    expect(box.isConnected).toBe(true);
  });

  it("Edit puts the rewrite in the composer; Send anyway sends the original", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(box.value).toBe("make the intro shorter");
    expect(c.sent).toEqual([]);
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "edited"]);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Send anyway" }));
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "sent-anyway"]);
  });

  it.each(["metaKey", "ctrlKey"] as const)("%s+Enter sends at once with no review", async (key) => {
    const c = client();
    const box = await open(c);
    type(box, "make it better");
    enter(box, { [key]: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls.filter(([k]) => k === "review")).toEqual([]);
  });

  it("⌥⏎ asks for a review even without flags", async () => {
    const c = client();
    const box = await open(c);
    type(box, "Rewrite paragraph 2");
    enter(box, { altKey: true });
    await waitFor(() => expect(c.sidekickCalls[0]).toEqual(["review", { text: "Rewrite paragraph 2", force: true }]));
  });

  it("the Review button asks for a forced review", async () => {
    const c = client();
    const box = await open(c);
    type(box, "Rewrite paragraph 2");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(c.sidekickCalls[0]).toEqual(["review", { text: "Rewrite paragraph 2", force: true }]));
  });

  it("with material in the open scope, the review says the send is attached", async () => {
    const c = client();
    c.state.material = { accepts: ["pdf"], items: false, grounding: { default: "strict", personCanChange: true }, maxPages: 50 };
    c.materialViews = {
      main: {
        scope: "main",
        sources: [{ id: "s1", name: "notes.pdf", status: "ready", pages: 3, estimate: 900, issues: [], fixes: [], fragments: 4, failed: false, asks: [] }],
        grounding: { mode: "strict", canChange: true },
        provider: "Anthropic",
        window: null,
      },
    };
    const box = await open(c);
    type(box, "summarize the attached file");
    enter(box);
    await waitFor(() => expect(c.sidekickCalls[0]).toEqual(["review", { text: "summarize the attached file", attached: true }]));
  });

  it("while reviewing: the send button reads Reviewing… with the countdown; Enter waits; ⌘⏎ cancels and sends", async () => {
    const c = client();
    let resolve!: (r: SidekickReview) => void;
    c.sidekick.review = (req) => (c.sidekickCalls.push(["review", req]), new Promise((r) => (resolve = r)));
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    expect(await screen.findByRole("button", { name: "Reviewing…" })).toBeTruthy();
    expect(screen.getByText(/Sends anyway in \d+ s/)).toBeTruthy();
    enter(box);
    expect(c.sent).toEqual([]);
    enter(box, { metaKey: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toContainEqual(["cancel"]);
    await act(async () => resolve({ kind: "cancelled" }));
    expect(c.sent).toEqual(["make it better"]);
  });

  it("Sidekick off: Enter sends without a review; the top-bar toggle turns it on", async () => {
    const c = client();
    c.sidekickState = { ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false } };
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sidekick is off. Turn it on" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: true, introSeen: true }]));
    expect(await screen.findByRole("complementary", { name: "Sidekick" })).toBeTruthy();
  });

  it("the panel collapses to the rail and opens again", async () => {
    const c = client();
    await open(c);
    fireEvent.click(await screen.findByRole("button", { name: "Collapse Sidekick" }));
    expect(screen.queryByRole("complementary", { name: "Sidekick" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Sidekick" }));
    expect(await screen.findByRole("complementary", { name: "Sidekick" })).toBeTruthy();
  });

  it("a new card is announced once in the polite live region", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    const live = () => document.querySelector('[aria-live="polite"]')?.textContent;
    await waitFor(() => expect(live()).toContain("Sidekick has a suggestion for your prompt."));
    // The same card pushed again is not announced again.
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD, spent: 1300 }));
    expect(live()).toBe("Sidekick has a suggestion for your prompt.");
  });
});
