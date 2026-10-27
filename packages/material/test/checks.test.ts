import { describe, expect, it } from "vitest";
import { MAX, type MdBlock, type Piece, checkPieces, cutBlocks, cutRows, estimateTokens } from "../src";

const piece = (md: string, path = "A", extra: Partial<Piece> = {}): Piece => ({ path, md, location: "p.1", pages: [1], ...extra });
const prose = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} explains one idea clearly.`).join(" ");
const block = (kind: MdBlock["kind"], md: string, level?: number): MdBlock => ({ kind, md, loc: "p.1", page: 1, ...(level ? { level } : {}) });
// Two more sections after the one under test, so the source never counts as "only one or two fragments".
const tail = (level: number) => [block("heading", `${"#".repeat(level)} Next`, level), block("para", prose(30)), block("heading", `${"#".repeat(level)} Last`, level), block("para", prose(30))];

describe("checkPieces (material spec §6.1)", () => {
  it("passes clean prose", () => {
    const r = checkPieces([piece(`## A\n\n${prose(30)}`), piece(`## B\n\n${prose(30)}`, "B"), piece(`## C\n\n${prose(30)}`, "C")]);
    expect(r.flags).toEqual([[], [], []]);
    expect(r.sourceIssues).toEqual([]);
  });

  it("garbled: replacement characters, or mostly non-letters", () => {
    const r = checkPieces([piece(`${prose(20)} ��`), piece("%%$$##@@ 12 ;; ** ++ == -- !! ^^ && $$ %% @@ ## ;; ** ++ =="), piece(prose(30))]);
    expect(r.flags[0]).toContain("garbled");
    expect(r.flags[1]).toContain("garbled");
  });

  it("reading-order: paragraphs that stop mid-sentence and go on in lowercase", () => {
    const md = ["The numerator tells how many", "", "parts we take, and the denominator", "", "how many parts make the whole."].join("\n");
    expect(checkPieces([piece(md), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("reading-order");
  });

  it("size: far outside the range, unless kept whole; and a long source cut into one or two pieces", () => {
    const tiny = checkPieces([piece("Hi."), piece(prose(30)), piece(prose(30))]);
    expect(tiny.flags[0]).toContain("size");
    const whole = checkPieces([piece(prose(400), "Example 1", { whole: true }), piece(prose(30)), piece(prose(30))]);
    expect(whole.flags[0]).not.toContain("size");
    const two = checkPieces([piece(prose(300)), piece(prose(300))]);
    expect(two.sourceIssues).toContain("The whole file became only 2 fragments.");
  });

  it("size: a paragraph, list or table the cutter kept whole above MAX is flagged; an example kept whole is not", () => {
    const para = block("para", prose(100));
    const list = block("list", Array.from({ length: 100 }, (_, i) => `- Item ${i} explains one idea clearly.`).join("\n"));
    const table = block("table", ["| n | text |", "|---|---|", ...Array.from({ length: 90 }, (_, i) => `| ${i} | Row ${i} explains one idea clearly. |`)].join("\n"));
    for (const big of [para, list, table]) {
      // Above MAX but below twice MAX: one block the cutter can't split.
      expect(estimateTokens(big.md)).toBeGreaterThan(MAX);
      expect(estimateTokens(big.md)).toBeLessThan(MAX * 2);
      const pieces = cutBlocks([block("heading", "# Big", 1), big, ...tail(1)]);
      const at = pieces.findIndex((p) => estimateTokens(p.md) > MAX);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(checkPieces(pieces).flags[at]).toContain("size");
    }
    const example = cutBlocks([block("heading", "## Example 1", 2), para, ...tail(2)]);
    expect(example[0].whole).toBe(true);
    expect(checkPieces(example).flags[0]).not.toContain("size");
  });

  it("size: a code part above MAX (one huge line can't be split) is flagged", () => {
    const code = block("code", ["```js", `const data = "${"x".repeat(MAX * 4 + 400)}";`, "short();", "```"].join("\n"));
    const pieces = cutBlocks([block("heading", "# Code", 1), code, ...tail(1)]);
    const at = pieces.findIndex((p) => estimateTokens(p.md) > MAX);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(pieces[at].whole).toBeUndefined();
    expect(checkPieces(pieces).flags[at]).toContain("size");
  });

  it("no-structure: a long source with no headings", () => {
    const r = checkPieces(Array.from({ length: 6 }, () => piece(prose(60), "")));
    expect(r.sourceIssues).toContain("The file has no headings.");
    expect(r.flags.every((f) => f.includes("no-structure"))).toBe(true);
  });

  it("table: rows with different column counts", () => {
    expect(checkPieces([piece("| a | b |\n|---|---|\n| 1 | 2 | 3 |"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("table");
  });

  it("noise: a table of contents, an index or a bibliography", () => {
    const toc = Array.from({ length: 12 }, (_, i) => `Chapter ${i} .......... ${i * 10}`).join("\n");
    expect(checkPieces([piece(toc, "Contents"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("noise");
    expect(checkPieces([piece(prose(30), "Bibliography"), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("noise");
  });

  it("leftover: a line repeated in three or more fragments", () => {
    const running = "Mathematics 6 — Chapter 2";
    const r = checkPieces([piece(`${running}\n\n${prose(30)}`), piece(`${running}\n\n${prose(30)}`), piece(`${running}\n\n${prose(30)}`), piece(prose(30))]);
    expect(r.flags.slice(0, 3).every((f) => f.includes("leftover"))).toBe(true);
    expect(r.flags[3]).not.toContain("leftover");
  });

  it("tables and code are structure, not noise: a numeric sheet and a JSON fragment get no flags", () => {
    const header = "| Width | Height | Area |\n|---|---|---|";
    const numbers = (from: number) => Array.from({ length: 30 }, (_, i) => `| ${from + i}.5 | ${from + i}.25 | ${(from + i) * 9} |`).join("\n");
    const sheet = cutRows({ name: "Data", header, columns: ["Width", "Height", "Area"], rows: Array.from({ length: 300 }, (_, i) => ({ md: `| ${i}.5 | ${i}.25 | ${i * 9} |`, loc: `Data!A${i + 2}:C${i + 2}` })) });
    expect(sheet.length).toBeGreaterThanOrEqual(3);
    expect(checkPieces(sheet).flags.every((f) => f.length === 0)).toBe(true);
    expect(checkPieces([piece(`${header}\n${numbers(1)}`, "Data"), piece(`${header}\n${numbers(40)}`, "Data"), piece(`${header}\n${numbers(80)}`, "Data")]).flags).toEqual([[], [], []]);
    const json = (n: number) => ["```json", "{", ...Array.from({ length: 20 }, (_, i) => `  "key${n}_${i}": [1.5, 2.25, {"a": null}],`), '  "end": {}', "}", "```"].join("\n");
    expect(checkPieces([piece(`## A\n\n${json(1)}`, "A"), piece(`## B\n\n${json(2)}`, "B"), piece(`## C\n\n${json(3)}`, "C")]).flags).toEqual([[], [], []]);
    // A replacement character inside a fence is still garbled.
    expect(checkPieces([piece(`${json(1)}\n\n�`), piece(prose(30)), piece(prose(30))]).flags[0]).toContain("garbled");
  });

  it("size: a healthy file of about two TARGETs in two fragments is not flagged", () => {
    const r = checkPieces([piece(`## A\n\n${prose(45)}`, "A"), piece(`## B\n\n${prose(45)}`, "B")]);
    expect(r.sourceIssues).toEqual([]);
    expect(r.flags).toEqual([[], []]);
  });

  it("fenced lines are code: no leftover, no reading-order; an escaped bar is not a column", () => {
    const code = "```py\nimport numpy as np\n\nvalue = compute(x)\n\nresult = value * 2\n\nprint(result)\n```";
    const r = checkPieces([piece(`${prose(10)}\n\n${code}`), piece(`${prose(10)}\n\n${code}`, "B"), piece(`${prose(10)}\n\n${code}`, "C")]);
    expect(r.flags).toEqual([[], [], []]);
    const escaped = "| Expression | Meaning |\n|---|---|\n| a \\| b | a or b |\n| a & b | a and b |";
    expect(checkPieces([piece(escaped), piece(prose(30)), piece(prose(30))]).flags[0]).not.toContain("table");
  });

  it("no-structure: a long file with only a title; a long sheet is structured by its rows", () => {
    const titled = checkPieces(Array.from({ length: 6 }, () => piece(prose(60), "My notes")));
    expect(titled.sourceIssues).toContain("The file has no headings.");
    expect(titled.flags.every((f) => f.includes("no-structure"))).toBe(true);
    const header = "| Name | Note |\n|---|---|";
    const rows = Array.from({ length: 600 }, (_, i) => ({ md: `| Student ${i} | Passed the second exam well |`, loc: `S!A${i + 2}:B${i + 2}` }));
    const sheet = checkPieces(cutRows({ name: "S", header, columns: ["Name", "Note"], rows }));
    expect(sheet.sourceIssues).not.toContain("The file has no headings.");
  });
});
