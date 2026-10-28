import { diffArrays, diffLines, diffWordsWithSpace } from "diff";
import type { Blockquote, Nodes, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { CALLOUTS, splitFrontMatter } from "@humanharness/harness-sdk/documents";

/** Each side of a diff is cut to this many bytes (file-timeline spec §4.2 "Large files"). */
export const MAX_DIFF_BYTES = 200 * 1024;
/** jsdiff gives up after this long; the piece then shows as all removed, then all added. */
export const DIFF_TIMEOUT_MS = 2000;
/** The most blocks a side of a Markdown diff may have; past it (or a pre-scan's estimate past it) the file diffs as text. */
export const MAX_DIFF_BLOCKS = 5000;
/** About the most characters a Markdown diff's blocks may carry (text plus a little per piece); past it, text. */
export const MAX_DIFF_OUTPUT = 2_000_000;
/** Unchanged lines a line diff keeps on each side of a change (the window's own context is the same). */
export const DIFF_CONTEXT_LINES = 3;
/** The most lines a line diff answers, gaps not counted; past it the rest is cut (and the view says `truncated`). */
export const MAX_DIFF_LINES = 10_000;
/**
 * The pre-scan's limits on what the parser may see (it is superlinear on some inputs): container markers opening one
 * line (`> > - …`), a line's indent in columns (nested lists), `[` nesting inside one paragraph, and the sum over
 * paragraphs of (`*` `_` `~` `[` `]` count)². Measured on this repo's 120 Markdown files: at most 6 columns of indent
 * and a cost of 16,283; one paragraph at the cost limit (2,000 delimiters) parses in well under 100 ms.
 */
const MAX_LINE_NESTING = 16;
const MAX_INDENT = 128;
const MAX_BRACKET_DEPTH = 32;
const MAX_DELIMITER_COST = 4_000_000;
/** Setext underlines (`===`/`---` under a text line): the parser is quadratic in them (5,000 take 1.6 s, 50,000 over 3 min). */
const MAX_SETEXT = 1000;
/** How deep `plain` follows a node's children. */
const MAX_PLAIN_DEPTH = 64;
/** Bytes looked at for a NUL. */
const SNIFF_BYTES = 8 * 1024;
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "heic", "ico", "bmp", "tif", "tiff", "psd",
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "m4v", "avi", "mkv", "webm",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "dmg", "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages", "odt", "ods", "odp",
  "woff", "woff2", "ttf", "otf", "eot", "sqlite", "db", "bin", "exe", "dll", "so", "dylib", "class", "jar", "wasm",
]);

export type DiffPart = { kind: "same" | "ins" | "del"; text: string };
/**
 * One line of a line diff; `old`/`new` are 1-based line numbers on each side. A `gap` stands for `count` unchanged lines
 * left out (its `text` is empty): a whole file's line diff keeps only the lines around its changes.
 */
export interface LineChange {
  kind: "same" | "ins" | "del" | "gap";
  text: string;
  old?: number;
  new?: number;
  count?: number;
}
/** One side of a diff: the file's bytes (with its full size), or no file. */
export type DiffSide = { kind: "absent" } | { kind: "bytes"; bytes: Uint8Array; size: number };

export type MdBlockType = "frontMatter" | "heading" | "paragraph" | "listItem" | "tableRow" | "code" | "mermaid" | "callout" | "quote" | "other";

/** A top-level block of a Markdown text: its exact source, its plain text, and for rows their cells' text. */
export interface MdBlock {
  type: MdBlockType;
  source: string;
  text: string;
  depth?: number;
  cells?: string[];
}

