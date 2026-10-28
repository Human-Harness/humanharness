import { describe, expect, it } from "vitest";
import { diffFile, diffMarkdown, markdownBlocks } from "../src/file-diff";

const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });

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
    diffMarkdown(`${" ".repeat(50_000)}a\n`, `${" ".repeat(50_000)}b\n`);
    diffMarkdown(`> [!${"[".repeat(50_000)}\n`, `| a |\n|---|\n|${" |".repeat(20_000)}\n`);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});
