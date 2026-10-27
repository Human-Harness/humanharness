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

/** `code` as highlighted spans, or null when the language is not in the set. Never an HTML string. */
export function highlightCode(lang: string | null | undefined, code: string): ReactNode[] | null {
  const name = lang?.toLowerCase();
  if (!name || !low.registered(name)) return null;
  return low.highlight(name, code).children.map((c, i) => draw(c, i));
}
