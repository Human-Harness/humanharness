// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotateBlock } from "../src/AnnotateBlock";
import { anchorMarks, answerText, findAnswer } from "../src/annotate";
import type { ChatEntry } from "../src/client";
import { renderIn } from "./render";

afterEach(cleanup);

const answer = { blockId: "t1:0:0", value: { choice: "Me", why: "Because two halves make one whole pizza" }, answeredAt: "a" };
const noActions = { respond: () => false, choose: () => false, open: async () => false, reveal: async () => false, active: false };

describe("annotate helpers", () => {
  it("anchors each quote at its first free place; a quote not found stays loose", () => {
    const r = anchorMarks("a b a", [{ quote: "a", kind: "ok" }, { quote: "a", kind: "gap" }, { quote: "z", kind: "note" }]);
    expect(r.placed.map((p) => [p.start, p.end, p.index])).toEqual([[0, 1, 0], [4, 5, 1]]);
    expect(r.loose.map((l) => l.index)).toEqual([2]);
  });

  it("finds the answer: by id, or the latest before the annotate's own entry", () => {
    const entry = (id: string, blocks: ChatEntry["blocks"]): ChatEntry => ({ id, role: "assistant", text: "", blocks, activities: [], at: "t" });
    const later = { ...answer, blockId: "t1:1:0", value: { why: "later" } };
    const entries = [
      entry("e1", [{ name: "commit_answer", data: {}, id: "t1:0:0", input: answer }]),
      entry("e2", [{ name: "annotate", data: {} }]),
      entry("e3", [{ name: "commit_answer", data: {}, id: "t1:1:0", input: later }]),
    ];
    expect(findAnswer(entries, "e2", "last")).toEqual(answer);
    expect(findAnswer(entries, null, "last")).toEqual(later);
    expect(findAnswer(entries, null, "t1:0:0")).toEqual(answer);
    expect(findAnswer(entries, "e2", "t1:1:0")).toBeNull();
    // An annotation whose entry isn't in the chat points to nothing rather than to the latest answer.
    expect(findAnswer(entries, "gone", "last")).toBeNull();
  });

  it("the text is the named field, else the answer's longest text", () => {
    expect(answerText(answer)).toBe("Because two halves make one whole pizza");
    expect(answerText(answer, "choice")).toBe("Me");
    expect(answerText(answer, "nope")).toBeNull();
  });
});

describe("AnnotateBlock", () => {
  it("marks the quotes in the person's words, each pointing to its note; a loose one is listed with its quote", async () => {
    const data = {
      ref: "last",
      marks: [
        { quote: "two halves", kind: "ok", comment: "Right." },
        { quote: "whole pizza", kind: "gap", comment: "Which pizza?" },
        { quote: "not there", kind: "note", comment: "Loose." },
      ],
    };
    await renderIn("en", <AnnotateBlock data={data} answerOf={(ref) => (ref === "last" ? answer : null)} {...noActions} />);
    expect(screen.getByRole("heading", { name: "Notes on your answer" })).toBeTruthy();
    const marks = [...document.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["two halves", "whole pizza"]);
    expect(marks[1].className).toBe("hh-mark gap");
    expect(marks[1].getAttribute("tabindex")).toBe("0");
    expect(document.getElementById(marks[1].getAttribute("aria-describedby")!)?.textContent).toBe("Missing Which pizza?");
    expect(screen.getByText("not there")).toBeTruthy();
  });

  it("says when the answer isn't in this chat, and still lists the notes", async () => {
    await renderIn("en", <AnnotateBlock data={{ ref: "t9:0:0", marks: [{ quote: "x", kind: "wrong", comment: "No." }] }} answerOf={() => null} {...noActions} />);
    expect(screen.getByText("The answer these notes are about isn't in this chat.")).toBeTruthy();
    expect(screen.getByText("Not right")).toBeTruthy();
  });

  it("a skipped answer and one with no text each say so", async () => {
    const marks = [{ quote: "x", kind: "note" }];
    const skipped = { blockId: "t1:0:0", value: { skipped: true }, answeredAt: "a" };
    await renderIn("en", <AnnotateBlock data={{ ref: "last", marks }} answerOf={() => skipped} {...noActions} />);
    expect(screen.getByText("The question these notes are about was skipped.")).toBeTruthy();
    cleanup();
    const numbers = { blockId: "t1:0:0", value: { count: 3 }, answeredAt: "a" };
    await renderIn("en", <AnnotateBlock data={{ ref: "last", marks }} answerOf={() => numbers} {...noActions} />);
    expect(screen.getByText("The answer these notes are about has no text to mark.")).toBeTruthy();
  });
});
