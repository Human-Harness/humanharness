import { createLowlight } from "lowlight";
import typescript from "highlight.js/lib/languages/typescript";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

describe("renderer dependencies", () => {
  it("remark-gfm's tables, task lists, strikethrough and footnotes reach the tree with parse() alone", () => {
    const tree = unified().use(remarkParse).use(remarkGfm).parse("| a |\n|--:|\n| 1 |\n\n- [x] done\n\n~~gone~~[^1]\n\n[^1]: note");
    const types = tree.children.map((n) => n.type);
    expect(types).toEqual(["table", "list", "paragraph", "footnoteDefinition"]);
    expect((tree.children[0] as { align: unknown[] }).align).toEqual(["right"]);
  });

  it("lowlight answers a tree, never an HTML string", () => {
    const low = createLowlight({ typescript });
    const root = low.highlight("typescript", "const a = 1;");
    expect(root.type).toBe("root");
    expect(JSON.stringify(root)).toContain("hljs-keyword");
  });
});
