import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DIFF_BLOCKS, MAX_DIFF_OUTPUT, diffFile, diffMarkdown as diffMarkdownOrNull, markdownBlocks, parseableMarkdown } from "../src/file-diff";

const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });
const diffMarkdown = (a: string, b: string) => {
  const blocks = diffMarkdownOrNull(a, b);
  if (!blocks) throw new Error("shown as text");
  return blocks;
};

describe("Markdown blocks", () => {
  it("front-matter, headings, paragraphs, list items, table rows, code, Mermaid, callouts", () => {
    const text = [
      "---", "title: Filter", "---", "## Scope", "", "Filter by size.", "", "- one", "- two", "", "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "```ts", "let a = 1;", "```", "", "```mermaid", "graph TD; A-->B", "```", "", "> [!note]", "> Mind the order.", "", "> Plain quote.", "",
    ].join("\n");
    expect(markdownBlocks(text).map((b) => b.type)).toEqual([
      "frontMatter", "heading", "paragraph", "listItem", "listItem", "tableRow", "tableRow", "code", "mermaid", "callout", "quote",
    ]);
    const blocks = markdownBlocks(text);
    expect(blocks[1]).toMatchObject({ source: "## Scope", text: "Scope", depth: 2 });
    expect(blocks[3].source).toBe("- one");
    expect(blocks[6].cells).toEqual(["1", "2"]);
    expect(blocks[7].text).toBe("let a = 1;");
  });
});

