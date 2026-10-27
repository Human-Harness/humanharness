import { markdownBlocks, withEstimatedPages } from "../blocks";
import type { MaterialType, MdBlock } from "../types";

/** UTF-8 (strict), else Windows-1252 (§3); a BOM goes. */
export function decodeText(b: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    text = new TextDecoder("windows-1252").decode(b);
  }
  return text.replace(/^\uFEFF/, "");
}

const lines = (from: number, to: number) => (from === to ? `lines ${from}` : `lines ${from}–${to}`);
const fenced = (lang: string, body: string) => `\`\`\`${lang}\n${body.replace(/\n+$/, "")}\n\`\`\``;
const DEFINITION = /^(export\s+)?(default\s+)?(async\s+)?(function|class|def|interface|type|enum|struct|impl|fn|func|pub\s+fn|const|let|var)\b/;
const YAML_KEY = /^[A-Za-z0-9_"'][^:#]*:(\s|$)/;

/** Splits `text` at the lines `isStart` marks; each part becomes a heading (the start line) and a fenced block. */
function cutAt(text: string, lang: string, isStart: (line: string) => boolean, title: (line: string) => string): MdBlock[] {
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let start = 0;
  const flush = (end: number, headed: boolean) => {
    const body = all.slice(start, end).join("\n");
    if (!body.trim()) return;
    if (headed) out.push({ kind: "heading", level: 2, md: `## ${title(all[start]).slice(0, 80)}`, loc: lines(start + 1, start + 1), page: 1 });
    out.push({ kind: "code", md: fenced(lang, body.trim()), loc: lines(start + 1, end), page: 1 });
  };
  let headed = false;
  for (let i = 0; i < all.length; i++) {
    if (i > start && isStart(all[i])) {
      flush(i, headed);
      start = i;
      headed = true;
    } else if (i === 0 && isStart(all[i])) headed = true;
  }
  flush(all.length, headed);
  return out;
}

/** Plain text, Markdown, structured data and code into blocks (§3 "Plain text"). */
export function textBlocks(type: Extract<MaterialType, "md" | "txt" | "json" | "xml" | "yaml" | "code">, buf: Buffer): MdBlock[] {
  const text = decodeText(buf);
  if (!text.trim()) return [];
  switch (type) {
    case "md":
      return withEstimatedPages(markdownBlocks(text));
    case "txt": {
      // Plain text has no Markdown: every run of lines is a paragraph, kept as written.
      const out: MdBlock[] = [];
      const all = text.replace(/\r\n?/g, "\n").split("\n");
      for (let i = 0; i < all.length; ) {
        if (!all[i].trim()) {
          i++;
          continue;
        }
        const start = i;
        while (i < all.length && all[i].trim()) i++;
        out.push({ kind: "para", md: all.slice(start, i).join("\n"), loc: lines(start + 1, i), page: 1 });
      }
      return withEstimatedPages(out);
    }
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return withEstimatedPages([{ kind: "code", md: fenced("json", text.trim()), loc: "lines 1", page: 1 }]);
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return withEstimatedPages([{ kind: "code", md: fenced("json", JSON.stringify(value, null, 2)), loc: "lines 1", page: 1 }]);
      }
      return withEstimatedPages(
        Object.entries(value).flatMap(([k, v]): MdBlock[] => [
          { kind: "heading", level: 2, md: `## ${k.slice(0, 80)}`, loc: `key ${k.slice(0, 40)}`, page: 1 },
          { kind: "code", md: fenced("json", JSON.stringify(v, null, 2)), loc: `key ${k.slice(0, 40)}`, page: 1 },
        ]),
      );
    }
    case "yaml":
      return withEstimatedPages(cutAt(text, "yaml", (l) => YAML_KEY.test(l), (l) => l.split(":")[0].replace(/["']/g, "")));
    case "xml":
      return withEstimatedPages(cutAt(text, "xml", () => false, (l) => l));
    case "code":
      return withEstimatedPages(cutAt(text, "", (l) => DEFINITION.test(l), (l) => l.trim()));
  }
}
