import { type ReactNode, createElement } from "react";
import type { ElementContent, RootContent } from "hast";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** A fixed set of common languages (document-reader spec §3.2). Anything else is plain text. */
const low = createLowlight({ bash, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml });
low.registerAlias({
  bash: ["sh", "shell", "zsh"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  typescript: ["ts", "tsx"],
  xml: ["html"],
  yaml: ["yml"],
  markdown: ["md"],
  python: ["py"],
  rust: ["rs"],
});

function draw(node: RootContent | ElementContent, key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  // lowlight only makes <span class="hljs-…">: anything else is drawn as a span with its text.
  const cls = node.properties?.className;
  const className = Array.isArray(cls) ? cls.filter((c): c is string => typeof c === "string" && c.startsWith("hljs")).join(" ") : "";
  return createElement("span", { key, className: className || undefined }, node.children.map((c, i) => draw(c, i)));
}

/** Above these, a block is shown as plain text: highlighting runs on the main thread and grows with the size. */
export const HIGHLIGHT_MAX_CHARS = 100_000;
export const HIGHLIGHT_MAX_LINES = 3000;

function tooLarge(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_CHARS) return true;
  let lines = 1;
  for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) if (++lines > HIGHLIGHT_MAX_LINES) return true;
  return false;
}

/** `code` as highlighted spans, or null when the language is not in the set or the code is too large. Never an HTML string. */
export function highlightCode(lang: string | null | undefined, code: string): ReactNode[] | null {
  const name = lang?.toLowerCase();
  if (!name || !low.registered(name) || tooLarge(code)) return null;
  return low.highlight(name, code).children.map((c, i) => draw(c, i));
}
