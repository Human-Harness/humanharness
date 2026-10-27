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

  it("footnotes come after the content", async () => {
    const z = await JSZip.loadAsync(await makeDocx([{ text: "PLACEHOLDER" }, { text: "Second." }]));
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = (await z.file("word/document.xml")!.async("string")).replace(
      '<w:r><w:t xml:space="preserve">PLACEHOLDER</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">Main</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"> text.</w:t></w:r>',
    );
    z.file("word/document.xml", doc);
    z.file("word/footnotes.xml", `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>The note.</w:t></w:r></w:p></w:footnote></w:footnotes>`);
    z.file(
      "word/_rels/document.xml.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
    );
    const md = (await docxBlocks(await z.generateAsync({ type: "nodebuffer" }))).map((b) => b.md);
    expect(md[0]).toMatch(/^Main.* text\.$/);
    expect(md[0]).not.toContain("The note.");
    expect(md.findIndex((m) => m.includes("The note."))).toBeGreaterThan(md.indexOf("Second."));
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

  it("a text:s count is clamped: a huge one is bounded, a negative or bad one is not an error", async () => {
    for (const c of ["300000000", "-1", "abc"]) {
      const blocks = await odtBlocks(await makeOdt(`<text:p>a<text:s text:c="${c}"/>b</text:p>`));
      expect(blocks).toHaveLength(1);
      expect(blocks[0].md.length).toBeLessThan(1100);
      expect(blocks[0].md).toMatch(/^a\s*b$/);
    }
  });

  it("notes come after the content, not inside the sentence", async () => {
    const blocks = await odtBlocks(
      await makeOdt(
        `<text:p>Main<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>The note.</text:p></text:note-body></text:note> text.</text:p><text:p>Second.</text:p>`,
      ),
    );
    const md = blocks.map((b) => b.md);
    expect(md[0]).toBe("Main text.");
    expect(md[1]).toBe("Second.");
    expect(md.slice(2).join("\n")).toContain("The note.");
  });

  it("an image's alt text is left out; a cell's or item's paragraphs are joined with a space", async () => {
    const blocks = await odtBlocks(
      await makeOdt(
        `<text:p>Before <draw:frame><svg:title>Alt title</svg:title><svg:desc>Alt desc</svg:desc><draw:image/></draw:frame></text:p>` +
          `<text:list><text:list-item><text:p>one</text:p><text:p>two</text:p></text:list-item></text:list>` +
          `<table:table><table:table-row><table:table-cell><text:p>three</text:p><text:p>four</text:p></table:table-cell></table:table-row></table:table>`,
      ),
    );
    const md = blocks.map((b) => b.md).join("\n");
    expect(md).not.toContain("Alt");
    expect(md).toContain("- one two");
    expect(md).toContain("| three four |");
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

  it("\\ucN sets how many fallback characters follow \\u, per group", () => {
    const rtf = String.raw`{\rtf1\ansi\uc2 Caf\u233 XYs {\uc0 na\u239 ve}\par}`;
    expect(rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => b.md)).toEqual(["Cafés naïve"]);
  });

  it("footnotes come last; shapes, deleted text and binary data are dropped", () => {
    const rtf = String.raw`{\rtf1\ansi Main{\super\chftn}{\footnote\pard {\super\chftn} The note.} text.{\shp{\*\shpinst{\sp{\sn x}{\sv y}}}{\shprslt shape text}}\par Kept {\deleted gone }and a\deleted  b\deleted0  c.\par x\bin4 {}\zy\par Second.\par}`;
    const md = rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => b.md).join("\n");
    expect(md).toBe("Main text.\nKept and a c.\nxy\nSecond.\nThe note.");
  });

  it("text that looks like Markdown stays text; control symbols and character words", () => {
    const rtf = String.raw`{\rtf1\ansi # Not a heading\par | not a table\par a\~b\_c \emdash  d\lquote e\rquote\par}`;
    expect(rtfBlocks(Buffer.from(rtf, "latin1")).map((b) => [b.kind, b.md])).toEqual([["para", "\\# Not a heading\n\\| not a table\na b-c — d‘e’"]]);
  });
});
