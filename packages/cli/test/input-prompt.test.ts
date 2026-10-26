import type { InputSpec } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { promptAnswer } from "../src/input-prompt";
import { memoryStream } from "./helpers";

const L = (en: string) => ({ es: en, en });
const commit: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why?"), optional: false },
  ],
  skippable: true,
};
const asker = (answers: string[]) => {
  const asked: string[] = [];
  return { asked, ask: async (q: string) => (asked.push(q), answers.length > 0 ? answers.shift()! : null) };
};

describe("promptAnswer", () => {
  it("asks each field: a choice by its number from the shown options, then a text", async () => {
    const out = memoryStream();
    const { ask, asked } = asker(["", "2", "two halves"]);
    expect(await promptAnswer(commit, { options: ["Me", "Both the same"] }, ask, out.stream, "en")).toEqual({ choice: "Both the same", why: "two halves" });
    expect(asked).toEqual(["Skip this question? (y/N) ", "I pick (optional) (number): ", "Why?: "]);
    expect(out.text()).toContain("  1. Me\n  2. Both the same\n");
  });

  it("skips; null when the input ends", async () => {
    expect(await promptAnswer(commit, {}, asker(["y"]).ask, memoryStream().stream, "en")).toEqual({ skipped: true });
    expect(await promptAnswer(commit, {}, asker([""]).ask, memoryStream().stream, "en")).toBeNull();
  });

  it("pairs repeat until an empty line; booleans, numbers and multi-choices", async () => {
    const spec: InputSpec = {
      fields: [
        { name: "cards", kind: "pairs", label: L("Cards"), optional: false, columns: [{ name: "front", label: L("Front") }, { name: "back", label: L("Back") }] },
        { name: "sure", kind: "boolean", label: L("Sure"), optional: false },
        { name: "count", kind: "number", label: L("Count"), optional: true },
        { name: "tags", kind: "multiChoice", label: L("Tags"), optional: false, options: ["a", "b", "c"] },
      ],
    };
    const { ask } = asker(["2+2", "4", "", "y", "", "1, 3"]);
    expect(await promptAnswer(spec, {}, ask, memoryStream().stream, "en")).toEqual({ cards: [{ front: "2+2", back: "4" }], sure: true, tags: ["a", "c"] });
  });

  it("a choice outside the list asks again, and never sends the typed text", async () => {
    const out = memoryStream();
    const { ask, asked } = asker(["", "3", "Me", "1, 2", "1", "why"]);
    expect(await promptAnswer(commit, { options: ["Me", "Both the same"] }, ask, out.stream, "en")).toEqual({ choice: "Me", why: "why" });
    expect(asked.filter((q) => q.startsWith("I pick"))).toHaveLength(4);
    expect(out.text()).toContain("  Pick one number from 1 to 2.\n");
  });

  it("a multi-choice keeps each option once, in the options' order; a bad number asks again", async () => {
    const spec: InputSpec = { fields: [{ name: "tags", kind: "multiChoice", label: L("Tags"), optional: false, options: ["a", "b", "c"] }] };
    const { ask, asked } = asker(["4", "3, 1, 3"]);
    expect(await promptAnswer(spec, {}, ask, memoryStream().stream, "en")).toEqual({ tags: ["a", "c"] });
    expect(asked).toHaveLength(2);
  });

  it("pairs with no columns end at once", async () => {
    const spec: InputSpec = { fields: [{ name: "cards", kind: "pairs", label: L("Cards"), optional: false, columns: [] }] };
    const out = memoryStream();
    const { ask, asked } = asker(["x"]);
    expect(await promptAnswer(spec, {}, ask, out.stream, "en")).toEqual({});
    expect(asked).toEqual([]);
    expect(out.text()).toContain("Cards: can't be answered here.");
  });
});