/** A block of a Markdown diff. `before`/`after`: the block's source on each side; an unchanged block has `after` only. */
export interface MdDiffBlock {
  type: MdBlockType;
  status: "same" | "added" | "removed" | "changed";
  before?: string;
  after?: string;
  /** A changed heading, paragraph, list item, callout, quote or other block: its plain text, word by word. */
  parts?: DiffPart[];
  /** A changed code, Mermaid or front-matter block: its lines. */
  lines?: LineChange[];
  /** A table row: its cells on each side, and word parts per cell when it changed. */
  cells?: { before?: string[]; after?: string[]; parts?: DiffPart[][] };
  depth?: number;
}

export type FileDiffView =
  | { ok: true; kind: "markdown"; same: boolean; truncated: boolean; blocks: MdDiffBlock[]; source: LineChange[] }
  | { ok: true; kind: "text"; same: boolean; truncated: boolean; lines: LineChange[]; lang: string | null }
  | { ok: true; kind: "binary"; same: boolean; sizes: { before: number | null; after: number | null } };

/** The lower-case extension of `file` (no dot), or "". */
export function extensionOf(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isBinary(file: string, bytes: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(extensionOf(file))) return true;
  return bytes.subarray(0, SNIFF_BYTES).includes(0);
}

/** The first `max` bytes of `bytes`, backed up to the start of a UTF-8 character. */
export function cutBytes(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

/** Splits jsdiff's value into lines (its last line ending dropped, a CRLF's `\r` too), without a regex. */
function splitLines(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  const line = (end: number) => value.slice(start, end > start && value[end - 1] === "\r" ? end - 1 : end);
  for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", start)) {
    out.push(line(i));
    start = i + 1;
  }
  if (start < value.length) out.push(value.slice(start));
  return out;
}

/**
 * A whole file's line diff as it travels to the window: the changed lines, up to `context` unchanged ones around each,
 * and a `gap` (with its count) for every run left out; at most `max` lines, gaps not counted. `cut`: lines were dropped
 * past `max`. Linear, so 200 KB of short lines (over 100,000 of them) answers a few lines, not megabytes.
 */
export function compactLines(lines: LineChange[], context = DIFF_CONTEXT_LINES, max = MAX_DIFF_LINES): { lines: LineChange[]; cut: boolean } {
  // Each line's distance to the nearest change, before and after it.
  const near = new Uint8Array(lines.length);
  let since = Infinity;
  for (let i = 0; i < lines.length; i++) {
    since = lines[i].kind === "same" ? since + 1 : 0;
    if (since <= context) near[i] = 1;
  }
  since = Infinity;
  for (let i = lines.length - 1; i >= 0; i--) {
    since = lines[i].kind === "same" ? since + 1 : 0;
    if (since <= context) near[i] = 1;
  }
  const out: LineChange[] = [];
  let i = 0;
  for (; i < lines.length && out.length < max; i++) {
    if (near[i]) {
      out.push(lines[i]);
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === "gap") last.count = (last.count ?? 0) + 1;
    else out.push({ kind: "gap", text: "", count: 1 });
  }
  return { lines: out, cut: i < lines.length };
}

/** The time a diff may still take: its deadline (a `Date.now()` value) minus now, never below 0. */
const timeLeft = (deadline: number): number => Math.max(0, deadline - Date.now());
const deadlineIn = (ms: number): number => Date.now() + ms;

/**
 * A line diff with line numbers; a timed-out diff is every old line removed, then every new line added.
 * `deadline` (a `Date.now()` value) bounds the call; a whole file diff shares one deadline across its calls.
 */
export function lineChanges(before: string, after: string, deadline = deadlineIn(DIFF_TIMEOUT_MS)): LineChange[] {
  const ms = timeLeft(deadline);
  // jsdiff reads a timeout of 0 as "none", so a spent deadline never reaches it.
  const changes = (ms > 0 ? diffLines(before, after, { timeout: ms }) : undefined) ?? [
    { value: before, removed: true, added: false, count: 0 },
    { value: after, added: true, removed: false, count: 0 },
  ];
  const out: LineChange[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const c of changes) {
    for (const text of splitLines(c.value)) {
      if (c.added) out.push({ kind: "ins", text, new: ++newNo });
      else if (c.removed) out.push({ kind: "del", text, old: ++oldNo });
      else out.push({ kind: "same", text, old: ++oldNo, new: ++newNo });
    }
  }
  return out;
}

