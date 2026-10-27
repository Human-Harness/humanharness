// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidekickCard, SidekickState } from "../src/client";
import { SidekickPanel } from "../src/sidekick/SidekickPanel";
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
  onCollapse: vi.fn(), onTurnOn: vi.fn(), onNotNow: vi.fn(), onSendSuggested: vi.fn(), onEdit: vi.fn(), onSendAnyway: vi.fn(), onPutInComposer: vi.fn(), onView: vi.fn(),
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

  it("queued prompts: Put in composer and Drop", async () => {
    const h = await panel({ ...SK_ON, status: "suggestion", card: CARD });
    fireEvent.click(screen.getByRole("button", { name: "Put in composer" }));
    expect(h.onPutInComposer).toHaveBeenCalledWith("Translate chapter 2 into Spanish");
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(screen.queryByText("Translate chapter 2 into Spanish")).toBeNull();
  });

  it("queued prompts with the same text: Drop removes only the one pressed", async () => {
    await panel({ ...SK_ON, status: "suggestion", card: { ...CARD, queued: ["Same ask", "Same ask"] } });
    expect(screen.getAllByText("Same ask")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Drop" })[0]!);
    expect(screen.getAllByText("Same ask")).toHaveLength(1);
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
