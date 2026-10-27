import { describe, expect, it } from "vitest";
import { type Block, choiceOptions, defineBlock, inputSpec, isSkipped as sdkIsSkipped, readableAnswer, z } from "@humanharness/harness-sdk";
import { answerRows, isSkipped, optionsOf } from "../src/input";

// The window never imports the SDK at runtime, so `input.ts` copies a few of its rules. These cases keep both sides
// in step: a change to one that the other misses fails here.

const quiz = defineBlock({
  description: "Asks.",
  visible: true,
  schema: z.object({ question: z.string(), options: z.array(z.string()) }),
  input: z.object({
    choice: z.string().optional(),
    why: z.string().min(1),
    sure: z.boolean(),
    tags: z.array(z.enum(["a", "b", "c"])).optional(),
    score: z.number().optional(),
    cards: z.array(z.object({ front: z.string(), back: z.string() })).optional(),
  }),
  inputUi: { why: { label: "Why" } },
  example: { question: "q", options: ["x"] },
}) as Block;
const level = defineBlock({
  description: "Picks a level.",
  visible: true,
  schema: z.object({ question: z.string() }),
  input: z.object({ level: z.enum(["low", "high"]) }),
  example: { question: "q" },
}) as Block;

describe("ui input helpers agree with the SDK", () => {
  it("optionsOf = choiceOptions", () => {
    const spec = inputSpec(quiz);
    const choice = spec.fields.find((f) => f.name === "choice")!;
    const enumField = inputSpec(level).fields[0];
    const data: unknown[] = [{ question: "q", options: ["Me", "", 3, "Both"] }, { question: "q" }, null, "text", { options: "Me" }];
    for (const field of [choice, enumField]) {
      for (const d of data) expect(optionsOf(field, d)).toEqual(choiceOptions(field, d));
    }
  });

  it("isSkipped agrees on objects", () => {
    const values: Record<string, unknown>[] = [{ skipped: true }, { skipped: false }, { skipped: true, why: "x" }, {}, { skipped: "true" }];
    for (const v of values) expect(isSkipped(v)).toBe(sdkIsSkipped(v));
  });

  it("answerRows reads like readableAnswer, field by field", () => {
    expect(inputSpec(quiz).fields.map((f) => f.kind)).toEqual(["choice", "longText", "boolean", "multiChoice", "number", "pairs"]);
    const values: Record<string, unknown>[] = [
      { choice: "Me", why: "I had two halves", sure: true },
      { why: "porque sí", sure: false, tags: ["a", "c"], score: 3 },
      { why: "x", sure: true, cards: [{ front: "1/2", back: "0.5" }, { front: "1/4", back: "0.25" }] },
      { why: "y", sure: false, choice: "" },
    ];
    for (const v of values) {
      const rows = answerRows(inputSpec(quiz), v, ["yes", "no"]);
      expect(rows.map((r) => `${r.label}: ${r.text.trim()}`).join("\n\n")).toBe(readableAnswer(quiz, v));
    }
  });
});