describe("diffMarkdown (file-timeline spec §4.2)", () => {
  it("aligns blocks and diffs a changed paragraph word by word", () => {
    const blocks = diffMarkdown("## Scope\n\nFilter by size.\n\nThe list loads.\n", "## Scope\n\nFilter by size and colour.\n\nThe list loads.\n");
    expect(blocks.map((b) => [b.type, b.status])).toEqual([
      ["heading", "same"],
      ["paragraph", "changed"],
      ["paragraph", "same"],
    ]);
    const parts = blocks[1].parts ?? [];
    const read = (kind: string) => parts.filter((p) => p.kind === "same" || p.kind === kind).map((p) => p.text).join("");
    expect(read("del")).toBe("Filter by size.");
    expect(read("ins")).toBe("Filter by size and colour.");
    expect(parts.some((p) => p.kind === "ins" && p.text.includes("colour"))).toBe(true);
    expect(blocks[1].before).toBe("Filter by size.");
    expect(blocks[1].after).toBe("Filter by size and colour.");
  });

  it("a moved paragraph is removed in one place and added in another", () => {
    const blocks = diffMarkdown("A.\n\nB.\n\nC.\n", "B.\n\nC.\n\nA.\n");
    expect(blocks.map((b) => [b.status, b.before ?? b.after])).toEqual([
      ["removed", "A."],
      ["same", "B."],
      ["same", "C."],
      ["added", "A."],
    ]);
  });

  it("a changed table row diffs cell by cell; added and removed rows keep their cells", () => {
    const blocks = diffMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n", "| a | b |\n|---|---|\n| 1 | 3 |\n| 4 | 5 |\n");
    expect(blocks.map((b) => [b.type, b.status])).toEqual([
      ["tableRow", "same"],
      ["tableRow", "changed"],
      ["tableRow", "added"],
    ]);
    expect(blocks[1].cells).toEqual({
      before: ["1", "2"],
      after: ["1", "3"],
      parts: [[{ kind: "same", text: "1" }], [{ kind: "del", text: "2" }, { kind: "ins", text: "3" }]],
    });
    expect(blocks[2].cells).toEqual({ after: ["4", "5"] });
  });

  it("a changed Mermaid fence keeps both sources and their line diff", () => {
    const [b] = diffMarkdown("```mermaid\ngraph TD; A-->B\n```\n", "```mermaid\ngraph TD; A-->C\n```\n");
    expect(b).toMatchObject({ type: "mermaid", status: "changed" });
    expect(b.before).toContain("A-->B");
    expect(b.after).toContain("A-->C");
    expect(b.lines?.map((l) => l.kind)).toEqual(["del", "ins"]);
  });

  it("different block types never pair: a paragraph turned into a heading is removed + added", () => {
    expect(diffMarkdown("Scope\n", "## Scope\n").map((b) => [b.type, b.status])).toEqual([
      ["paragraph", "removed"],
      ["heading", "added"],
    ]);
  });

  it("diffFile on .md: blocks plus the raw line diff for the Source toggle", () => {
    const d = diffFile("specs/a.md", side("A.\n"), side("B.\n"));
    expect(d).toMatchObject({ ok: true, kind: "markdown", same: false, truncated: false });
    if (d.kind !== "markdown") throw new Error("not markdown");
    expect(d.source.map((l) => l.kind)).toEqual(["del", "ins"]);
    expect(d.blocks).toHaveLength(1);
    expect(diffFile("a.markdown", { kind: "absent" }, side("x\n")).kind).toBe("markdown");
  });

  it("a spent budget gives block-level output: each old block removed, each new one added", () => {
    const d = diffFile("a.md", side("## Scope\n\nFilter by size.\n"), side("## Scope\n\nFilter by colour.\n"), 0);
    if (d.kind !== "markdown") throw new Error("not markdown");
    expect(d.blocks.map((b) => [b.type, b.status])).toEqual([
      ["heading", "removed"],
      ["heading", "added"],
      ["paragraph", "removed"],
      ["paragraph", "added"],
    ]);
    expect(d.blocks.some((b) => b.parts || b.lines)).toBe(false);
    expect(d.source.map((l) => l.kind)).toEqual(["del", "del", "del", "ins", "ins", "ins"]);
    const t = diffFile("a.txt", side("a\nb\n"), side("a\nc\n"), 0);
    if (t.kind !== "text") throw new Error("not text");
    expect(t.lines.map((l) => l.kind)).toEqual(["del", "del", "ins", "ins"]);
  });

  it("many changed blocks share one budget: the whole diff ends close to it", () => {
    const words = (seed: string) => Array.from({ length: 1500 }, (_, i) => `${seed}${(i * 7919) % 1500}`).join(" ");
    const before = Array.from({ length: 30 }, (_, i) => `${words(`a${i}x`)}.`).join("\n\n");
    const after = Array.from({ length: 30 }, (_, i) => `${words(`a${i}y`)}.`).join("\n\n");
    const start = performance.now();
    const d = diffFile("a.md", side(before), side(after), 100);
    expect(performance.now() - start).toBeLessThan(1000);
    if (d.kind !== "markdown") throw new Error("not markdown");
    expect(d.blocks.filter((b) => b.status === "removed")).not.toHaveLength(0);
  });

  it("long runs of spaces and markers stay fast", () => {
    const start = performance.now();
    diffMarkdownOrNull(`${" ".repeat(50_000)}a\n`, `${" ".repeat(50_000)}b\n`);
    diffMarkdownOrNull(`> [!${"[".repeat(50_000)}\n`, `| a |\n|---|\n|${" |".repeat(20_000)}\n`);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});

describe("what the parser may take (bounded Markdown diff)", () => {
  const K = 200 * 1024;
  const fit = (s: string) => s.slice(0, K);
  const textView = (t: string) => {
    const start = performance.now();
    const d = diffFile("a.md", side(t), side(`Z${t.slice(1)}`));
    return { d, ms: performance.now() - start };
  };

  it("real documents still parse: the repo's plans, cut to 200 KB, give blocks", () => {
    const dir = resolve(__dirname, "../../../docs/superpowers/plans");
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n\n");
    for (const at of [0, all.length / 3, (2 * all.length) / 3]) {
      const t = all.slice(at, at + K);
      expect(parseableMarkdown(t)).toBe(true);
    }
    const t = all.slice(0, K);
    const mid = t.indexOf("\n\n", t.length / 2);
    expect(diffFile("a.md", side(t), side(`${t.slice(0, mid)}\n\nA new paragraph.${t.slice(mid)}`)).kind).toBe("markdown");
  });

  it("dense emphasis, strikethrough and nested brackets skip the parser and show as text, fast", () => {
    for (const t of [fit("*_".repeat(K)), fit("~a".repeat(K)), fit("_a".repeat(K)), fit("[".repeat(K / 2) + "]".repeat(K / 2)), fit("* a ".repeat(K))]) {
      expect(parseableMarkdown(t)).toBe(false);
      const { d, ms } = textView(t);
      expect(d).toMatchObject({ kind: "text", lang: "md" });
      expect(ms).toBeLessThan(2500);
    }
  });

  it("deep nesting at a line's start skips the parser (200 KB of `>` overflows its stack)", () => {
    expect(parseableMarkdown(">".repeat(K))).toBe(false);
    expect(parseableMarkdown("> ".repeat(K / 2))).toBe(false);
    expect(parseableMarkdown(`${"- ".repeat(K / 2)}x`)).toBe(false);
    expect(parseableMarkdown("> > - 1. quote in a list\n")).toBe(true);
    expect(textView(">".repeat(K)).d.kind).toBe("text");
  });

  it("more blocks than MAX_DIFF_BLOCKS show as text, before and after the parse", () => {
    const paras = fit("a\n\n".repeat(K));
    expect(parseableMarkdown(paras)).toBe(false);
    const { d, ms } = textView(paras);
    expect(d.kind).toBe("text");
    expect(ms).toBeLessThan(2500);
    expect(parseableMarkdown(`a | b\n---|---\n${"x | y\n".repeat(MAX_DIFF_BLOCKS + 10)}`)).toBe(false);
    // Blocks the pre-scan can't see (one HTML comment per line: no blank line, no marker) are caught after the parse.
    const comments = "<!-- a -->\n".repeat(MAX_DIFF_BLOCKS + 10);
    expect(parseableMarkdown(comments)).toBe(true);
    expect(markdownBlocks(comments)).toHaveLength(MAX_DIFF_BLOCKS + 10);
    expect(diffMarkdownOrNull(comments, `Z${comments.slice(1)}`)).toBeNull();
    expect(diffFile("a.md", side(comments), side(`Z${comments.slice(1)}`)).kind).toBe("text");
  });

  it("many setext headings (quadratic in the parser) skip it", () => {
    expect(parseableMarkdown("a\n=\n".repeat(1001))).toBe(false);
    expect(parseableMarkdown("a\n---\n".repeat(1001))).toBe(false);
    expect(parseableMarkdown("Title\n=====\n\nText.\n\nPart\n----\n")).toBe(true);
  });

  it("equal sides answer no blocks, without parsing", () => {
    const t = fit("a\n\n".repeat(MAX_DIFF_BLOCKS - 10));
    expect(diffFile("a.md", side(t), side(t))).toMatchObject({ kind: "markdown", same: true, blocks: [], source: [] });
  });

  it("unchanged blocks carry their source once; output past MAX_DIFF_OUTPUT shows as text", () => {
    const [same] = diffMarkdown("A.\n\nB.\n", "A.\n\nC.\n");
    expect(same).toEqual({ type: "paragraph", status: "same", after: "A." });
    // Every other one-letter word changed: each block carries both sides plus a word part per word.
    const para = (c: string) => Array.from({ length: 400 }, (_, i) => (i % 2 ? c : "a")).join(" ");
    const doc = (c: string) => Array.from({ length: 10 }, () => para(c)).join("\n\n");
    const blocks = diffMarkdown(doc("b"), doc("c"));
    const size = JSON.stringify(blocks).length;
    expect(diffMarkdownOrNull(doc("b"), doc("c"), 2000, size * 2)).not.toBeNull();
    expect(diffMarkdownOrNull(doc("b"), doc("c"), 2000, size / 2)).toBeNull();
    expect(MAX_DIFF_OUTPUT).toBe(2_000_000);
  });

  it("the worst word-by-word case stays within the output cap and about the budget", () => {
    const para = (c: string) => Array.from({ length: 4000 }, (_, i) => (i % 2 ? c : "a")).join(" ");
    const doc = (c: string) => Array.from({ length: 25 }, () => para(c)).join("\n\n");
    const start = performance.now();
    const d = diffFile("a.md", side(doc("b")), side(doc("c")), 500);
    expect(performance.now() - start).toBeLessThan(2500);
    if (d.kind === "markdown") expect(JSON.stringify(d.blocks).length).toBeLessThan(MAX_DIFF_OUTPUT * 1.5);
  });

  it("deeply indented lists skip the parser", () => {
    const nested = Array.from({ length: 300 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n");
    expect(parseableMarkdown(nested)).toBe(false);
    expect(parseableMarkdown(Array.from({ length: 20 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n"))).toBe(true);
  });
});
