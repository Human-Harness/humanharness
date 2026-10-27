import { describe, expect, it } from "vitest";
import { type CheckContext, localCheck } from "../src/sidekick-checks";

const ctx: CheckContext = { minWords: 6, known: ["Chapter 2 outline", "Sources list"] };
const kinds = (prompt: string, c: CheckContext = ctx) => localCheck(prompt, c).map((f) => f.kind);

describe("localCheck", () => {
  it("passes a concrete prompt", () => {
    expect(kinds("Rewrite the second paragraph of chapter 2 so it cites Smith 2019 and stays under 120 words.")).toEqual([]);
  });

  it("vague: a vague word in a short prompt, with its span", () => {
    const [flag] = localCheck("make it better", ctx);
    expect(flag.kind).toBe("vague");
    expect(flag.match).toBe("better");
    expect("make it better".slice(...flag.span)).toBe("better");
  });

  it("vague: a long prompt with nothing concrete beside the vague words", () => {
    expect(kinds("please fix it and improve the stuff so that everything works well for us")).toContain("vague");
  });

  it("vague: not when something concrete is beside it (a number, a quote, a path)", () => {
    expect(kinds('make the intro better: use "In 2019" as the opening and keep it under 80 words')).toEqual([]);
  });

  it("missing-context: a reference with nothing attached and no known title", () => {
    expect(kinds("Summarize the sources like before, in bullet points please")).toContain("missing-context");
  });

  it("vague: a short prompt is flagged even beside something concrete", () => {
    const [flag] = localCheck("make it better 2", ctx);
    expect(flag.kind).toBe("vague");
  });

  it("contractions, a lone quote and 'e.g.' are not concrete", () => {
    expect(kinds("please don't just improve it, it's the stuff that matters for us all here")).toContain("vague");
    expect(kinds("summarize the sources like before, e.g. the usual way we did it, i.e. short")).toContain("missing-context");
    expect(kinds("I can't remember, summarize the sources like before for the team today")).toContain("missing-context");
  });

  it("paired quotes, backticks and file names are still concrete", () => {
    expect(kinds("summarize the sources like before but start with 'Methods' for the team")).not.toContain("missing-context");
    expect(kinds("summarize the sources like before and keep `refs` short for the team")).not.toContain("missing-context");
    expect(kinds("summarize the sources like before into notes.md for the whole team")).not.toContain("missing-context");
  });

  it("missing-context: match and span point at the reference", () => {
    const prompt = "Summarize the sources like before, in bullet points please";
    const flag = localCheck(prompt, ctx).find((f) => f.kind === "missing-context")!;
    expect(flag.match).toBe("the sources");
    expect(prompt.slice(...flag.span)).toBe("the sources");
  });

  it("missing-context: not when a known note or data title is named", () => {
    expect(kinds("Use the sources from Sources list to write the conclusion of the essay")).not.toContain("missing-context");
  });

  it("two-asks: two imperative clauses joined by 'and also'", () => {
    const flags = localCheck("Write the introduction for chapter 3 and also translate chapter 2 into Spanish", ctx);
    expect(flags.map((f) => f.kind)).toContain("two-asks");
  });

  it("two-asks: two imperative lines", () => {
    expect(kinds("Write the introduction for chapter 3\nTranslate chapter 2 into Spanish")).toContain("two-asks");
  });

  it("two-asks: not for one ask over two lines", () => {
    expect(kinds("Write the introduction for chapter 3\nit should open with the 2019 study")).not.toContain("two-asks");
  });

  it("off-phase: words of another phase's label and none of the open one's", () => {
    const phases = { open: { id: "outline", label: "Outline" }, others: [{ id: "review", label: "Review citations" }] };
    expect(kinds("Check the citations in section 2 against the bibliography file", { ...ctx, phases })).toContain("off-phase");
    expect(kinds("Outline the citations section with 5 headings for chapter 2", { ...ctx, phases })).not.toContain("off-phase");
  });

  it("drops muted kinds", () => {
    expect(kinds("make it better", { ...ctx, muted: ["vague"] })).toEqual([]);
  });

  it("matches whole words in any script, case-insensitive", () => {
    expect(kinds("Betterment of the 2019 table in chapter 4 please, with the totals")).toEqual([]);
    expect(kinds("Make it BETTER")).toContain("vague");
  });

  it("is fast: 10 000 characters under 50 ms", () => {
    const long = "Write the introduction and also fix it. ".repeat(250);
    const t0 = performance.now();
    localCheck(long, ctx);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
