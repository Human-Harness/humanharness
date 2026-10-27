import { describe, expect, it } from "vitest";
import { type Review, type ReviewComment, answerQuestion, batchMessage, isUnsent, markSent, nextCommentId, reviewStatus, summarizeReview } from "../src/review";

const TEXT = "## Scope\n\nFilter by size.\n";
const question = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c1",
  author: "agent",
  kind: "question",
  anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 },
  text: "Which filter?",
  options: [
    { label: "Size", text: "Filter by size." },
    { label: "Size and colour", text: "Filter by size and colour." },
  ],
  blocking: true,
  state: "open",
  replies: [],
  at: "2026-10-28T10:00:00.000Z",
  ...over,
});

describe("answerQuestion", () => {
  it("swaps the passage, keeps the original, and follows the new text", () => {
    const r = answerQuestion(TEXT, question(), 1);
    expect(r).toMatchObject({ ok: true, text: "## Scope\n\nFilter by size and colour.\n" });
    if (!r.ok) throw new Error();
    expect(r.comment).toMatchObject({ answer: { option: 1 }, original: "Filter by size.", state: "answered", anchor: { quote: "Filter by size and colour." } });
  });

  it("changes the answer there and back, and 'no answer' puts the original back", () => {
    const one = answerQuestion(TEXT, question(), 1);
    if (!one.ok || !one.text) throw new Error();
    const zero = answerQuestion(one.text, one.comment, 0);
    if (!zero.ok || !zero.text) throw new Error();
    expect(zero.text).toBe(TEXT);
    const again = answerQuestion(zero.text, zero.comment, 1);
    if (!again.ok || !again.text) throw new Error();
    const none = answerQuestion(again.text, again.comment, null);
    expect(none).toMatchObject({ ok: true, text: TEXT, comment: { state: "open", anchor: { quote: "Filter by size." } } });
    if (!none.ok) throw new Error();
    expect(none.comment.answer).toBeUndefined();
    expect(none.comment.original).toBeUndefined();
  });

  it("an option equal to the quote is a valid 'keep it'", () => {
    expect(answerQuestion(TEXT, question(), 0)).toMatchObject({ ok: true, text: TEXT, comment: { answer: { option: 0 } } });
  });

  it("'Other' keeps the passage and is unsent", () => {
    const r = answerQuestion(TEXT, question(), { other: " Only in the session " });
    expect(r).toMatchObject({ ok: true, text: null, comment: { answer: { other: "Only in the session" }, state: "answered" } });
    if (!r.ok) throw new Error();
    expect(isUnsent(r.comment)).toBe(true);
  });

  it("swap guard: a rewritten passage makes the answer unapplied, to be sent", () => {
    const r = answerQuestion("## Scope\n\nSomething else.\n", question(), 1);
    expect(r).toMatchObject({ ok: true, text: null, comment: { answer: { option: 1 }, unapplied: true } });
    if (!r.ok) throw new Error();
    expect(isUnsent(r.comment)).toBe(true);
  });

  it("refuses a bad option, a comment, a resolved question", () => {
    expect(answerQuestion(TEXT, question(), 5)).toEqual({ ok: false, reason: "bad-option" });
    expect(answerQuestion(TEXT, question(), { other: "  " })).toEqual({ ok: false, reason: "bad-option" });
    expect(answerQuestion(TEXT, question({ kind: "comment", options: undefined }), 0)).toEqual({ ok: false, reason: "not-a-question" });
    expect(answerQuestion(TEXT, question({ state: "resolved" }), 0)).toEqual({ ok: false, reason: "resolved" });
  });
});

const review = (comments: ReviewComment[], approvals: Review["approvals"] = []): Review => ({ path: "specs/a.md", task: null, comments, approvals });
const BLOB = "a".repeat(40);

describe("status and summary", () => {
  it("none, draft, approved, stale", () => {
    expect(reviewStatus(null, BLOB)).toBe("none");
    expect(reviewStatus(review([]), BLOB)).toBe("draft");
    expect(reviewStatus(review([], [{ blob: BLOB, at: "t" }]), BLOB)).toBe("approved");
    expect(reviewStatus(review([], [{ blob: BLOB, at: "t" }]), "b".repeat(40))).toBe("stale");
  });

  it("counts open questions, blocking ones, unsent items and live comments", () => {
    const draft: ReviewComment = { ...question({ id: "c2", author: "person", kind: "comment", options: undefined, blocking: undefined }), state: "draft", text: "No." };
    const s = summarizeReview(review([question(), question({ id: "c3", blocking: false, state: "resolved" }), draft], [{ blob: BLOB, at: "t1" }]), BLOB);
    expect(s).toEqual({ status: "approved", questions: 1, blocking: 1, unsent: 1, comments: 2, approvedAt: "t1" });
  });
});

describe("the batch", () => {
  it("lists drafts and custom answers in the spec's shape", () => {
    const draft: ReviewComment = {
      ...question({ id: "c4", author: "person", kind: "comment", options: undefined, blocking: undefined }),
      text: "Esto no, tiene que ser por talle y color.",
      state: "draft",
    };
    const other = question({ id: "c2", text: "¿Se guarda el filtro?", answer: { other: "Solo en la sesión, no en la cuenta." }, state: "answered" });
    const b = batchMessage("tickets/SHOP-142/spec.md", review([other, draft, question()]), TEXT);
    expect(b?.ids).toEqual(["c4", "c2"]);
    expect(b?.message).toBe(
      [
        "Review round for tickets/SHOP-142/spec.md.",
        "Comments:",
        '- c4 on "Filter by size." (## Scope): "Esto no, tiene que ser por talle y color."',
        "Custom answers:",
        '- c2 "¿Se guarda el filtro?": "Solo en la sesión, no en la cuenta."',
        "Edit the document, then answer each one with reply_to_comment.",
      ].join("\n"),
    );
  });

  it("says when an option could not be swapped in; null when nothing is unsent", () => {
    const b = batchMessage("a.md", review([question({ answer: { option: 1 }, unapplied: true, state: "answered" })]), TEXT);
    expect(b?.message).toContain('- c1 "Which filter?": picked "Size and colour", but the passage changed: write it as "Filter by size and colour."');
    expect(batchMessage("a.md", review([question()]), TEXT)).toBeNull();
  });

  it("markSent moves the listed items to sent, and ids go up", () => {
    const r = markSent(review([question({ state: "draft" }), question({ id: "c7" })]), ["c1"]);
    expect(r.comments.map((c) => c.state)).toEqual(["sent", "open"]);
    expect(nextCommentId(r)).toBe("c8");
    expect(nextCommentId(review([]))).toBe("c1");
  });
});