/** A word diff that keeps the spaces; a timed-out diff is the old text removed, then the new one added. */
export function wordParts(before: string, after: string, deadline = deadlineIn(DIFF_TIMEOUT_MS)): DiffPart[] {
  const ms = timeLeft(deadline);
  const changes = ms > 0 ? diffWordsWithSpace(before, after, { timeout: ms }) : undefined;
  if (!changes) {
    const out: DiffPart[] = [];
    if (before) out.push({ kind: "del", text: before });
    if (after) out.push({ kind: "ins", text: after });
    return out;
  }
  return changes.filter((c) => c.value !== "").map((c) => ({ kind: c.added ? "ins" : c.removed ? "del" : "same", text: c.value }));
}

/** A Buffer over the same memory (Buffer.from(Uint8Array) would copy it). */
const view = (u: Uint8Array): Buffer => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
const textOf = (s: DiffSide): string => (s.kind === "absent" ? "" : view(cutBytes(s.bytes, MAX_DIFF_BYTES)).toString("utf8"));
const sizeOf = (s: DiffSide): number | null => (s.kind === "absent" ? null : s.size);
const sameSides = (a: DiffSide, b: DiffSide): boolean =>
  a.kind === "absent" ? b.kind === "absent" : b.kind !== "absent" && a.size === b.size && view(a.bytes).equals(view(b.bytes));
const cut = (a: DiffSide, b: DiffSide): boolean => (sizeOf(a) ?? 0) > MAX_DIFF_BYTES || (sizeOf(b) ?? 0) > MAX_DIFF_BYTES;

/** The reader's parser (document-reader spec §3): remark-parse + remark-gfm, no raw HTML path. */
const processor = unified().use(remarkParse).use(remarkGfm);

function plain(node: Nodes, depth = 0): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node && depth < MAX_PLAIN_DEPTH) {
    const sep = node.type === "listItem" || node.type === "blockquote" ? "\n" : "";
    return (node.children as Nodes[]).map((c) => plain(c, depth + 1)).join(sep);
  }
  return "";
}

const isSpace = (c: string) => c === " " || c === "\t";
const isDigit = (c: string) => c >= "0" && c <= "9";

/** How many container markers (`>`, `-`/`*`/`+` then a space, `1.`/`1)` then a space) open the line at `i`. */
function lineNesting(text: string, i: number, end: number): number {
  let n = 0;
  while (i < end) {
    while (i < end && isSpace(text[i])) i++;
    const c = text[i];
    if (c === ">") i++;
    else if ((c === "-" || c === "*" || c === "+") && isSpace(text[i + 1] ?? "")) i += 2;
    else {
      let j = i;
      while (j < end && j - i < 9 && isDigit(text[j])) j++;
      if (j === i || (text[j] !== "." && text[j] !== ")") || !isSpace(text[j + 1] ?? "")) return n;
      i = j + 2;
    }
    n++;
  }
  return n;
}

/** The line from `i` is only `mark` characters, then spaces (a setext underline when a text line is above it). */
function underline(text: string, i: number, end: number, mark: string): boolean {
  while (i < end && text[i] === mark) i++;
  while (i < end && (isSpace(text[i]) || text[i] === "\r")) i++;
  return i === end;
}

