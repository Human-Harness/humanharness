import { estimateTokens } from "@humanharness/workspace";
import { PAGE_TOKENS } from "./constants";
import type { MdBlock, Refusal } from "./types";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^ {0,3}([-*+]|\d{1,9}[.)])\s+/;
const TABLE = /^ {0,3}\|/;
const IMAGE = /^ {0,3}!\[[^\]]*\]\([^)]*\)\s*$/;

/** A refusal a converter throws, with its reason; the pipeline turns it into the source's `refused` status. */
export class MaterialRefused extends Error {
  constructor(readonly reason: Extract<Refusal, "unreadable" | "protected" | "scanned" | "too-big">) {
    super(reason);
    this.name = "MaterialRefused";
  }
}

/** A code block: a fence one backtick longer than the longest backtick run inside, so no body line can close it. */
export function fenced(body: string, lang = ""): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body.replace(/\n+$/, "")}\n${fence}`;
}

/** A line of text that would read as Markdown structure (a heading, a quote, a list, a fence, a table) gets its marker escaped. */
export const plainLine = (l: string) =>
  l.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2").replace(/^(#{1,6}(?=\s|$)|>|[-*+](?=\s|$)|`{3,}|~{3,}|\|)/, "\\$1");

/** `lines 3–4`, or `lines 3` for one line. */
const lines = (from: number, to: number) => (from === to ? `lines ${from}` : `lines ${from}–${to}`);

/**
 * Markdown into blocks (one pass, no nesting): ATX headings, fenced code, lists (a run of list lines and their
 * indented continuations), tables (a run of `|` lines), a lone image (a placeholder, never described: §3), and
 * paragraphs. `loc` defaults to the line range; a converter that knows better passes `locOf`.
 */
export function markdownBlocks(md: string, locOf: (from: number, to: number) => string = lines, page = 1): MdBlock[] {
  const all = md.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  const push = (kind: MdBlock["kind"], from: number, to: number, text: string, level?: number) =>
    out.push({ kind, ...(level !== undefined ? { level } : {}), md: text, loc: locOf(from + 1, to + 1), page });
  while (i < all.length) {
    const line = all[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const start = i;
      const close = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      for (i++; i < all.length && !close.test(all[i]); i++);
      push("code", start, Math.min(i, all.length - 1), all.slice(start, i + 1).join("\n"));
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      push("heading", i, i, `${heading[1]} ${heading[2]}`, heading[1].length);
      i++;
      continue;
    }
    if (IMAGE.test(line)) {
      out.push({ kind: "image", md: `[image, ${locOf(i + 1, i + 1)}]`, loc: locOf(i + 1, i + 1), page });
      i++;
      continue;
    }
    const start = i;
    const kind: MdBlock["kind"] = LIST.test(line) ? "list" : TABLE.test(line) ? "table" : "para";
    for (i++; i < all.length && all[i].trim(); i++) {
      const next = all[i];
      if (FENCE.test(next) || HEADING.test(next)) break;
      if (kind === "table" && !TABLE.test(next)) break;
      if (kind === "para" && (LIST.test(next) || TABLE.test(next))) break;
    }
    push(kind, start, i - 1, all.slice(start, i).join("\n"));
  }
  return out;
}

/** Blocks with an estimated page each (§7: a page is about PAGE_TOKENS tokens), for files without pages. */
export function withEstimatedPages(blocks: MdBlock[]): MdBlock[] {
  let tokens = 0;
  return blocks.map((b) => {
    const page = Math.floor(tokens / PAGE_TOKENS) + 1;
    tokens += estimateTokens(b.md);
    return { ...b, page };
  });
}

/** The pages a converted list spans. */
export const pagesOf = (blocks: MdBlock[]): number => blocks.reduce((n, b) => Math.max(n, b.page), 0);

/**
 * One location for a run of blocks: `p.4–5` when both marks end in a number after the same prefix (a range's own
 * end counts: `lines 3–4` to `lines 9–11` is `lines 3–11`); else the first mark.
 */
export function locRange(first: string, last: string): string {
  const a = /^(.*?)(\d+)(?:–\d+)?$/.exec(first);
  const b = /^(.*?)(?:\d+–)?(\d+)$/.exec(last);
  if (!a || !b || a[1] !== b[1]) return first;
  return a[2] === b[2] ? `${a[1]}${a[2]}` : `${a[1]}${a[2]}–${b[2]}`;
}
