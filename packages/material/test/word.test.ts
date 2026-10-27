import { describe, expect, it } from "vitest";
import { docxBlocks, odtBlocks, rtfBlocks } from "../src";
import JSZip from "jszip";
import { makeDocx, makeOdt } from "./make-office";

describe("docx (mammoth)", () => {
  it("headings from styles, paragraphs, and no comments", async () => {
    const buf = await makeDocx([{ text: "Fractions", style: "Heading1" }, { text: "A fraction has two parts." }, { text: "Equivalent", style: "Heading2" }, { text: "Same amount." }], "A reviewer's remark");
    const blocks = await docxBlocks(buf);
    const md = blocks.map((b) => b.md).join("\n");
    expect(blocks.slice(0, 4).map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "A fraction has two parts."],
      ["heading", "## Equivalent"],
      ["para", "Same amount."],
    ]);
    expect(blocks[3].loc).toBe("§ Fractions › Equivalent ¶1");
    expect(md).not.toContain("reviewer's remark");
  });

  it("a broken file is refused as unreadable", async () => {
    await expect(docxBlocks(Buffer.from("PK\u0003\u0004 broken"))).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("odt", () => {
  it("outline levels are headings; lists, tables and images", async () => {
    const buf = await makeOdt(
      `<text:h text:outline-level="1">Fractions</text:h><text:p>Two parts.</text:p>` +
        `<text:list><text:list-item><text:p>numerator</text:p></text:list-item><text:list-item><text:p>denominator</text:p></text:list-item></text:list>` +
        `<table:table><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>` +
        `<text:p><draw:frame><draw:image/></draw:frame></text:p><office:annotation><text:p>hidden comment</text:p></office:annotation>`,
    );
    const blocks = await odtBlocks(buf);
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "Two parts."],
      ["list", "- numerator\n- denominator"],
      ["table", "| a | b |\n|---|---|"],
      ["image", "[image, § Fractions ¶4]"],
    ]);
  });

  it("a broken file or broken XML is refused as unreadable", async () => {
    await expect(odtBlocks(Buffer.from("PK\u0003\u0004 broken"))).rejects.toMatchObject({ reason: "unreadable" });
    const z = new JSZip();
    // fast-xml-parser reads mismatched tags leniently; an unclosed comment is one thing it throws on.
    z.file("content.xml", "<office:document-content><office:body><office:text><!-- never closed");
    await expect(odtBlocks(await z.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ reason: "unreadable" });
  });
});

describe("rtf", () => {
  it("text, paragraphs, escapes and Unicode; control words and hidden groups dropped", () => {
    const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\colortbl;\red0\green0\blue0;}{\*\generator Word;}{\info{\title Secret}}\pard Una fracci\'f3n tiene dos partes.\par Caf\u233?. \tab Fin.\par}`;
    expect(rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => b.md)).toEqual(["Una fracción tiene dos partes.\nCafé. \tFin."]);
  });

  it("text that looks like Markdown stays text; control symbols and character words", () => {
    const rtf = String.raw`{\rtf1\ansi # Not a heading\par | not a table\par a\~b\_c \emdash  d\lquote e\rquote\par}`;
    expect(rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => [b.kind, b.md])).toEqual([["para", "\\# Not a heading\n\\| not a table\na b-c — d‘e’"]]);
  });
});
