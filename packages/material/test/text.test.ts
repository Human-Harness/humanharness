import { describe, expect, it } from "vitest";
import { decodeText, locRange, markdownBlocks, textBlocks, withEstimatedPages } from "../src";

describe("decodeText (§3: UTF-8, falling back to Windows-1252)", () => {
  it("reads UTF-8, drops a BOM, and falls back for a Windows-1252 file", () => {
    expect(decodeText(Buffer.from("\uFEFFcafé", "utf8"))).toBe("café");
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });

  it("decodes UTF-16 when a BOM says so, little- or big-endian", () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("café ✓", "utf16le")]))).toBe("café ✓");
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("café ✓", "utf16le").swap16()]))).toBe("café ✓");
  });
});

describe("markdownBlocks", () => {
  it("reads headings, paragraphs, lists, tables, code and images, with line locations", () => {
    const md = ["# Fractions", "", "A fraction has two parts.", "It is written a/b.", "", "- one", "- two", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "```", "x = 1", "```", "", "![diagram](d.png)"].join("\n");
    const blocks = markdownBlocks(md);
    expect(blocks.map((b) => [b.kind, b.level ?? null, b.loc])).toEqual([
      ["heading", 1, "lines 1"],
      ["para", null, "lines 3–4"],
      ["list", null, "lines 6–7"],
      ["table", null, "lines 9–11"],
      ["code", null, "lines 13–15"],
      ["image", null, "lines 17"],
    ]);
    expect(blocks[1].md).toBe("A fraction has two parts.\nIt is written a/b.");
    expect(blocks[5].md).toBe("[image, lines 17]");
  });

  it("estimated pages: every PAGE_TOKENS tokens is a page", () => {
    const blocks = withEstimatedPages(markdownBlocks(Array.from({ length: 6 }, (_, i) => `${"word ".repeat(300)}${i}`).join("\n\n")));
    // Each paragraph is 376 tokens; a block's page is where it starts: 0, 376, 752, 1128, 1504, 1880 tokens in.
    expect(blocks.map((b) => b.page)).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe("locRange", () => {
  it("joins two marks with the same prefix into a range", () => {
    expect(locRange("p.4", "p.5")).toBe("p.4–5");
    expect(locRange("p.4", "p.4")).toBe("p.4");
    expect(locRange("lines 3–4", "lines 9–11")).toBe("lines 3–11");
    expect(locRange("slide 2", "slide 3")).toBe("slide 2–3");
    expect(locRange("§ A ¶2", "§ B ¶1")).toBe("§ A ¶2");
  });
});

describe("textBlocks (§3 plain text)", () => {
  it("plain text: paragraphs at blank lines, no headings", () => {
    const blocks = textBlocks("txt", Buffer.from("First line.\nStill first.\n\nSecond."));
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["para", "First line.\nStill first."],
      ["para", "Second."],
    ]);
  });

  it("JSON: one heading and one fenced block per top-level key", () => {
    const blocks = textBlocks("json", Buffer.from('{"name":"a","items":[1,2]}'));
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "## name"],
      ["code", '```json\n"a"\n```'],
      ["heading", "## items"],
      ["code", "```json\n[\n  1,\n  2\n]\n```"],
    ]);
  });

  it("YAML is cut at top-level keys; code at top-level definitions", () => {
    const yaml = textBlocks("yaml", Buffer.from("a: 1\nb:\n  c: 2\n"));
    expect(yaml.filter((b) => b.kind === "heading").map((b) => b.md)).toEqual(["## a", "## b"]);
    const code = textBlocks("code", Buffer.from("import x from 'y';\n\nexport function add(a, b) {\n  return a + b;\n}\n\nclass Box {}\n"));
    expect(code.filter((b) => b.kind === "heading").map((b) => b.md)).toEqual(["## export function add(a, b) {", "## class Box {}"]);
    expect(code[0]).toMatchObject({ kind: "code", md: "```\nimport x from 'y';\n```" });
  });

  it("code holding a fence line gets a longer fence, so the body can't close it", () => {
    const code = textBlocks("code", Buffer.from("const s = `\n```\n`;\n"));
    const block = code.find((b) => b.kind === "code");
    expect(block?.md).toBe("````\nconst s = `\n```\n`;\n````");
    expect(markdownBlocks(block?.md ?? "").map((b) => b.kind)).toEqual(["code"]);
  });

  it("an empty file has no blocks", () => {
    expect(textBlocks("txt", Buffer.from("  \n\n"))).toEqual([]);
  });
});
