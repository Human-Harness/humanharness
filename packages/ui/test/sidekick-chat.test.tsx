// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { AppState, SetupStepView, SidekickCard, SidekickReview } from "../src/client";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const CARD: SidekickCard = {
  id: "c1",
  prompt: "make it better",
  flags: [{ kind: "vague", match: "better", span: [8, 14] }],
  issues: [{ kind: "vague", text: "Say what better means." }],
  rewrite: "make the intro shorter",
  confidence: 0.8,
  at: "2026-10-27T10:00:00Z",
  moment: "pre",
  speaker: SK_ON.info,
  kind: "vague",
};

function client(withSidekick = true) {
  const c = new FakeClient(ready);
  if (withSidekick) {
    c.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "spark" };
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

  it("a review main cancelled (Sidekick turned off mid-review) sends as typed", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "cancelled" }];
    const box = await open(c);
    type(box, "second one");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["second one"]));
    expect(box.value).toBe("");
  });

  it("the review's answer is checked against the latest state: a pre-flight opened meanwhile holds the send", async () => {
    const c = client();
    c.state.actions = { tidy: { label: "Tidy up", cost: "heavy" } };
    c.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: new Date(Date.now() + 7_200_000).toISOString() }], estimates: { tidy: 0.08 }, tokens: {} };
    let resolve!: (r: SidekickReview) => void;
    c.sidekick.review = (req) => (c.sidekickCalls.push(["review", req]), new Promise((r) => (resolve = r)));
    render(<HarnessApp client={c} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    // Collapsed, the rail sits beside the harness's own panel.
    fireEvent.click(await screen.findByRole("button", { name: "Collapse Sidekick" }));
    await screen.findByText(/5 h: 75% used/);
    type(box, "make it better");
    enter(box);
    await screen.findByRole("button", { name: "Reviewing…" });
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    await screen.findByRole("alertdialog");
    await act(async () => resolve({ kind: "send" }));
    expect(c.sent).toEqual([]);
  });

  it("IME composition: Enter with Sidekick on neither reviews nor sends", async () => {
    const c = client();
    const box = await open(c);
    type(box, "かんじ");
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    await act(async () => undefined);
    expect(c.sidekickCalls).toEqual([]);
    expect(c.sent).toEqual([]);
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
    // The model's span past the end is clamped to the prompt.
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: { ...CARD, issues: [{ kind: "other", text: "x", span: [0, 99] }] } }));
    await waitFor(() => expect(document.querySelector(".hh-sk-backdrop mark")?.textContent).toBe("make it better"));
    // Once the draft differs from the prompt the card read, the underline goes.
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

  it("a card waiting: ⌘⏎ sends the draft and the card leaves as sent anyway", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    await screen.findByRole("button", { name: "Send suggested" });
    enter(box, { metaKey: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "sent-anyway"]);
  });

  it("a card waiting while pre-send is off: Enter sends and the card leaves as sent anyway", async () => {
    const c = client();
    c.sidekickState = { ...SK_ON, settings: { ...SK_ON.settings, preSend: false }, status: "suggestion", card: CARD };
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls.filter(([k]) => k === "review")).toEqual([]);
    expect(c.sidekickCalls).toContainEqual(["resolve", "c1", "sent-anyway"]);
  });

  it("no card: ⌘⏎ resolves nothing", async () => {
    const c = client();
    const box = await open(c);
    type(box, "make it better");
    enter(box, { metaKey: true });
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls.filter(([k]) => k === "resolve")).toEqual([]);
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
    const toggle = screen.getByRole("button", { name: "Sidekick is off. Turn it on" });
    // The label names the state: no aria-pressed on top of it (announced twice); styled through data-on.
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(toggle.getAttribute("data-on")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { on: true, introSeen: true }]));
    expect(await screen.findByRole("complementary", { name: "Sidekick" })).toBeTruthy();
  });

  it("D0: Sidekick off draws nothing behind the field, even with a card left in the state", async () => {
    const c = client();
    c.sidekickState = { ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false }, card: CARD };
    const box = await open(c);
    type(box, "make it better");
    await act(async () => undefined);
    expect(document.querySelector(".hh-sk-flagged")).not.toBeNull();
    expect(document.querySelector(".hh-sk-backdrop")).toBeNull();
  });

  it("the panel collapses to the rail and opens again", async () => {
    const c = client();
    await open(c);
    const collapse = await screen.findByRole("button", { name: "Collapse Sidekick" });
    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.queryByRole("complementary", { name: "Sidekick" })).toBeNull();
    // Focus follows to the counterpart button instead of dropping to the body.
    const rail = screen.getByRole("button", { name: "Open Sidekick" });
    await waitFor(() => expect(document.activeElement).toBe(rail));
    fireEvent.click(rail);
    expect(await screen.findByRole("complementary", { name: "Sidekick" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Collapse Sidekick" })));
  });

  it("the tier in the panel foot opens Settings › Sidekick", async () => {
    const c = client();
    await open(c);
    fireEvent.click(await screen.findByRole("button", { name: "Tier: Light" }));
    expect(await screen.findByRole("tab", { name: "Sidekick", selected: true })).toBeTruthy();
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
    // A second card puts the same words: the region is cleared first, so it is announced again.
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: { ...CARD, id: "c2" } }));
    expect(live()).toBe("");
    await waitFor(() => expect(live()).toBe("Sidekick has a suggestion for your prompt."));
  });

  it("D0: with renderSide and no state.sidekick, the harness's side column as before", async () => {
    const c = client(false);
    render(<HarnessApp client={c} renderSide={() => <p>Harness side</p>} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole("textbox");
    const side = (await screen.findByText("Harness side")).parentElement;
    expect(side?.tagName).toBe("ASIDE");
    expect(side?.className).toBe("hh-side");
    expect(document.querySelector(".hh-sk-rail, .hh-sk-panel")).toBeNull();
  });

  it("slim (interview) mode with state.sidekick: no toggle, no rail, no review", async () => {
    const c = client();
    const step: SetupStepView = { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" };
    c.state = { ...c.state, setup: [step], actions: { conocerte: { label: "Get to know you", cost: "light", setup: true } } };
    c.setupState = { steps: { conocerte: "missing" }, blocking: ["conocerte"] };
    c.tasks = { current: { id: "t1", action: "conocerte", status: "waiting" }, actions: {}, notes: [] };
    c.chat = [
      { id: "u1", role: "user", text: "Get to know you", blocks: [], activities: [], at: "t", task: "t1", action: "conocerte" },
      { id: "a1", role: "assistant", text: "Hi.", blocks: [], activities: [], at: "t", task: "t1" },
    ];
    function Flow() {
      const [state, setState] = useState<AppState>(c.state);
      return <SetupFlow client={c} state={state} onChange={setState} onCancel={() => {}} onStart={() => {}} startAt="conocerte" />;
    }
    await renderIn("en", <Flow />);
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls).toEqual([]);
    expect(screen.queryByRole("button", { name: /Sidekick is/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Sidekick|Sidekick has a suggestion/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });
});

/** Makes `(max-width: 720px)` match: a window too narrow for the Sidekick panel. */
function narrowWindow() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 720px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
/** Opens with a harness side holding a heavy action's button, the panel collapsed, and the pre-flight open. */
async function openWithPreflight(c: FakeClient) {
  c.state.actions = { tidy: { label: "Tidy up", cost: "heavy" } };
  c.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: new Date(Date.now() + 7_200_000).toISOString() }], estimates: { tidy: 0.08 }, tokens: {} };
  render(<HarnessApp client={c} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  fireEvent.click(await screen.findByRole("button", { name: "Collapse Sidekick" }));
  await screen.findByText(/5 h: 75% used/);
  fireEvent.click(screen.getByRole("button", { name: "tidy" }));
  await screen.findByRole("alertdialog");
  return box;
}

