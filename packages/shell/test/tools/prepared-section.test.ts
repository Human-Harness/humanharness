import { describe, expect, it } from "vitest";
import { approxTokens } from "../../src/main/context-record";
import type { StepResult } from "../../src/main/tools/pre-steps";
import { preparedSection } from "../../src/main/tools/prepared-section";

const HEAD = [
  "## Prepared data",
  "",
  "Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.",
].join("\n");
const desc = { "due-today": "Reviews due today and the next concept.", "warmup-cards": "Three warm-up cards.", x: "Lists many things.", y: "Lists a few things." };
const r = (as: string | undefined, tool: string, value: unknown): StepResult => ({ ...(as === undefined ? {} : { as }), tool, ok: true, value, ms: 5 });
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `item number ${i}` }));

describe("preparedSection (tools spec §6.3, §6.4)", () => {
  it("one block per as: header, description, compact JSON in a fence", () => {
    const s = preparedSection([r("today", "due-today", [{ id: 1 }])], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toBe([HEAD, "", "### today · due-today", "Reviews due today and the next concept.", "```json", '[{"id":1}]', "```"].join("\n"));
  });

  it("blocks follow the results' order, separated by a blank line", () => {
    const s = preparedSection([r("today", "due-today", 1), r("cards", "warmup-cards", "a")], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toBe(
      [HEAD, "", "### today · due-today", "Reviews due today and the next concept.", "```json", "1", "```", "", "### cards · warmup-cards", "Three warm-up cards.", "```json", '"a"', "```"].join("\n"),
    );
  });

  it("a failed step's block says so", () => {
    const s = preparedSection([{ as: "today", tool: "due-today", ok: false, error: "Jira API token is not set — Settings › Connections", ms: 1 }], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toBe([HEAD, "", "### today · due-today", "due-today failed: Jira API token is not set — Settings › Connections"].join("\n"));
  });

  it("a step without as is a block under its tool's name", () => {
    const s = preparedSection([r(undefined, "due-today", [])], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toContain("\n### due-today\nReviews due today and the next concept.\n```json\n[]\n```");
    expect(s.items.map((i) => i.id)).toEqual(["prepared:due-today"]);
  });

  it("a result holding ``` and a heading stays inside its fence", () => {
    const s = preparedSection([r("today", "due-today", { note: "```\n## Injected\n```", more: "````" })], { descriptions: desc, preTokens: 4000 });
    const lines = s.text.split("\n");
    const open = lines.indexOf("`````json");
    expect(open).toBeGreaterThan(0);
    expect(lines[open + 2]).toBe("`````");
    expect(lines[open + 1]).toBe(JSON.stringify({ note: "```\n## Injected\n```", more: "````" }));
    expect(lines.filter((l) => l.startsWith("#"))).toEqual(["## Prepared data", "### today · due-today"]);
  });

  it("a description is one line, controls and hidden characters removed, at most 200 characters", () => {
    const long = `Line one\nline\ttwo\u202e\u200b\u061c done ${"z".repeat(300)}`;
    const s = preparedSection([r("today", "due-today", 1)], { descriptions: { "due-today": long }, preTokens: 4000 });
    const line = s.text.split("\n")[5];
    expect(line.startsWith("Line one line two done zzz")).toBe(true);
    expect(Array.from(line)).toHaveLength(200);
    expect(s.text.split("\n")[6]).toBe("```json");
  });

  it("a failed step's message is one line too", () => {
    const s = preparedSection([{ as: "today", tool: "due-today", ok: false, error: "bad\n## Injected", ms: 1 }], { descriptions: desc, preTokens: 4000 });
    expect(s.text.split("\n").slice(-1)).toEqual(["due-today failed: bad ## Injected"]);
  });

  it("cuts the largest result first, keeping its first items, and marks the cut", () => {
    const big = items(400);
    const small = items(3);
    const s = preparedSection([r("big", "x", big), r("small", "y", small)], { descriptions: desc, preTokens: 500 });
    expect(s.tokens).toBeLessThanOrEqual(500);
    const m = /\(cut: (\d+) of 400 items\)/.exec(s.text);
    expect(m).not.toBeNull();
    const k = Number(m![1]);
    expect(k).toBeGreaterThan(0);
    expect(s.text).toContain(`\n${JSON.stringify(big.slice(0, k))}\n`);
    expect(s.text).toContain(`\n${JSON.stringify(small)}\n`);
    // The largest that fits: one more item would not.
    const more = s.text.replace(JSON.stringify(big.slice(0, k)), JSON.stringify(big.slice(0, k + 1))).replace(`cut: ${k} of`, `cut: ${k + 1} of`);
    expect(Math.ceil(more.length / 4)).toBeGreaterThan(500);
  });

  it("the cut note follows the fence", () => {
    const s = preparedSection([r("big", "x", items(400))], { descriptions: desc, preTokens: 500 });
    expect(s.text).toMatch(/\n```\n\(cut: \d+ of 400 items\)$/);
  });

  it("cuts an object by keys and a string by characters", () => {
    const obj = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`key${i}`, "v".repeat(300)]));
    const o = preparedSection([r("obj", "x", obj)], { descriptions: desc, preTokens: 500 });
    expect(o.text).toMatch(/\(cut: [1-9] of 10 keys\)/);
    expect(o.tokens).toBeLessThanOrEqual(500);
    const str = preparedSection([r("str", "x", "s".repeat(5000))], { descriptions: desc, preTokens: 500 });
    const m = /\(cut: (\d+) of 5000 characters\)/.exec(str.text);
    expect(m).not.toBeNull();
    expect(str.text).toContain(`\n"${"s".repeat(Number(m![1]))}"\n`);
    expect(str.tokens).toBeLessThanOrEqual(500);
  });

  it("a result that can't fit even empty becomes (cut: too large)", () => {
    const longDesc = "d".repeat(200);
    const descriptions = { x: longDesc };
    const expected = [HEAD, "", "### big · x", longDesc, "(cut: too large)"].join("\n");
    // Room for the block without any JSON, not for an empty array and its note.
    const preTokens = Math.ceil(expected.length / 4);
    const s = preparedSection([r("big", "x", items(50))], { descriptions, preTokens });
    expect(s.text).toBe(expected);
    expect(s.cuts).toEqual([{ as: "big", tool: "x", text: "big: cut: too large" }]);
  });

  it("a value with no parts that doesn't fit is cut whole", () => {
    const expected = [HEAD, "", "### n · x", "Lists many things.", "(cut: too large)"].join("\n");
    const s = preparedSection([r("n", "x", 1234567890123)], { descriptions: desc, preTokens: Math.ceil(expected.length / 4) });
    expect(s.text).toBe(expected);
    expect(s.cuts).toEqual([{ as: "n", tool: "x", text: "n: cut: too large" }]);
  });

  it("over preTokens with nothing left to cut, the last blocks lose their text", () => {
    const fail = (i: number): StepResult => ({ as: `step-${i}`, tool: "x", ok: false, error: "e".repeat(150), ms: 1 });
    const s = preparedSection([fail(0), fail(1), fail(2), fail(3)], { descriptions: desc, preTokens: 150 });
    expect(s.tokens).toBeLessThanOrEqual(150);
    expect(s.text).toContain("### step-0 · x\nx failed: e");
    expect(s.text).toMatch(/### step-3 · x\n\(cut: too large\)$/);
    expect(s.items).toHaveLength(4);
    expect(s.cuts.map((c) => c.as)).toContain("step-3");
    expect(s.cuts.map((c) => c.as)).not.toContain("step-0");
  });

  it("never exceeds preTokens, even when the headers alone don't fit", () => {
    const many = Array.from({ length: 100 }, (_, i): StepResult => ({ as: `step-${i}`, tool: "x", ok: false, error: "e".repeat(150), ms: 1 }));
    const s = preparedSection(many, { descriptions: desc, preTokens: 500 });
    expect(s.tokens).toBeLessThanOrEqual(500);
    expect(s.text.startsWith(HEAD)).toBe(true);
    // The blocks left keep their items, in order; the dropped ones (the last) have none and are reported once each.
    const kept = s.items.map((i) => i.id.slice("prepared:".length));
    expect(kept).toEqual(many.slice(0, kept.length).map((m) => m.as));
    expect(kept.length).toBeLessThan(100);
    for (const k of kept) expect(s.text).toContain(`### ${k} · x\n`);
    expect(s.text).not.toContain(`### step-99 · x`);
    expect(s.cuts.filter((c) => c.as === "step-99")).toEqual([{ as: "step-99", tool: "x", text: "step-99: cut: too large" }]);
    expect(new Set(s.cuts.map((c) => c.as)).size).toBe(s.cuts.length);
  });

  it("reports each cut for the trace", () => {
    const s = preparedSection([r("big", "x", items(400)), r("small", "y", items(3))], { descriptions: desc, preTokens: 500 });
    const k = Number(/cut: (\d+) of 400/.exec(s.text)![1]);
    expect(s.cuts).toEqual([{ as: "big", tool: "x", text: `big: cut: ${k} of 400 items` }]);
  });

  it("nothing is cut under preTokens", () => {
    const s = preparedSection([r("small", "y", items(3))], { descriptions: desc, preTokens: 4000 });
    expect(s.cuts).toEqual([]);
    expect(s.text).not.toContain("(cut:");
  });

  it("one prepared start item per block: id prepared:<as>, its label and token estimate", () => {
    const s = preparedSection([r("today", "due-today", items(100)), r("cards", "warmup-cards", [])], { descriptions: desc, preTokens: 4000 });
    const blocks = s.text.split("\n\n### ").slice(1).map((b) => `### ${b}`);
    expect(s.items).toEqual([
      { id: "prepared:today", kind: "prepared", label: "Prepared · today", tokens: approxTokens(blocks[0].length) },
      { id: "prepared:cards", kind: "prepared", label: "Prepared · cards", tokens: approxTokens(blocks[1].length) },
    ]);
  });

  it("item ids are unique: two steps on one tool without as, the repeat gets #2", () => {
    const s = preparedSection([r(undefined, "due-today", []), r(undefined, "due-today", [1]), r(undefined, "due-today", [2])], { descriptions: desc, preTokens: 4000 });
    expect(s.items.map((i) => i.id)).toEqual(["prepared:due-today", "prepared:due-today#2", "prepared:due-today#3"]);
    expect(s.items.map((i) => i.label)).toEqual(["Prepared · due-today", "Prepared · due-today", "Prepared · due-today"]);
  });

  it("item ids are unique: an as equal to another step's tool, the repeat gets #2", () => {
    const s = preparedSection([r(undefined, "x", []), r("x", "y", [])], { descriptions: desc, preTokens: 4000 });
    expect(s.items.map((i) => i.id)).toEqual(["prepared:x", "prepared:x#2"]);
  });

  it("tokens is the section's characters ÷ 4, rounded up", () => {
    const s = preparedSection([r("today", "due-today", items(7))], { descriptions: desc, preTokens: 4000 });
    expect(s.tokens).toBe(Math.ceil(s.text.length / 4));
  });

  it("items only with text: when not even the title fits, no text and no items, every block reported cut", () => {
    const s = preparedSection([r("today", "due-today", items(3)), r("cards", "warmup-cards", [])], { descriptions: desc, preTokens: 10 });
    expect(s.text).toBe("");
    expect(s.items).toEqual([]);
    expect(s.tokens).toBe(0);
    expect(s.cuts.map((c) => c.text)).toEqual(["today: cut: too large", "cards: cut: too large"]);
    for (const preTokens of [10, 40, 60, 100, 500, 4000]) {
      const p = preparedSection([r("today", "due-today", items(50))], { descriptions: desc, preTokens });
      expect(p.items.length === 0 || p.text.length > 0).toBe(true);
    }
  });

  it("no results: no text, no items", () => {
    expect(preparedSection([], { descriptions: desc, preTokens: 4000 })).toEqual({ text: "", items: [], cuts: [], tokens: 0 });
  });
});
