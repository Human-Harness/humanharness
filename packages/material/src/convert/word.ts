import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import { MaterialRefused, markdownBlocks, plainLine, withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";
import { decodeText } from "./text";
import { htmlBlocks } from "./html";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * docx: mammoth maps Word's heading styles to h1–h6 and drops comments and tracked-change marks (it reads the
 * accepted text). Images become empty `<img>` (no data URIs: nothing is described, D4). Footnotes come last, as
 * mammoth puts them.
 */
export async function docxBlocks(buf: Buffer): Promise<MdBlock[]> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })), ignoreEmptyParagraphs: true });
    html = result.value;
  } catch {
    throw new MaterialRefused("unreadable");
  }
  return htmlBlocks(html);
}

/** An XML part of a zip, parsed keeping order (`preserveOrder`): each node is `{ tag: children, ":@": attrs }`. */
export type XNode = Record<string, unknown> & { ":@"?: Record<string, string> };
export async function zipXml(buf: Buffer | JSZip, name: string): Promise<XNode[] | null> {
  let zip: JSZip;
  try {
    zip = buf instanceof JSZip ? buf : await JSZip.loadAsync(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const file = zip.file(name);
  if (!file) return null;
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, processEntities: true, htmlEntities: false });
  const xml = await file.async("string");
  try {
    return parser.parse(xml) as XNode[];
  } catch {
    throw new MaterialRefused("unreadable");
  }
}

/** A node's tag name (the one key that isn't `:@`). */
export const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ":@") ?? "";
export const kids = (n: XNode): XNode[] => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as XNode[]) : []);
export const attr = (n: XNode, name: string): string | undefined => n[":@"]?.[name];

/** The text of a node: text runs, `text:s` (spaces), `text:tab`, `text:line-break`; annotations and notes' citations left out. */
export function odfText(n: XNode): string {
  const tag = tagOf(n);
  if (tag === "#text") return String(n["#text"] ?? "");
  if (tag === "text:s") return " ".repeat(Number(attr(n, "text:c") ?? 1));
  if (tag === "text:tab") return "\t";
  if (tag === "text:line-break") return "\n";
  if (tag === "office:annotation" || tag === "office:annotation-end" || tag === "text:tracked-changes" || tag === "text:deletion") return "";
  return kids(n).map(odfText).join("");
}

/** ODF text content as HTML (headings, paragraphs, lists, tables, images), for the walker. */
export function odfHtml(nodes: XNode[]): string {
  return nodes
    .map((n) => {
      const tag = tagOf(n);
      if (tag === "text:h") {
        const level = Math.min(6, Math.max(1, Number(attr(n, "text:outline-level") ?? 1)));
        return `<h${level}>${esc(odfText(n))}</h${level}>`;
      }
      if (tag === "text:p") {
        const image = kids(n).some((k) => tagOf(k) === "draw:frame") ? "<img>" : "";
        const text = odfText(n).trim();
        return `${text ? `<p>${esc(text)}</p>` : ""}${image}`;
      }
      if (tag === "text:list") {
        const items = kids(n)
          .filter((k) => tagOf(k) === "text:list-item")
          .map((li) => `<li>${kids(li).map((c) => (tagOf(c) === "text:list" ? odfHtml([c]) : esc(odfText(c)))).join("")}</li>`);
        return `<ul>${items.join("")}</ul>`;
      }
      if (tag === "table:table") {
        const rows = kids(n)
          .flatMap((k) => (tagOf(k) === "table:table-header-rows" || tagOf(k) === "table:table-rows" ? kids(k) : [k]))
          .filter((k) => tagOf(k) === "table:table-row")
          .map((r) => `<tr>${kids(r).filter((c) => tagOf(c) === "table:table-cell").map((c) => `<td>${esc(odfText(c).trim())}</td>`).join("")}</tr>`);
        return `<table>${rows.join("")}</table>`;
      }
      if (tag === "text:section" || tag === "office:text" || tag === "office:body" || tag === "office:document-content") return odfHtml(kids(n));
      return "";
    })
    .join("");
}

/** The first node with `tag`, depth first. */
export function findNode(nodes: XNode[], tag: string): XNode | null {
  for (const n of nodes) {
    if (tagOf(n) === tag) return n;
    const inner = findNode(kids(n), tag);
    if (inner) return inner;
  }
  return null;
}

export async function odtBlocks(buf: Buffer): Promise<MdBlock[]> {
  const content = await zipXml(buf, "content.xml");
  const text = content && findNode(content, "office:text");
  if (!text) throw new MaterialRefused("unreadable");
  return htmlBlocks(odfHtml(kids(text)));
}

/** Groups whose text is never content: fonts, colours, styles, document info, pictures, and every `{\*…}` group. */
const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|datastore|latentstyles)$/;

/** Control words that stand for one character. */
const CHARS: Record<string, string> = { emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", emspace: " ", enspace: " " };
const cp1252 = new TextDecoder("windows-1252");

/** RTF into plain text: `\par` ends a line, `\'hh` is Windows-1252, `\uN?` is Unicode (its fallback skipped). */
export function rtfText(src: string): string {
  // Sticky, so a control word is matched in place (slicing the rest of the file each time would be quadratic).
  const control = /([a-z]+)(-?\d+)? ?/y;
  let out = "";
  const stack: boolean[] = [];
  let skip = false;
  let skipNext = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(skip);
      if (src.startsWith("{\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      skip = stack.pop() ?? false;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (!skip) out += next;
        i++;
        continue;
      }
      if (next === "'") {
        const byte = Number.parseInt(src.slice(i + 2, i + 4), 16);
        if (!skip && skipNext === 0 && !Number.isNaN(byte)) out += cp1252.decode(Uint8Array.of(byte));
        else if (skipNext > 0) skipNext--;
        i += 3;
        continue;
      }
      control.lastIndex = i + 1;
      const m = control.exec(src);
      if (!m) {
        // A control symbol: `\~` is a non-breaking space, `\_` a non-breaking hyphen; the rest (`\-`, `\|`…) are not text.
        if (!skip && next === "~") out += " ";
        else if (!skip && next === "_") out += "-";
        i++;
        continue;
      }
      const [all, word, num] = m;
      i += all.length;
      if (SKIP.test(word) && src[i - all.length - 1] === "{") skip = true;
      if (skip) continue;
      if (word === "par" || word === "line") out += "\n";
      else if (word === "tab") out += "\t";
      else if (Object.hasOwn(CHARS, word)) out += CHARS[word];
      else if (word === "u" && num !== undefined) {
        const code = Number(num) < 0 ? Number(num) + 65536 : Number(num);
        out += String.fromCharCode(code);
        skipNext = 1;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (skip) continue;
    if (skipNext > 0) {
      skipNext--;
      continue;
    }
    out += ch;
  }
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

/** RTF's lines are text, never Markdown: a line that would read as structure gets its marker escaped. */
export function rtfBlocks(buf: Buffer): MdBlock[] {
  return withEstimatedPages(markdownBlocks(rtfText(decodeText(buf)).split("\n").map(plainLine).join("\n")));
}
