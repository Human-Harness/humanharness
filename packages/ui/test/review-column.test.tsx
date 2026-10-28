// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Review } from "../src/client";
import { ReviewColumn } from "../src/ReviewColumn";
import { renderIn } from "./render";

afterEach(cleanup);
const TEXT = "## Scope\n\nFilter by size.\n\n```mermaid\ngraph TD; A-->B\n```\n";
const REVIEW: Review = {
  path: "specs/a.md",
  task: "t1",
  approvals: [],
  comments: [
    {
      id: "c1",
      author: "agent",
      kind: "question",
      anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 },
      text: "Size only?",
      options: [
        { label: "Keep", text: "Filter by size." },
        { label: "Colour too", text: "Filter by size and colour." },
      ],
      blocking: true,
      state: "open",
      replies: [],
      at: "2026-10-28T10:00:00.000Z",
    },
    { id: "c2", author: "agent", kind: "question", anchor: { quote: "A-->B", heading: "scope", occurrence: 0 }, text: "Arrow?", options: [{ label: "Yes", text: "A-->B" }, { label: "No", text: "A---B" }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" },
    { id: "c3", author: "person", kind: "comment", anchor: { quote: "gone", heading: null, occurrence: 0 }, text: "Hm", state: "resolved", replies: [{ author: "agent", text: "Done.", at: "2026-10-28T10:01:00.000Z" }], at: "2026-10-28T10:00:00.000Z" },
  ],
};

async function setup(over = {}) {
  const props = { review: REVIEW, text: TEXT, agent: "Claude", locked: false, waiting: null as string | null, active: null as string | null, onActive: vi.fn(), onAnswer: vi.fn(), onEditDraft: vi.fn(), onReopen: vi.fn(), ...over };
  await renderIn("en", <ReviewColumn {...props} />);
  return props;
}

describe("ReviewColumn (§6.1)", () => {
  it("is a 'Comments' region with a card per comment, the blocking badge, a diagram note and a lost note", async () => {
    await setup();
    const col = screen.getByRole("region", { name: "Comments" });
    expect(col.querySelectorAll("article")).toHaveLength(3);
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(screen.getByText("In the diagram of § Scope")).toBeTruthy();
    expect(screen.getByText("This passage is no longer in the document")).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("an option, 'No answer' and 'Other…' answer the question", async () => {
    // Answered with "Keep": "No answer" is not checked, so picking it is a change.
    const answered: Review = { ...REVIEW, comments: REVIEW.comments.map((c) => (c.id === "c1" ? { ...c, answer: { option: 0 }, state: "answered" } : c)) };
    const p = await setup({ review: answered });
    expect((screen.getAllByRole("radio", { name: "Keep" })[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getAllByRole("radio", { name: "Colour too" })[0]);
    expect(p.onAnswer).toHaveBeenCalledWith("c1", 1);
    fireEvent.click(screen.getAllByRole("radio", { name: "No answer" })[0]);
    expect(p.onAnswer).toHaveBeenCalledWith("c1", null);
    fireEvent.click(screen.getAllByRole("button", { name: "Other…" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "Only in the session" } });
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(p.onAnswer).toHaveBeenCalledWith("c1", { other: "Only in the session" });
  });

  it("an answered question says it can change until approval; not before an answer, not once approved", async () => {
    const HINT = "You can change the answer until you approve";
    await setup();
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();
    const answered: Review = { ...REVIEW, comments: REVIEW.comments.map((c) => (c.id === "c1" ? { ...c, answer: { option: 0 }, state: "answered" } : c)) };
    await setup({ review: answered });
    expect(screen.getAllByText(HINT)).toHaveLength(1);
    cleanup();
    await setup({ review: answered, locked: true });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("locked: the options are disabled and say why; waiting: the card says so", async () => {
    await setup({ locked: true, waiting: "c1" });
    expect((screen.getAllByRole("radio", { name: "Keep" })[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Approved: answers are locked until the document changes")).toBeTruthy();
    expect(screen.getByText("Waiting for the turn to end")).toBeTruthy();
  });

  it("a resolved comment can be reopened", async () => {
    const p = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(p.onReopen).toHaveBeenCalledWith("c3");
  });

  it("a click on a card asks to scroll to its mark; hover only makes it active", async () => {
    const p = await setup();
    const card = screen.getByRole("region", { name: "Comments" }).querySelector<HTMLElement>('[data-comment="c3"]')!;
    fireEvent.mouseEnter(card);
    expect(p.onActive).toHaveBeenLastCalledWith("c3");
    fireEvent.click(card);
    expect(p.onActive).toHaveBeenLastCalledWith("c3", true);
  });

  it("cards are reachable by keyboard and named by their header; focusing a card scrolls to its mark", async () => {
    const p = await setup();
    const card = screen.getByRole("article", { name: "You Resolved" });
    expect(card.tabIndex).toBe(0);
    expect(screen.getByRole("article", { name: "Question Claude Blocking Open" })).toBeTruthy();
    fireEvent.focus(card);
    expect(p.onActive).toHaveBeenLastCalledWith("c3", true);
    fireEvent.focus(screen.getByRole("button", { name: "Reopen" }));
    expect(p.onActive).toHaveBeenLastCalledWith("c3", false);
  });

  it("an 'Other' answer is shown as text", async () => {
    const answered: Review = { ...REVIEW, comments: [{ ...REVIEW.comments[0], answer: { other: "<i>Only</i> in the session" }, state: "answered" }] };
    await setup({ review: answered });
    expect(screen.getByText("<i>Only</i> in the session")).toBeTruthy();
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
  });

  it("a draft can be edited and deleted; card text is never HTML", async () => {
    const draft: Review = { ...REVIEW, comments: [{ id: "c4", author: "person", kind: "comment", anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 }, text: "<b>bold</b>", state: "draft", replies: [], at: "2026-10-28T10:00:00.000Z" }] };
    const p = await setup({ review: draft });
    expect(screen.getByText("<b>bold</b>")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit" }), { target: { value: "Better" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onEditDraft).toHaveBeenCalledWith("c4", "Better");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(p.onEditDraft).toHaveBeenCalledWith("c4", null);
  });
});
