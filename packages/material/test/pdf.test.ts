import { describe, expect, it } from "vitest";
import { MaterialRefused, measurePdf, pdfBlocks } from "../src";
import { body, makePdf } from "./make-pdf";

const footer = (n: number) => [
  { x: 72, y: 760, size: 9, text: "Mathematics 6 - Chapter 2" },
  { x: 300, y: 40, size: 9, text: String(n) },
];

describe("pdfBlocks (material spec §3 PDF)", () => {
  it("headings from relative font size, paragraphs from line gaps, page marks", async () => {
    const pdf = makePdf([
      [{ x: 72, y: 720, size: 20, text: "Fractions" }, ...body(["A fraction has two parts: the numerator", "and the denominator."], 72, 690), { x: 72, y: 620, size: 15, text: "Equivalent fractions" }, ...body(["Two fractions are equivalent when they name the same amount."], 72, 595)],
      body(["The second page goes on with more text."]),
    ]);
    const r = await pdfBlocks(pdf);
    expect(r.pages).toBe(2);
    expect(r.blocks.map((b) => [b.kind, b.level ?? null, b.md, b.loc])).toEqual([
      ["heading", 1, "# Fractions", "p.1"],
      ["para", null, "A fraction has two parts: the numerator and the denominator.", "p.1"],
      ["heading", 2, "## Equivalent fractions", "p.1"],
      ["para", null, "Two fractions are equivalent when they name the same amount.", "p.1"],
      ["para", null, "The second page goes on with more text.", "p.2"],
    ]);
  });

  it("removes running headers, footers and page numbers, and joins hyphenated words", async () => {
    const pages = [1, 2, 3].map((n) => [...footer(n), ...body([`Page ${n} talks about frac-`, "tions and nothing else."])]);
    const r = await pdfBlocks(makePdf(pages));
    const text = r.blocks.map((b) => b.md).join("\n");
    expect(text).not.toContain("Mathematics 6");
    expect(text).not.toMatch(/^\d+$/m);
    expect(text).toContain("Page 2 talks about fractions and nothing else.");
  });

  it("reads two columns left, then right", async () => {
    const left = body(["Left column first line", "left column second line."], 72, 700);
    const right = body(["Right column first line", "right column second line."], 330, 700);
    const r = await pdfBlocks(makePdf([[...left, ...right]]));
    const text = r.blocks.map((b) => b.md).join("\n");
    expect(text.indexOf("Left column first")).toBeLessThan(text.indexOf("Right column first"));
    expect(text.indexOf("left column second")).toBeLessThan(text.indexOf("Right column first"));
  });

  it("a single column whose lines are split into two items near the middle keeps its line order", async () => {
    const split = ["First", "Second", "Third"].flatMap((w, i) => [
      { x: 72, y: 700 - i * 14, size: 11, text: `${w} line starts here and` },
      { x: 300, y: 700 - i * 14, size: 11, text: "ends over here." },
    ]);
    const text = (await pdfBlocks(makePdf([split]))).blocks.map((b) => b.md).join("\n");
    expect(text).toContain("First line starts here and ends over here.");
    expect(text.indexOf("First line")).toBeLessThan(text.indexOf("Second line"));
    expect(text.indexOf("Second line")).toBeLessThan(text.indexOf("Third line"));
  });

  it("an empty gutter narrower than 1.5x the font size is not a column break", async () => {
    // Helvetica x is 0.5 em: 22 of them at 20 pt end at 72 + 220 = 292; the right item starts at 314 (gap 22 < 30).
    const near = ["a", "b", "c"].flatMap((w, i) => [
      { x: 72, y: 700 - i * 24, size: 20, text: `${w}${"x".repeat(21)}` },
      { x: 314, y: 700 - i * 24, size: 20, text: `${w}end` },
    ]);
    const text = (await pdfBlocks(makePdf([near]))).blocks.map((b) => b.md).join("\n");
    expect(text).toContain(`a${"x".repeat(21)} aend`);
    expect(text).toContain(`b${"x".repeat(21)} bend`);
  });

  it("a heading's trailing # run and leading markup stay text", async () => {
    const pdf = makePdf([[{ x: 72, y: 720, size: 20, text: "Learning C#" }, { x: 72, y: 680, size: 20, text: "> Quoted ##" }, ...body(["Body text long enough to set the body size of the page."], 72, 640)]]);
    const md = (await pdfBlocks(pdf)).blocks.filter((b) => b.kind === "heading").map((b) => b.md);
    expect(md).toEqual(["# Learning C\\#", "# \\> Quoted \\##"]);
  });

  it("measure counts text pages only up to a cap", async () => {
    const pdf = makePdf([body(["One."]), body(["Two."]), body(["Three."])]);
    expect(await measurePdf(pdf, 2)).toEqual({ pages: 3, textPages: 2, checked: 2 });
  });

  it("records pages with no text layer; a page range keeps only those pages", async () => {
    const pdf = makePdf([body(["One."]), [], body(["Three."])]);
    const all = await pdfBlocks(pdf);
    expect(all.skippedPages).toEqual([2]);
    const ranged = await pdfBlocks(pdf, { pageRange: [3, 3] });
    expect(ranged.blocks.map((b) => b.md)).toEqual(["Three."]);
  });

  it("measure: pages and pages with text, without reading the text", async () => {
    expect(await measurePdf(makePdf([body(["One."]), []]))).toEqual({ pages: 2, textPages: 1, checked: 2 });
    await expect(measurePdf(Buffer.from("%PDF-1.4 broken"))).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("headings by weight on a reconversion", async () => {
    const pdf = makePdf([[{ x: 72, y: 720, size: 11, text: "Bold heading", bold: true }, ...body(["Plain text follows it here."], 72, 700)]]);
    expect((await pdfBlocks(pdf)).blocks[0].kind).toBe("para");
    expect((await pdfBlocks(pdf, { settings: { headingsByWeight: true } })).blocks[0]).toMatchObject({ kind: "heading", md: "## Bold heading" });
  });

  it("text that reads as Markdown structure stays text", async () => {
    const r = await pdfBlocks(makePdf([body(["# not a heading", "- not a list either."])]));
    expect(r.blocks.map((b) => b.md)).toEqual(["\\# not a heading - not a list either."]);
  });

  it("hostile input is refused with a reason, never a crash", async () => {
    for (const bad of [Buffer.alloc(0), Buffer.from("not a pdf at all")]) {
      const err = await pdfBlocks(bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MaterialRefused);
      expect((err as MaterialRefused).reason).toBe("unreadable");
    }
    // Broken structure (a page tree that points at itself, a truncated file): read what can be read, or refuse.
    const good = makePdf([body(["Some text."])]);
    for (const bad of [Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 1 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF"), good.subarray(0, good.length >> 1)]) {
      const out = await pdfBlocks(bad).catch((e: unknown) => e);
      if (out instanceof Error) expect(out).toBeInstanceOf(MaterialRefused);
      else expect(out).toMatchObject({ blocks: expect.any(Array) });
    }
  });

  it("a repeated body line is kept; only the page's edge bands lose running lines", async () => {
    const pages = [1, 2, 3].map(() => body(["The same sentence on every page."]));
    expect((await pdfBlocks(makePdf(pages))).blocks).toHaveLength(3);
  });

  it("a bold line a little above body size is a level-3 heading", async () => {
    const pdf = makePdf([[{ x: 72, y: 720, size: 13, text: "Small bold heading", bold: true }, ...body(["Body text of the section, long enough to set the body size."], 72, 700)]]);
    expect((await pdfBlocks(pdf)).blocks[0]).toMatchObject({ kind: "heading", level: 3, md: "### Small bold heading" });
  });
});
