import { describe, expect, it } from "vitest";
import { type MdBlock, cutBlocks, cutRows, estimateTokens, textBlocks } from "../src";

const h = (level: number, text: string, loc = "p.1", page = 1): MdBlock => ({ kind: "heading", level, md: `${"#".repeat(level)} ${text}`, loc, page });
const p = (words: number, loc = "p.1", page = 1): MdBlock => ({ kind: "para", md: `${"word ".repeat(words).trim()}.`, loc, page });

describe("cutBlocks (material spec §5)", () => {
  it("cuts at headings #–###, carrying the heading path", () => {
    const pieces = cutBlocks([h(1, "Fractions"), p(200), h(2, "Equivalent"), p(200), h(3, "Example 2"), p(200), h(4, "Deep"), p(10)]);
    expect(pieces.map((x) => x.path)).toEqual(["Fractions", "Fractions › Equivalent", "Fractions › Equivalent › Example 2"]);
    // A level-4 heading stays inside its section.
    expect(pieces[2].md).toContain("#### Deep");
  });

  it("splits a section above MAX at paragraph breaks into pieces near TARGET, never inside a paragraph", () => {
    const pieces = cutBlocks([h(1, "Long"), ...Array.from({ length: 8 }, () => p(240))]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const x of pieces) expect(estimateTokens(x.md)).toBeLessThanOrEqual(900);
    // Every piece after the first repeats no heading but keeps the path.
    expect(pieces.every((x) => x.path === "Long")).toBe(true);
  });

  it("merges a section below MIN with the next one under the same parent; a heading with no text joins its first child", () => {
    const pieces = cutBlocks([h(1, "A"), h(2, "Short"), p(20), h(2, "Next"), p(200), h(1, "B"), p(20)]);
    expect(pieces.map((x) => x.path)).toEqual(["A › Short", "B"]);
    expect(pieces[0].md).toContain("## Next");
  });

  it("keeps examples and exercises whole, even above MAX", () => {
    const pieces = cutBlocks([h(2, "Exercise 3"), ...Array.from({ length: 6 }, () => p(240))]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].whole).toBe(true);
  });

  it("a range of locations and the pages it spans", () => {
    const pieces = cutBlocks([h(1, "A", "p.4", 4), p(200, "p.4", 4), p(200, "p.5", 5)]);
    expect(pieces[0]).toMatchObject({ location: "p.4–5", pages: [4, 5] });
  });

  it("text before the first heading is a piece with an empty path", () => {
    expect(cutBlocks([p(200), h(1, "A"), p(200)]).map((x) => x.path)).toEqual(["", "A"]);
  });
});