/** A line that may start a block of its own: after a blank line, holding a `|` (a table row), or opening with a marker. */
const BLOCK_MARKERS = new Set(["#", ">", "-", "*", "+", "=", "|", "[", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/**
 * One linear pass that tells whether the parser can take `text` in reasonable time (remark is superlinear on dense
 * emphasis, strikethrough and bracket runs, and deep nesting overflows its stack). Fenced code is skipped. False also
 * when it would clearly make more than `MAX_DIFF_BLOCKS` blocks.
 */
export function parseableMarkdown(text: string): boolean {
  let fence = "";
  let blank = true;
  let starts = 0;
  let delimiters = 0;
  let depth = 0;
  let cost = 0;
  let setext = 0;
  for (let start = 0; start < text.length; ) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let p = start;
    let indent = 0;
    for (; p < end && isSpace(text[p]); p++) indent += text[p] === "\t" ? 4 : 1;
    if (p === end || (p === end - 1 && text[p] === "\r")) {
      if (!fence) {
        cost += delimiters * delimiters;
        if (cost > MAX_DELIMITER_COST) return false;
        delimiters = 0;
        depth = 0;
      }
      blank = true;
      start = end + 1;
      continue;
    }
    const mark = text[p];
    if ((mark === "`" || mark === "~") && p - start <= 3 && text[p + 1] === mark && text[p + 2] === mark) {
      let q = p;
      while (q < end && text[q] === mark) q++;
      const run = text.slice(p, q);
      if (!fence) fence = run;
      else if (run[0] === fence[0] && run.length >= fence.length) fence = "";
    } else if (!fence) {
      if (indent > MAX_INDENT || lineNesting(text, p, end) > MAX_LINE_NESTING) return false;
      if (!blank && (mark === "=" || mark === "-") && underline(text, p, end, mark) && ++setext > MAX_SETEXT) return false;
      let pipe = false;
      for (let i = p; i < end; i++) {
        const c = text[i];
        if (c === "|") pipe = true;
        else if (c === "*" || c === "_" || c === "~") delimiters++;
        else if (c === "[") {
          delimiters++;
          if (++depth > MAX_BRACKET_DEPTH) return false;
        } else if (c === "]") {
          delimiters++;
          if (depth > 0) depth--;
        }
      }
      if ((blank || pipe || BLOCK_MARKERS.has(mark)) && ++starts > MAX_DIFF_BLOCKS) return false;
    }
    blank = false;
    start = end + 1;
  }
  return cost + delimiters * delimiters <= MAX_DELIMITER_COST;
}

const slice = (text: string, n: { position?: { start: { offset?: number }; end: { offset?: number } } }): string =>
  text.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0);

/** A blockquote whose first text starts with `[!note]` (or another callout marker), checked without a regex. */
function isCallout(q: Blockquote): boolean {
  const lead = plain(q).trimStart().toLowerCase();
  return lead.startsWith("[!") && CALLOUTS.some((c) => lead.startsWith(`[!${c}]`));
}

function blockOf(body: string, n: RootContent): MdBlock[] {
  switch (n.type) {
    case "heading":
      return [{ type: "heading", source: slice(body, n), text: plain(n), depth: n.depth }];
    case "paragraph":
      return [{ type: "paragraph", source: slice(body, n), text: plain(n) }];
    case "list":
      return n.children.map((item) => ({ type: "listItem" as const, source: slice(body, item), text: plain(item) }));
    case "table":
      return (n as Table).children.map((row) => {
        const cells = row.children.map((cell) => plain(cell));
        return { type: "tableRow" as const, source: slice(body, row), text: cells.join(" | "), cells };
      });
    case "code":
      return [{ type: n.lang?.toLowerCase() === "mermaid" ? "mermaid" : "code", source: slice(body, n), text: n.value }];
    case "blockquote":
      return [{ type: isCallout(n) ? "callout" : "quote", source: slice(body, n), text: plain(n) }];
    default:
      return [{ type: "other", source: slice(body, n), text: slice(body, n) }];
  }
}

/** The text's top-level blocks (§4.2 step 2): front-matter first when there is one. */
export function markdownBlocks(text: string): MdBlock[] {
  const fm = splitFrontMatter(text);
  const head = text.slice(0, text.length - fm.body.length);
  const out: MdBlock[] = head ? [{ type: "frontMatter", source: head.trimEnd(), text: head.trimEnd() }] : [];
  const root = processor.parse(fm.body);
  for (const n of root.children) out.push(...blockOf(fm.body, n));
  return out;
}

