import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import { MaterialRefused, markdownBlocks, plainLine, withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";
import { decodeText } from "./text";
import { htmlBlocks } from "./html";
import { checkZip, openZip, zipText } from "./zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * docx: mammoth maps Word's heading styles to h1–h6 and drops comments and tracked-change marks (it reads the
 * accepted text). Images become empty `<img>` (no data URIs: nothing is described, D4). Footnotes come last, as
 * mammoth puts them.
 */
export async function docxBlocks(buf: Buffer): Promise<MdBlock[]> {
  // mammoth inflates the zip itself: the guard reads it first, so a zip bomb never reaches it.
  await checkZip(buf);
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
  // A zip given as a Buffer is opened with the zip-bomb guard; a JSZip given must come from `openZip`.
  const zip = buf instanceof JSZip ? buf : await openZip(buf);
  const xml = await zipText(zip, name);
  if (xml === null) return null;
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, processEntities: true, htmlEntities: false });
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

/** Never text: comments, tracked deletions, notes (they come last: `odfNotes`), and a picture's alt text. */
const ODF_HIDDEN = new Set(["office:annotation", "office:annotation-end", "text:tracked-changes", "text:deletion", "text:note", "svg:title", "svg:desc"]);
/** Children that are paragraphs of their own: their texts are joined with a space ("one two", never "onetwo"). */
const ODF_BLOCKS = new Set(["text:p", "text:h", "text:list", "text:list-item"]);
/** The most spaces one `text:s` gives: its count is the file's word, so it is bounded. */
const ODF_MAX_SPACES = 1000;

/**
 * The text of a node: text runs, `text:s` (spaces, at most ODF_MAX_SPACES), `text:tab`, `text:line-break`;
 * annotations, deletions, notes and alt text left out. Paragraphs inside a node (a cell, a list item) are joined with
 * a space.
 */
export function odfText(n: XNode): string {
  const tag = tagOf(n);
  if (tag === "#text") return String(n["#text"] ?? "");
  if (tag === "text:s") return " ".repeat(Math.min(ODF_MAX_SPACES, Math.max(0, Math.floor(Number(attr(n, "text:c") ?? 1) || 1))));
  if (tag === "text:tab") return "\t";
  if (tag === "text:line-break") return "\n";
  if (ODF_HIDDEN.has(tag)) return "";
  let out = "";
  for (const k of kids(n)) {
    const t = odfText(k);
    if (ODF_BLOCKS.has(tagOf(k)) && t.trim() && out.trim() && !/\s$/.test(out)) out += " ";
    out += t;
  }
  return out;
}

/** Every note's body under `nodes`, in document order (a note inside a note's body is not looked for). */
export function odfNotes(nodes: XNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (tagOf(n) === "text:note") {
      const body = kids(n).find((k) => tagOf(k) === "text:note-body");
      const t = body ? odfText(body).trim() : "";
      if (t) out.push(t);
    } else out.push(...odfNotes(kids(n)));
  }
  return out;
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
          .map((li) => {
            const text = kids(li).filter((c) => tagOf(c) !== "text:list").map((c) => odfText(c).trim()).filter(Boolean).join(" ");
            const nested = kids(li).filter((c) => tagOf(c) === "text:list");
            return `<li>${esc(text)}${odfHtml(nested)}</li>`;
          });
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
  // §3: footnotes and endnotes come last, as a numbered list after the content (as mammoth does for docx).
  const notes = odfNotes(kids(text));
  return htmlBlocks(odfHtml(kids(text)) + (notes.length > 0 ? `<ol>${notes.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""));
}

/** Groups whose text is never content: fonts, colours, styles, document info, pictures, shapes, and every `{\*…}` group. */
const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|datastore|latentstyles|shp|shpgrp|nonshppict)$/;

/** Control words that stand for one character. */
const CHARS: Record<string, string> = { emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", emspace: " ", enspace: " " };
const cp1252 = new TextDecoder("windows-1252");

/** A group's state, restored at its `}`. */
interface RtfState {
  /** Not content: a hidden destination or a SKIP group. */
  skip: boolean;
  /** `\ucN`: how many fallback characters follow a `\uN`. */
  uc: number;
  /** `\deleted`: a tracked deletion, never the text. */
  deleted: boolean;
  /** Inside a `\footnote` group: the text goes to the notes, which come last. */
  note: boolean;
}

/**
 * RTF into plain text: `\par` ends a line, `\'hh` is Windows-1252, `\uN` is Unicode (its `\ucN` fallback characters
 * skipped). Footnotes come last, one per line; tracked deletions, shapes and `\bin` data are dropped.
 */
export function rtfText(src: string): string {
  // Sticky, so a control word is matched in place (slicing the rest of the file each time would be quadratic).
  const control = /([a-z]+)(-?\d+)? ?/y;
  let main = "";
  let notes = "";
  const stack: RtfState[] = [];
  let st: RtfState = { skip: false, uc: 1, deleted: false, note: false };
  let skipNext = 0;
  const emit = (s: string) => {
    if (st.skip || st.deleted) return;
    if (st.note) notes += s;
    else main += s;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(st);
      st = { ...st, skip: st.skip || src.startsWith("{\\*", i) };
      continue;
    }
    if (ch === "}") {
      const closed = st;
      st = stack.pop() ?? { skip: false, uc: 1, deleted: false, note: false };
      if (closed.note && !st.note) notes += "\n";
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (skipNext > 0) skipNext--;
        else emit(next);
        i++;
        continue;
      }
      if (next === "'") {
        const byte = Number.parseInt(src.slice(i + 2, i + 4), 16);
        if (skipNext > 0) skipNext--;
        else if (!Number.isNaN(byte)) emit(cp1252.decode(Uint8Array.of(byte)));
        i += 3;
        continue;
      }
      control.lastIndex = i + 1;
      const m = control.exec(src);
      if (!m) {
        // A control symbol: `\~` is a non-breaking space, `\_` a non-breaking hyphen; the rest (`\-`, `\|`…) are not text.
        if (next === "~") emit(" ");
        else if (next === "_") emit("-");
        i++;
        continue;
      }
      const [all, word, num] = m;
      const groupStart = src[i - 1] === "{";
      i += all.length;
      // `\binN`: N bytes of binary data follow; never text, and never parsed as RTF.
      if (word === "bin") {
        i += Math.max(0, Number(num ?? 0));
        continue;
      }
      if (SKIP.test(word) && groupStart) st.skip = true;
      if (word === "footnote") st.note = true;
      if (word === "uc") st.uc = Math.min(10, Math.max(0, Number(num ?? 1) || 0));
      if (word === "deleted") st.deleted = num !== "0";
      if (word === "plain") st.deleted = false;
      if (st.skip) continue;
      if (word === "par" || word === "line") emit("\n");
      else if (word === "tab") emit("\t");
      else if (Object.hasOwn(CHARS, word)) emit(CHARS[word]);
      else if (word === "u" && num !== undefined) {
        const code = Number(num) < 0 ? Number(num) + 65536 : Number(num);
        emit(String.fromCharCode(code));
        skipNext = st.uc;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (skipNext > 0) {
      skipNext--;
      continue;
    }
    emit(ch);
  }
  const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").trim();
  const noteLines = notes.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return [tidy(main), noteLines].filter(Boolean).join("\n");
}

/** RTF's lines are text, never Markdown: a line that would read as structure gets its marker escaped. */
export function rtfBlocks(buf: Buffer): MdBlock[] {
  return withEstimatedPages(markdownBlocks(rtfText(decodeText(buf)).split("\n").map(plainLine).join("\n")));
}