describe("cutBlocks on structured data and code (blocks a converter keeps whole)", () => {
  it("splits an oversized code block by lines near TARGET, each part fenced again with its own line range", () => {
    const xml = `<root>\n${Array.from({ length: 400 }, (_, i) => `  <item id="${i}">value number ${i}</item>`).join("\n")}\n</root>\n`;
    const pieces = cutBlocks(textBlocks("xml", Buffer.from(xml)));
    expect(pieces.length).toBeGreaterThan(3);
    for (const x of pieces) {
      expect(estimateTokens(x.md)).toBeLessThanOrEqual(900);
      expect(x.md).toMatch(/^```xml\n[\s\S]*\n```$/);
    }
    expect(pieces[0].location).toMatch(/^lines 1–\d+$/);
    expect(pieces.at(-1)?.md).toContain("</root>");
    // Every line is kept, in order.
    const body = pieces.map((x) => x.md.replace(/^```xml\n|\n```$/g, "")).join("\n");
    expect(body).toBe(xml.trim());
  });

  it("a fenced block in Markdown: the parts' ranges leave out the fence lines", () => {
    const body = Array.from({ length: 300 }, (_, i) => `line number ${i + 2} of the code block`);
    const md = `\`\`\`ts\n${body.join("\n")}\n\`\`\`\n`;
    const pieces = cutBlocks(textBlocks("md", Buffer.from(md)));
    expect(pieces.length).toBeGreaterThan(1);
    const first = /^lines (\d+)–(\d+)$/.exec(pieces[0].location);
    expect(first?.[1]).toBe("2");
    // A part's first body line is the file's line its range starts at.
    for (const x of pieces) {
      const start = Number(/^lines (\d+)/.exec(x.location)?.[1]);
      expect(x.md.split("\n")[1]).toBe(`line number ${start} of the code block`);
    }
    expect(pieces.at(-1)?.location).toMatch(/–301$/);
  });

  it("XML with blank lines around it: the ranges are the file's lines", () => {
    const rows = Array.from({ length: 300 }, (_, i) => `  <item>line ${i + 4}</item>`);
    const xml = `\n\n<root>\n${rows.join("\n")}\n</root>\n\n`;
    const pieces = cutBlocks(textBlocks("xml", Buffer.from(xml)));
    expect(pieces[0].location).toMatch(/^lines 3–\d+$/);
    for (const x of pieces.slice(1)) {
      const start = Number(/^lines (\d+)/.exec(x.location)?.[1]);
      expect(x.md.split("\n")[1]).toBe(`  <item>line ${start}</item>`);
    }
    expect(pieces.at(-1)?.location).toMatch(/–304$/);
  });

  it("code inside an example kept whole stays one fenced block", () => {
    const code = Array.from({ length: 300 }, (_, i) => `step ${i} of the worked example`).join("\n");
    const pieces = cutBlocks(textBlocks("md", Buffer.from(`## Example 1\n\n\`\`\`\n${code}\n\`\`\`\n`)));
    expect(pieces).toHaveLength(1);
    expect(pieces[0].whole).toBe(true);
    expect(pieces[0].md.match(/```/g)).toHaveLength(2);
  });

  it("a JSON array of records is split too", () => {
    const json = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: i, name: `record ${i}` })));
    const pieces = cutBlocks(textBlocks("json", Buffer.from(json)));
    expect(pieces.length).toBeGreaterThan(1);
    for (const x of pieces) expect(estimateTokens(x.md)).toBeLessThanOrEqual(900);
    // The file is one line; the printed lines are not the file's, so no part claims a line range.
    expect(pieces.every((x) => x.location === "lines 1")).toBe(true);
  });

  it("merges a code file's many small top-level definitions into fragments of a useful size", () => {
    const code = Array.from({ length: 60 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const blocks = textBlocks("code", Buffer.from(code));
    expect(blocks.filter((b) => b.kind === "heading").length).toBeGreaterThan(50);
    const pieces = cutBlocks(blocks);
    expect(pieces.length).toBeLessThan(10);
    expect(pieces[0].md).toContain("const value0 = 0;");
  });
});

describe("cutRows (§3: spreadsheets are cut by rows)", () => {
  it("fragments of about TARGET tokens, each repeating the header row", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ md: `| ${i} | some value here | another value |`, loc: `Data!A${i + 2}:C${i + 2}` }));
    const pieces = cutRows({ name: "Data", header: "| n | a | b |\n|---|---|---|", columns: ["n", "a", "b"], rows });
    expect(pieces.length).toBeGreaterThan(2);
    for (const x of pieces) {
      expect(x.md.startsWith("| n | a | b |\n|---|---|---|\n")).toBe(true);
      expect(estimateTokens(x.md)).toBeLessThanOrEqual(700);
    }
    expect(pieces[0].location).toMatch(/^Data!A2:C\d+$/);
    expect(pieces[0].path).toBe("Data");
  });

  it("single-cell row locations make a plain range", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ md: `| value number ${i} with some padding text |`, loc: `S!A${i + 2}` }));
    const pieces = cutRows({ name: "S", header: "| a |\n|---|", columns: ["a"], rows });
    expect(pieces.length).toBeGreaterThan(1);
    for (const x of pieces) expect(x.location).toMatch(/^S!A\d+:A\d+$/);
  });
});
