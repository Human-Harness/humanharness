// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidekickCard, SidekickState } from "../src/client";
import { SidekickPanel, SidekickRail } from "../src/sidekick/SidekickPanel";
import { SidekickMark } from "../src/sidekick/mark";
import { wordDiff } from "../src/sidekick/word-diff";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);
const CARD: SidekickCard = {
  id: "c1",
  prompt: "make it better",
  flags: [{ kind: "vague", match: "better", span: [8, 14] }],
  issues: [{ kind: "vague", text: "Say what better means." }],
  rewrite: "make the intro shorter, under 80 words",
  queued: ["Translate chapter 2 into Spanish"],
  confidence: 0.8,
  at: "2026-10-27T10:00:00Z",
  moment: "pre",
  speaker: SK_ON.info,
  kind: "vague",
};
const handlers = () => ({
  onCollapse: vi.fn(), onTurnOn: vi.fn(), onNotNow: vi.fn(), onSendSuggested: vi.fn(), onEdit: vi.fn(), onSendAnyway: vi.fn(), onPutInComposer: vi.fn(), onView: vi.fn(), onMute: vi.fn(), onDismiss: vi.fn(), onDropQueued: vi.fn(),
  onSaveDecision: vi.fn(async () => ({ ok: true })), onFinishTask: vi.fn(),
});
const panel = (state: SidekickState, h = handlers(), extra: Partial<Parameters<typeof SidekickPanel>[0]> = {}) =>
  renderIn("en", <SidekickPanel state={state} view="sidekick" sendKey="⌘" {...h} {...extra} />).then(() => h);

describe("wordDiff", () => {
  it("marks the added words", () => {
    expect(wordDiff("make it better", "make it shorter please")).toEqual([
      { text: "make it ", added: false },
      { text: "shorter please", added: true },
    ]);
  });
});