describe("Sidekick when a send can't go out, or the panel can't show", () => {
  it("Enter while a pre-flight waits runs no review (nothing would be sent)", async () => {
    const c = client();
    const box = await openWithPreflight(c);
    type(box, "make it better");
    enter(box);
    await act(async () => undefined);
    expect(c.sidekickCalls.filter(([k]) => k === "review")).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  it.each(["Send suggested", "Send anyway"])("%s that send refuses keeps the card", async (name) => {
    const c = client();
    const box = await openWithPreflight(c);
    type(box, "make it better");
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: CARD }));
    fireEvent.click(await screen.findByRole("button", { name: "Sidekick has a suggestion" }));
    fireEvent.click(await screen.findByRole("button", { name }));
    await act(async () => undefined);
    expect(c.sent).toEqual([]);
    expect(c.sidekickCalls.filter(([k]) => k === "resolve")).toEqual([]);
    expect(box.value).toBe("make it better");
  });

  it("a window too narrow for the panel: Enter sends as typed, with no review", async () => {
    narrowWindow();
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: CARD }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    await waitFor(() => expect(c.sent).toEqual(["make it better"]));
    expect(c.sidekickCalls.filter(([k]) => k === "review")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("D0: a window too narrow for the panel shows the harness's side panel as before, Sidekick on and expanded", async () => {
    narrowWindow();
    const c = client();
    render(<HarnessApp client={c} renderSide={() => <p>Harness side</p>} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole("button", { name: /Sidekick is/ });
    const side = (await screen.findByText("Harness side")).parentElement;
    expect(side?.tagName).toBe("ASIDE");
    expect(side?.className).toBe("hh-side");
    expect(document.querySelector(".hh-sk-rail, .hh-sk-panel")).toBeNull();
  });
});

describe("after the reply and queued prompts in the chat (spec §4.2)", () => {
  const QUEUED: SidekickCard = { ...CARD, queued: ["Translate chapter 2", "Add a summary"] };
  const AFTER: SidekickCard = { id: "a1", moment: "after", kind: "gap", speaker: SK_ON.info, prompt: "Outline", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", after: { gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" } };

  it("a sent card's queued asks stay For later after it leaves; Drop takes the one pressed; Put in composer fills the field", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: QUEUED }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: QUEUED }));
    expect(await screen.findByText("Translate chapter 2")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Drop" })[0]!);
    expect(screen.queryByText("Translate chapter 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send suggested" }));
    await waitFor(() => expect(c.sent).toEqual(["make the intro shorter"]));
    // Main takes the card away: the queued ask outlives it.
    act(() => c.emitSidekick(SK_ON));
    expect(screen.queryByRole("button", { name: "Send suggested" })).toBeNull();
    expect(screen.getByRole("heading", { name: "For later" })).toBeTruthy();
    expect(screen.queryByText("Translate chapter 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(box.value).toBe("Add a summary");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(screen.queryByText("Add a summary", { selector: "p" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "For later" })).toBeNull();
  });

  it("Edit sends nothing: the card's queued asks leave with it (a new review finds them again)", async () => {
    const c = client();
    c.sidekickReviews = [{ kind: "card", card: QUEUED }];
    const box = await open(c);
    type(box, "make it better");
    enter(box);
    act(() => c.emitSidekick({ ...SK_ON, status: "suggestion", card: QUEUED }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    act(() => c.emitSidekick(SK_ON));
    expect(screen.queryByRole("heading", { name: "For later" })).toBeNull();
  });

  it("an after-reply card: Put in composer fills the field and resolves used; Dismiss resolves dismissed", async () => {
    const c = client();
    const box = await open(c);
    act(() => c.emitSidekick({ ...SK_ON, cards: [AFTER] }));
    fireEvent.click(await screen.findByRole("button", { name: "Put in composer" }));
    expect(box.value).toBe("Add a source for claim 2");
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["resolve", "a1", "used"]));
    expect(c.sent).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(c.sidekickCalls).toContainEqual(["resolve", "a1", "dismissed"]));
  });
});
