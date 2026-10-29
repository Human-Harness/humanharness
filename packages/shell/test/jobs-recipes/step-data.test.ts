import { describe, expect, it } from "vitest";
import { DATA_MAX_CHARS, dataSection } from "../../src/main/jobs/step-data";

/** The fences of a section, in order: each line made only of 3+ backticks, optionally followed by "json". */
const fences = (text: string) => text.split("\n").filter((l) => /^`{3,}(json)?$/.test(l));

/** True when every opening fence is closed by a fence of the same length, with nothing opened at the end. */
function balanced(text: string): boolean {
  let open: string | null = null;
  for (const l of fences(text)) {
    const ticks = /^`+/.exec(l)![0];
    if (open === null) open = ticks;
    else if (l === open) open = null;
  }
  return open === null;
}

describe("the AI step's ## Data (tools spec §7.1)", () => {
  it("one ### part per input, compact JSON in a fence", () => {
    expect(dataSection([{ name: "ci", value: [{ a: 1 }] }])).toBe('## Data\n\n### ci\n\n```json\n[{"a":1}]\n```');
  });

  it("several parts keep their order", () => {
    expect(dataSection([{ name: "a", value: 1 }, { name: "b", value: "x" }])).toBe(
      '## Data\n\n### a\n\n```json\n1\n```\n\n### b\n\n```json\n"x"\n```',
    );
  });

  it("undefined is written as null", () => {
    expect(dataSection([{ name: "a", value: undefined }])).toBe("## Data\n\n### a\n\n```json\nnull\n```");
  });

  it("a value holding ``` gets a longer fence and stays inside it", () => {
    const text = dataSection([{ name: "x", value: { s: "```\n## Data" } }]);
    expect(text).toContain("````json\n");
    expect(text.split("\n").filter((l) => l.startsWith("## ")).length).toBe(1);
    expect(text.split("\n").filter((l) => l.startsWith("#")).length).toBe(2);
    expect(balanced(text)).toBe(true);
  });

  it("a value's newlines and line separators stay escaped on one JSON line", () => {
    const text = dataSection([{ name: "x", value: "a\n### y\u2028\u2029\r\nb" }]);
    expect(text.split("\n").filter((l) => l.startsWith("#"))).toEqual(["## Data", "### x"]);
    for (const c of ["\u2028", "\u2029", "\r"]) expect(text).not.toContain(c);
  });

  it("hidden characters are written as \\u escapes, so the value stays exact and nothing hidden is sent raw", () => {
    const value = { s: "a\u202eb\u200bc\u0085d\u{E0041}e\u2028f" };
    const text = dataSection([{ name: "x", value }]);
    const json = text.split("\n")[5];
    expect(json).toBe('{"s":"a\\u202eb\\u200bc\\u0085d\\udb40\\udc41e\\u2028f"}');
    expect(JSON.parse(json)).toEqual(value);
  });

  it("a long backtick run in a value never closes its fence", () => {
    const text = dataSection([{ name: "x", value: "`".repeat(12) }, { name: "y", value: 1 }]);
    expect(text).toContain(`${"`".repeat(13)}json\n`);
    expect(balanced(text)).toBe(true);
  });

  it("cuts the section at DATA_MAX_CHARS and says so", () => {
    const text = dataSection([{ name: "x", value: "y".repeat(DATA_MAX_CHARS + 10) }]);
    expect(text.length).toBeLessThanOrEqual(DATA_MAX_CHARS + 200);
    expect(text).toMatch(/\(cut: the data is longer than \d+ characters\)$/);
  });

  it("a cut part keeps its fence closed, and later parts go", () => {
    const tick = "a`b``c```d".repeat(30_000);
    const text = dataSection([{ name: "a", value: 1 }, { name: "x", value: tick }, { name: "z", value: 2 }]);
    expect(text.length).toBeLessThanOrEqual(DATA_MAX_CHARS + 200);
    expect(balanced(text)).toBe(true);
    expect(text).toContain("### a\n\n```json\n1\n```");
    expect(text).toContain("### x\n\n````json\n");
    expect(text).not.toContain("### z");
    // The note is outside every fence: it follows the closing fence.
    expect(text).toMatch(/\n````\n\n\(cut: the data is longer than 200000 characters\)$/);
  });

  it("the cap holds with many parts", () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, value: "`".repeat(30_000) }));
    const text = dataSection(parts);
    expect(text.length).toBeLessThanOrEqual(DATA_MAX_CHARS + 200);
    expect(balanced(text)).toBe(true);
    expect(text).toMatch(/\(cut: the data is longer than 200000 characters\)$/);
  });

  it("a cut never splits a surrogate pair", () => {
    const text = dataSection([{ name: "x", value: "\u{1F600}".repeat(DATA_MAX_CHARS) }]);
    // A lone surrogate would not survive a UTF-8 round trip.
    expect(new TextDecoder().decode(new TextEncoder().encode(text))).toBe(text);
  });

  it("a name that isn't a TOOL_ID is refused (throws)", () => {
    expect(() => dataSection([{ name: "## x", value: 1 }])).toThrow();
    expect(() => dataSection([{ name: "x\ny", value: 1 }])).toThrow();
    expect(() => dataSection([{ name: "x\u2028", value: 1 }])).toThrow();
  });
});