describe("SidekickPanel", () => {
  it("head: mark, name and state; foot: tokens, cap, tier and the ⌘⏎ hint", async () => {
    await panel(SK_ON);
    expect(screen.getByRole("heading", { name: "Sidekick" })).toBeTruthy();
    expect(screen.getByText("Watching")).toBeTruthy();
    expect(screen.getByText("Sidekick in this task — 1,200 / 20,000 tokens")).toBeTruthy();
    expect(screen.getByText("Tier: Light")).toBeTruthy();
    expect(screen.getByText("⌘⏎ sends now")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("head: the default sidekick's own mark, once edited", async () => {
    await panel({ ...SK_ON, info: { id: "sidekick", name: "Owl", mark: "🦉" } });
    const head = screen.getByRole("heading", { name: "Owl" }).closest("header")!;
    expect(head.querySelector(".hh-sk-mark-text")?.textContent).toBe("🦉");
    expect(head.querySelector("svg.hh-sk-mark")).toBeNull();
  });

  it("with onTier, the foot's tier is a button that opens Settings › Sidekick", async () => {
    const onTier = vi.fn();
    await panel(SK_ON, handlers(), { onTier });
    fireEvent.click(screen.getByRole("button", { name: "Tier: Light" }));
    expect(onTier).toHaveBeenCalled();
  });

  it("the card: issues, the rewrite with added words marked, the three buttons", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(screen.getByText("Say what better means.")).toBeTruthy();
    expect(screen.getByText("the intro shorter, under 80 words", { selector: "ins" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send suggested" }));
    expect(h.onSendSuggested).toHaveBeenCalledWith(CARD);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(h.onEdit).toHaveBeenCalledWith(CARD);
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(h.onSendAnyway).toHaveBeenCalledWith(CARD);
  });

  it("queued prompts live in the panel body under For later: Put in composer and Drop (by key)", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: CARD }, handlers(), { queued: [{ key: "c1:0", text: "Translate chapter 2 into Spanish" }] });
    expect(screen.getByRole("heading", { name: "For later" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(h.onPutInComposer).toHaveBeenCalledWith("Translate chapter 2 into Spanish");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(h.onDropQueued).toHaveBeenCalledWith("c1:0");
  });

  it("queued prompts with the same text: Drop names only the one pressed", async () => {
    const h = await panel(SK_ON, handlers(), { queued: [{ key: "c1:0", text: "Same ask" }, { key: "c1:1", text: "Same ask" }] });
    expect(screen.getAllByText("Same ask")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Drop" })[1]!);
    expect(h.onDropQueued).toHaveBeenCalledWith("c1:1");
  });

  it("the live card itself no longer lists its queued asks; nothing For later without queued", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(screen.queryByText("Translate chapter 2 into Spanish")).toBeNull();
    expect(screen.queryByRole("heading", { name: "For later" })).toBeNull();
  });

  it("a card without a rewrite has no Send suggested or Edit", async () => {
    const { rewrite: _r, ...noRewrite } = CARD;
    await panel({ ...SK_ON, status: "suggestion", card: noRewrite });
    expect(screen.queryByRole("button", { name: "Send suggested" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send anyway" })).toBeTruthy();
  });

  it("the quiet notice after a failed review", async () => {
    await panel({ ...SK_ON, notice: "failed" });
    expect(screen.getByText("Sidekick couldn't review this one. Your prompt went as typed.")).toBeTruthy();
  });

  it("off, first time: the intro with Turn on and Not now", async () => {
    const h = await panel({ ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false, introSeen: false } });
    expect(screen.getByText(/reads your prompt before it goes out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(h.onTurnOn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(h.onNotNow).toHaveBeenCalled();
  });

  it("off, first time, with No cap: the intro names no token number", async () => {
    await panel({ ...SK_ON, cap: null, status: "off", settings: { ...SK_ON.settings, on: false, introSeen: false } });
    const body = screen.getByText(/reads your prompt before it goes out/);
    expect(body.textContent).not.toMatch(/\d/);
  });

  it("with a harness panel: the Sidekick | Harness switch shows the harness's side", async () => {
    const h = handlers();
    await renderIn("en", <SidekickPanel state={SK_ON} view="harness" sendKey="⌘" harnessSide={<p>Harness side</p>} {...h} />);
    expect(screen.getByText("Harness side")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sidekick" }));
    expect(h.onView).toHaveBeenCalledWith("sidekick");
  });

  it("never takes focus (spec §7 accessibility)", async () => {
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(document.activeElement).toBe(input);
  });
});

describe("learning in the panel (spec §4.1, §7)", () => {
  it("why and Don't flag", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: { ...CARD, why: { used: 4, of: 5 } } });
    // The kind reads as its label, never the raw id.
    expect(screen.getByText("You took 4 of your last 5 “Vague words” suggestions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't flag “Vague words”" }));
    expect(h.onMute).toHaveBeenCalledWith("c1");
  });

  it("no why line with fewer than 3 past cards", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(screen.queryByText(/You took/)).toBeNull();
  });

  it("earlier cards collapse to one line", async () => {
    await panel({ ...SK_ON, past: [{ id: "c0", kind: "two-asks", outcome: "used", speaker: "sidekick" }, { id: "c00", kind: "vague", outcome: "sent-anyway", speaker: "sidekick" }] });
    expect(screen.getByText("Earlier · used")).toBeTruthy();
    expect(screen.getByText("Earlier · sent anyway")).toBeTruthy();
  });
});

describe("after-reply card (spec §4.2)", () => {
  const AFTER: SidekickCard = { id: "a1", moment: "after", kind: "gap", speaker: SK_ON.info, prompt: "Outline", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", after: { gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" } };

  it("shows the gap and the next prompt; Put in composer and Dismiss", async () => {
    const h = handlers();
    await panel({ ...SK_ON, cards: [AFTER] }, h);
    expect(screen.getByRole("heading", { name: "After the reply" })).toBeTruthy();
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("No source for claim 2.")).toBeTruthy();
    expect(screen.getByText("Add a source for claim 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(h.onPutInComposer).toHaveBeenCalledWith("Add a source for claim 2");
    expect(h.onDismiss).toHaveBeenCalledWith("a1", "used");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(h.onDismiss).toHaveBeenLastCalledWith("a1", "dismissed");
  });

  it("a card with only a gap has Dismiss and no Put in composer; several cards show newest first", async () => {
    const { next: _n, ...gapOnly } = AFTER.after!;
    const older: SidekickCard = { ...AFTER, id: "a0", at: "2026-10-27T09:00:00Z", after: gapOnly };
    const newer: SidekickCard = { ...AFTER, id: "a2", at: "2026-10-27T11:00:00Z", after: { gap: { title: "Tone", text: "Too formal." } } };
    await panel({ ...SK_ON, cards: [older, newer] });
    expect(screen.queryByRole("button", { name: "Put in composer" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
    const titles = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(titles).toEqual(["Tone", "Sources"]);
  });
});

describe("heads-ups (spec §4.3, §7)", () => {
  const hu = (headsUp: NonNullable<SidekickCard["headsUp"]>, kind: string): SidekickCard => ({ id: `h-${kind}`, moment: "heads-up", kind, speaker: SK_ON.info, prompt: "", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", headsUp });

  it("the head counts them; each has its button and Dismiss", async () => {
    const h = await panel({ ...SK_ON, cards: [hu({ kind: "context", share: 0.8 }, "context"), hu({ kind: "repeated", topic: "APA style", decision: "Use APA 7." }, "repeated")] });
    expect(screen.getByText("2 heads-ups")).toBeTruthy();
    expect(screen.getByText("This task has used 80% of its context.")).toBeTruthy();
    expect(screen.getByText("You've asked about “APA style” three times. Save it as a decision?")).toBeTruthy();
    expect(screen.getByText("Use APA 7.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish task" }));
    expect(h.onFinishTask).toHaveBeenCalledWith("h-context");
    fireEvent.click(screen.getByRole("button", { name: "Save as decision" }));
    expect(h.onSaveDecision).toHaveBeenCalledWith("h-repeated");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(h.onDismiss).toHaveBeenCalledWith("h-repeated", "dismissed");
  });

  it("one heads-up reads singular; a live suggestion keeps the head's state", async () => {
    await panel({ ...SK_ON, cards: [hu({ kind: "off-phase", phase: "Draft" }, "off-phase")] });
    expect(screen.getByText("1 heads-up")).toBeTruthy();
    expect(screen.getByText("The last prompts belong to “Draft”.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish task" })).toBeTruthy();
    cleanup();
    await panel({ ...SK_ON, status: "suggestion", card: CARD, cards: [hu({ kind: "off-phase" }, "off-phase")] });
    expect(screen.getByText("Has a suggestion")).toBeTruthy();
    expect(screen.getByText("The last prompts belong to another phase.")).toBeTruthy();
  });

  it("Save as decision refused: the message shows and the card stays", async () => {
    const h = handlers();
    h.onSaveDecision.mockResolvedValue({ ok: false, message: "No open task" } as never);
    await panel({ ...SK_ON, cards: [hu({ kind: "repeated", topic: "APA style", decision: "Use APA 7." }, "repeated")] }, h);
    fireEvent.click(screen.getByRole("button", { name: "Save as decision" }));
    expect(await screen.findByText("Could not save the decision: No open task")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save as decision" })).toBeTruthy();
  });

  it("Save as decision refused without a message: the plain line, nothing dangling", async () => {
    const h = handlers();
    h.onSaveDecision.mockResolvedValue({ ok: false } as never);
    await panel({ ...SK_ON, cards: [hu({ kind: "repeated", topic: "APA style", decision: "Use APA 7." }, "repeated")] }, h);
    fireEvent.click(screen.getByRole("button", { name: "Save as decision" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save the decision.");
  });

  it("an after-reply card with neither gap nor next never shows", async () => {
    const empty: SidekickCard = { id: "a9", moment: "after", kind: "gap", speaker: SK_ON.info, prompt: "x", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", after: {} };
    await panel({ ...SK_ON, cards: [empty] });
    expect(screen.queryByRole("heading", { name: "After the reply" })).toBeNull();
    expect(screen.getByText("Watching")).toBeTruthy();
  });
});

describe("several sidekicks in the panel (spec §7)", () => {
  const RULO = { id: "rulo", name: "Rulo", mark: "🦊" };
  const base = { prompt: "", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z" };
  const rail = (state: SidekickState, onOpen = vi.fn()) => renderIn("en", <SidekickRail state={state} onOpen={onOpen} />).then(() => onOpen);

  it("every card names who speaks", async () => {
    await panel({ ...SK_ON, cards: [{ ...base, id: "a", moment: "after", kind: "next", speaker: RULO, after: { next: "Ask for sources", lesson: "Sources first." } }] });
    expect(screen.getByText("Rulo")).toBeTruthy();
    expect(screen.getByText("🦊")).toBeTruthy();
    expect(screen.getByText("Worth knowing")).toBeTruthy();
    expect(screen.getByText("Sources first.")).toBeTruthy();
  });

  it("with two or more sidekicks even the default one's cards name it; heads-ups too", async () => {
    await panel({ ...SK_ON, sidekicks: [SK_ON.info, RULO], status: "suggestion", card: CARD, cards: [{ ...base, id: "h", moment: "heads-up", kind: "context", speaker: RULO, headsUp: { kind: "context", share: 0.8 } }] });
    const speakers = [...document.querySelectorAll(".hh-sk-speaker")].map((e) => e.textContent?.trim());
    expect(speakers).toEqual(["Sidekick", "🦊 Rulo"]);
  });

  it("a lesson alone shows (counted as a gap), with Dismiss and no Put in composer", async () => {
    const h = await panel({ ...SK_ON, cards: [{ ...base, id: "l", moment: "after", kind: "gap", speaker: RULO, after: { lesson: "Cite before you claim." } }] });
    expect(screen.getByRole("heading", { name: "After the reply" })).toBeTruthy();
    expect(screen.getByText("Cite before you claim.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Put in composer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(h.onDismiss).toHaveBeenCalledWith("l", "dismissed");
  });

  it("phase-change and daily cards", async () => {
    const h = await panel({ ...SK_ON, cards: [
      { ...base, id: "p", moment: "phase-change", kind: "missing", speaker: RULO, guard: { missing: ["No agreed section list"] } },
      { ...base, id: "d", moment: "daily", kind: "daily", speaker: RULO, text: "Yesterday you outlined chapter 2." },
    ] });
    expect(screen.getByRole("heading", { name: "Before moving on" })).toBeTruthy();
    expect(screen.getByText("No agreed section list")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
    expect(screen.getByText("Yesterday you outlined chapter 2.")).toBeTruthy();
    // Newest first: the daily card, then the guard's.
    const dismiss = screen.getAllByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveLength(2);
    fireEvent.click(dismiss[0]!);
    expect(h.onDismiss).toHaveBeenCalledWith("d", "dismissed");
    fireEvent.click(dismiss[1]!);
    expect(h.onDismiss).toHaveBeenLastCalledWith("p", "dismissed");
  });

  it("before approving: its own title", async () => {
    await panel({ ...SK_ON, cards: [{ ...base, id: "b", moment: "before-approve", kind: "missing", speaker: RULO, guard: { missing: ["No sources section"] } }] });
    expect(screen.getByRole("heading", { name: "Before approving" })).toBeTruthy();
    expect(screen.getByText("No sources section")).toBeTruthy();
  });

  it("model text is plain text, never markup", async () => {
    await panel({ ...SK_ON, cards: [{ ...base, id: "d", moment: "daily", kind: "daily", speaker: RULO, text: "<b>bold</b> **x**" }] });
    expect(screen.getByText("<b>bold</b> **x**")).toBeTruthy();
    expect(document.querySelector(".hh-sk-panel b")).toBeNull();
  });

  it("the rail shows the waiting speakers' marks and the count", async () => {
    const onOpen = await rail({ ...SK_ON, cards: [{ ...base, id: "d", moment: "daily", kind: "daily", speaker: RULO, text: "y" }] });
    const button = screen.getByRole("button", { name: "Sidekick · 1 waiting" });
    expect(button.textContent).toContain("🦊");
    expect(button.querySelector(".hh-sk-dot")).toBeTruthy();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalled();
  });

  it("the rail lights for any waiting card; at most three distinct marks", async () => {
    const who = (id: string, mark: string) => ({ id, name: id, mark });
    const cards: SidekickCard[] = [
      { ...base, id: "1", moment: "heads-up", kind: "context", speaker: who("a", "🅰️"), headsUp: { kind: "context", share: 0.9 } },
      { ...base, id: "2", moment: "phase-change", kind: "missing", speaker: who("b", "🅱️"), guard: { missing: ["x"] } },
      { ...base, id: "3", moment: "after", kind: "gap", speaker: who("a", "🅰️"), after: { gap: { title: "t", text: "x" } } },
      { ...base, id: "4", moment: "after", kind: "gap", speaker: who("c", "©️"), after: { lesson: "x" } },
      { ...base, id: "5", moment: "daily", kind: "daily", speaker: who("d", "🇩"), text: "x" },
      // Never shown: neither counted nor marked.
      { ...base, id: "6", moment: "after", kind: "gap", speaker: who("e", "🇪"), after: {} },
    ];
    await rail({ ...SK_ON, status: "suggestion", card: CARD, cards });
    const button = screen.getByRole("button", { name: "Sidekick · 6 waiting" });
    expect(button.querySelectorAll(".hh-sk-mark")).toHaveLength(3);
    expect(button.textContent).not.toContain("🇪");
  });

  it("the rail with nothing waiting: the plain mark, Open Sidekick, no dot; off → grey", async () => {
    await rail(SK_ON);
    const button = screen.getByRole("button", { name: "Open Sidekick" });
    expect(button.querySelector(".hh-sk-dot")).toBeNull();
    expect(button.querySelector("svg.hh-sk-mark")).toBeTruthy();
    cleanup();
    await rail({ ...SK_ON, settings: { ...SK_ON.settings, on: false }, cards: [{ ...base, id: "d", moment: "daily", kind: "daily", speaker: RULO, text: "y" }] });
    expect(screen.getByRole("button", { name: "Open Sidekick" }).querySelector("svg.hh-sk-mark-off")).toBeTruthy();
  });

  it("D0: one sidekick → no speaker line on its cards", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: { ...CARD, moment: "pre", kind: "vague", speaker: SK_ON.info } });
    expect(screen.queryByText("Sidekick", { selector: ".hh-sk-speaker" })).toBeNull();
    expect(document.querySelector(".hh-sk-speaker")).toBeNull();
  });
});

describe("SidekickMark", () => {
  it("spark → the SVG; a --hh-* token → a dot in that colour; else the text", async () => {
    const { container } = await renderIn("en", <>
      <SidekickMark />
      <SidekickMark mark="--hh-accent" />
      <SidekickMark mark="🦊" />
      <SidekickMark mark="--hh-x;background:url(x)" />
    </>);
    expect(container.querySelectorAll("svg.hh-sk-mark")).toHaveLength(1);
    const dot = container.querySelector<HTMLElement>(".hh-sk-mark-dot");
    expect(dot?.style.background).toBe("var(--hh-accent)");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".hh-sk-mark-dot")).toHaveLength(1);
    expect(container.textContent).toContain("🦊");
    // Not a token name: shown as text, never put in a style.
    expect(container.textContent).toContain("--hh-x;background:url(x)");
  });
});

describe("cards in the soft-cards look (UI refresh spec §5.1)", () => {
  it("opens each card with its tag: Before you send orange, Next prompt blue, Worth knowing violet", async () => {
    const after: SidekickCard = { id: "a1", moment: "after", kind: "next", speaker: SK_ON.info, prompt: "Outline", flags: [], issues: [], confidence: 1, at: "2026-10-27T10:00:00Z", after: { next: "Add a source", lesson: "Sources first." } };
    await panel({ ...SK_ON, status: "suggestion", card: CARD, cards: [after] });
    expect(screen.getByText("Before you send").className).toContain("hh-tag-orange");
    expect(screen.getByText("Next prompt").className).toContain("hh-tag-blue");
    expect(screen.getByText("Worth knowing").className).toContain("hh-tag-violet");
    expect(screen.getByRole("heading", { name: "Before you send" })).toBeTruthy();
  });

  it("names Sidekick's state in a green tag while it is on, and its actions are pills", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: CARD });
    expect(screen.getByText("Has a suggestion").className).toContain("hh-tag-green");
    expect(screen.getByRole("button", { name: "Send anyway" }).className).toContain("hh-pill");
  });
});