const byLines = (t: MdBlockType) => t === "code" || t === "mermaid" || t === "frontMatter";
const depthOf = (b: MdBlock) => (b.depth ? { depth: b.depth } : {});

/** A pair of same-type blocks; once the deadline has passed, the old block removed and the new one added. */
function changed(a: MdBlock, b: MdBlock, deadline: number): MdDiffBlock[] {
  if (timeLeft(deadline) === 0) return [removed(a), added(b)];
  const base = { type: a.type, status: "changed" as const, before: a.source, after: b.source, ...depthOf(b) };
  if (byLines(a.type)) return [{ ...base, lines: lineChanges(a.text, b.text, deadline) }];
  if (a.type === "tableRow") {
    const before = a.cells ?? [];
    const after = b.cells ?? [];
    const parts = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => wordParts(before[i] ?? "", after[i] ?? "", deadline));
    return [{ ...base, cells: { before, after, parts } }];
  }
  return [{ ...base, parts: wordParts(a.text, b.text, deadline) }];
}

const removed = (a: MdBlock): MdDiffBlock => ({ type: a.type, status: "removed", before: a.source, ...depthOf(a), ...(a.cells ? { cells: { before: a.cells } } : {}) });
const added = (b: MdBlock): MdDiffBlock => ({ type: b.type, status: "added", after: b.source, ...depthOf(b), ...(b.cells ? { cells: { after: b.cells } } : {}) });
const kept = (b: MdBlock): MdDiffBlock => ({
  type: b.type,
  status: "same",
  after: b.source,
  ...depthOf(b),
  ...(b.cells ? { cells: { after: b.cells } } : {}),
});

/** Both sides' blocks, or null when the pre-scan refuses a side, the parser throws, or a side has too many blocks. */
function parseBoth(before: string, after: string): [MdBlock[], MdBlock[]] | null {
  if (!parseableMarkdown(before) || !parseableMarkdown(after)) return null;
  try {
    const a = markdownBlocks(before);
    if (a.length > MAX_DIFF_BLOCKS) return null;
    const b = markdownBlocks(after);
    return b.length > MAX_DIFF_BLOCKS ? null : [a, b];
  } catch {
    // A stack overflow on deep nesting the pre-scan let through, or any parser failure: the caller shows text.
    return null;
  }
}

/** About how many characters `blocks` carry once serialized: their texts plus a little per piece. */
function weightOf(blocks: MdDiffBlock[]): number {
  const PIECE = 32;
  const strings = (xs: readonly string[] | undefined) => (xs ?? []).reduce((n, s) => n + s.length + PIECE, 0);
  const parts = (xs: readonly DiffPart[] | undefined) => (xs ?? []).reduce((n, p) => n + p.text.length + PIECE, 0);
  let n = 0;
  for (const b of blocks) {
    n += PIECE + (b.before?.length ?? 0) + (b.after?.length ?? 0) + parts(b.parts);
    for (const l of b.lines ?? []) n += l.text.length + PIECE;
    if (b.cells) n += strings(b.cells.before) + strings(b.cells.after) + (b.cells.parts ?? []).reduce((m, p) => m + parts(p), 0);
  }
  return n;
}

/**
 * Blocks aligned on their source (§4.2): in a run of removed-then-added blocks, the i-th of each pair up when they are
 * the same type ("changed"); the rest stay removed or added. The time budget starts after both sides are parsed, and
 * every jsdiff call shares it. Null when the text should show as plain text: the pre-scan or the parser refuses a
 * side, a side has more than `MAX_DIFF_BLOCKS` blocks, or the result carries more than `MAX_DIFF_OUTPUT`.
 */
