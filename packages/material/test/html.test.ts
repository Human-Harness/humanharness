import { describe, expect, it } from "vitest";
import { htmlBlocks, markdownBlocks, readablePage } from "../src";

describe("htmlBlocks", () => {
  it("headings, paragraphs, lists, tables, code and images, with heading-path locations", () => {
    const html = `<h1>Fractions</h1><p>A <strong>fraction</strong> has two parts.</p>
      <ul><li>numerator</li><li>denominator<ul><li>below</li></ul></li></ul>
      <h2>Table</h2><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>
      <pre>x = 1</pre><p><img src="d.png"></p><script>alert(1)</script><style>p{}</style>`;
    const blocks = htmlBlocks(html);
    expect(blocks.map((b) => [b.kind, b.md])).toEqual([
      ["heading", "# Fractions"],
      ["para", "A **fraction** has two parts."],
      ["list", "- numerator\n- denominator\n  - below"],
      ["heading", "## Table"],
      ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
      ["code", "```\nx = 1\n```"],
      ["image", "[image, § Fractions › Table ¶3]"],
    ]);
    expect(blocks.map((b) => b.loc)).toEqual(["§ Fractions", "§ Fractions ¶1", "§ Fractions ¶2", "§ Fractions › Table", "§ Fractions › Table ¶1", "§ Fractions › Table ¶2", "§ Fractions › Table ¶3"]);
  });

  it("a skipped heading level keeps the path right when a shallower heading follows", () => {
    const blocks = htmlBlocks("<h1>A</h1><h3>C</h3><p>x</p><h3>D</h3><p>y</p><h2>B</h2><p>z</p>");
    expect(blocks.filter((b) => b.kind === "para").map((b) => b.loc)).toEqual(["§ A › C ¶1", "§ A › D ¶1", "§ A › B ¶1"]);
  });

  it("an image inside text comes after its paragraph, numbered after it", () => {
    const blocks = htmlBlocks("<h1>A</h1><p>See <img src='x.png'> here.</p>");
    expect(blocks.slice(1).map((b) => [b.kind, b.loc])).toEqual([["para", "§ A ¶1"], ["image", "§ A ¶2"]]);
  });

  it("code holding backticks gets a longer fence", () => {
    expect(htmlBlocks("<pre>a ``` b</pre>")[0].md).toBe("````\na ``` b\n````");
  });

  it("a <body> inside a comment or a script string never loses the content", () => {
    expect(htmlBlocks("<!-- <body> --><p>Kept.</p>").map((b) => b.md)).toEqual(["Kept."]);
    expect(htmlBlocks("<script>var s = '<body>';</script><p>Kept.</p>").map((b) => b.md)).toEqual(["Kept."]);
  });

  it("a nested table's rows are read once, inside their own table", () => {
    const blocks = htmlBlocks("<table><tr><td>outer</td><td><table><tr><td>inner</td></tr></table></td></tr><tr><td>2</td><td>3</td></tr></table>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].md).toBe("| outer | inner |\n|---|---|\n| 2 | 3 |");
  });

  it("the newline right after <pre> is not part of the code", () => {
    expect(htmlBlocks("<pre>\nx = 1\n</pre>")[0].md).toBe("```\nx = 1\n```");
  });

  it("paragraph text that looks like Markdown structure is escaped", () => {
    const md = htmlBlocks("<p># not a heading</p><p>> no quote</p><p>- no</p><p>* no</p><p>+ no</p><p>1. no</p><p>2) no</p>").map((b) => b.md);
    expect(md).toEqual(["\\# not a heading", "\\> no quote", "\\- no", "\\* no", "\\+ no", "1\\. no", "2\\) no"]);
    expect(md.flatMap((m) => markdownBlocks(m)).map((b) => b.kind)).toEqual(Array(7).fill("para"));
  });

  it("a prefix for every location (an ebook's chapter)", () => {
    expect(htmlBlocks("<p>Hi.</p>", { prefix: "ch. 2" })[0].loc).toBe("ch. 2 ¶1");
  });

  it("drops forms, frames and objects, and never keeps raw HTML", () => {
    const blocks = htmlBlocks(`<form><input value="x"></form><iframe src="x"></iframe><p>Kept &lt;b&gt; as text.</p>`);
    expect(blocks.map((b) => b.md)).toEqual(["Kept <b> as text."]);
  });
});

describe("readablePage (a fetched link: §3 Web)", () => {
  it("keeps the main content and its title", () => {
    const long = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} explains equivalent fractions with care and with several clear words in it.</p>`).join("");
    const html = `<html><head><title>Equivalent fractions</title></head><body><nav><a href="/">Home</a><a href="/x">Menu item</a></nav><article><h1>Equivalent fractions</h1>${long}</article><footer>Copyright</footer></body></html>`;
    const { title, blocks } = readablePage(html);
    expect(title).toBe("Equivalent fractions");
    expect(blocks.some((b) => b.md.includes("Paragraph 3 explains"))).toBe(true);
    expect(blocks.some((b) => b.md.includes("Menu item"))).toBe(false);
  });
});