export function diffMarkdown(before: string, after: string, budgetMs = DIFF_TIMEOUT_MS, maxOutput = MAX_DIFF_OUTPUT): MdDiffBlock[] | null {
  return alignMarkdown(before, after, budgetMs, maxOutput)?.blocks ?? null;
}

/** `diffMarkdown`, plus the deadline it used (the rest of the budget is the caller's). */
function alignMarkdown(before: string, after: string, budgetMs: number, maxOutput = MAX_DIFF_OUTPUT): { blocks: MdDiffBlock[]; deadline: number } | null {
  const parsed = parseBoth(before, after);
  if (!parsed) return null;
  const [a, b] = parsed;
  const deadline = deadlineIn(budgetMs);
  const ms = timeLeft(deadline);
  const aligned = ms > 0 ? diffArrays(a, b, { comparator: (x, y) => x.type === y.type && x.source === y.source, timeout: ms }) : undefined;
  const changes = aligned ?? [
    { value: a, removed: true, added: false, count: a.length },
    { value: b, added: true, removed: false, count: b.length },
  ];
  const out: MdDiffBlock[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      out.push(...c.value.map(kept));
      continue;
    }
    const gone = c.removed ? c.value : [];
    const next = c.removed && changes[i + 1]?.added ? changes[++i].value : c.added ? c.value : [];
    const pairs = Math.min(gone.length, next.length);
    for (let k = 0; k < pairs; k++) {
      if (gone[k].type === next[k].type) out.push(...changed(gone[k], next[k], deadline));
      else out.push(removed(gone[k]), added(next[k]));
    }
    out.push(...gone.slice(pairs).map(removed), ...next.slice(pairs).map(added));
  }
  return weightOf(out) > maxOutput ? null : { blocks: out, deadline };
}

/** The plain line diff of `file` (what a Markdown file falls back to), with its own `budgetMs`. */
export function textDiff(file: string, before: DiffSide, after: DiffSide, budgetMs = DIFF_TIMEOUT_MS): FileDiffView {
  const ext = extensionOf(file);
  const lines = compactLines(lineChanges(textOf(before), textOf(after), deadlineIn(budgetMs)));
  return { ok: true, kind: "text", same: sameSides(before, after), truncated: cut(before, after) || lines.cut, lines: lines.lines, lang: ext || null };
}

export const isMarkdownFile = (file: string): boolean => {
  const ext = extensionOf(file);
  return ext === "md" || ext === "markdown";
};

/**
 * What changed in `file` from `before` to `after` (§4.2): blocks for Markdown, lines for text, sizes for binary.
 * Each diff shares one time budget (`budgetMs`, for Markdown counted from after the parse); what is left when it runs
 * out shows as removed, then added. Two equal Markdown sides answer no blocks at all. A Markdown file the parser should
 * not take (see `diffMarkdown`) answers its plain text diff (`kind: "text"`).
 */
export function diffFile(file: string, before: DiffSide, after: DiffSide, budgetMs = DIFF_TIMEOUT_MS): FileDiffView {
  const same = sameSides(before, after);
  const binary = (before.kind === "bytes" && isBinary(file, before.bytes)) || (after.kind === "bytes" && isBinary(file, after.bytes));
  if (binary) return { ok: true, kind: "binary", same, sizes: { before: sizeOf(before), after: sizeOf(after) } };
  if (!isMarkdownFile(file)) return textDiff(file, before, after, budgetMs);
  const truncated = cut(before, after);
  if (same) return { ok: true, kind: "markdown", same, truncated, blocks: [], source: [] };
  const a = textOf(before);
  const b = textOf(after);
  const md = alignMarkdown(a, b, budgetMs);
  if (!md) return textDiff(file, before, after, budgetMs);
  // The Source toggle's line diff gets what the blocks left of the budget.
  const source = compactLines(lineChanges(a, b, md.deadline));
  return { ok: true, kind: "markdown", same, truncated: truncated || source.cut, blocks: md.blocks, source: source.lines };
}
