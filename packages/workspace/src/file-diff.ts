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
/** One line of a line diff; `old`/`new` are 1-based line numbers on each side. */
export interface LineChange {
  kind: "same" | "ins" | "del";
  text: string;
  old?: number;
  new?: number;
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

/** A block of a Markdown diff. `before`/`after`: the block's source on each side. */
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

/** Splits jsdiff's value into lines (its last line ending dropped), without a regex. */
function splitLines(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", start)) {
    out.push(value.slice(start, i));
    start = i + 1;
  }
  if (start < value.length) out.push(value.slice(start));
  return out;
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

const textOf = (s: DiffSide): string => (s.kind === "absent" ? "" : Buffer.from(cutBytes(s.bytes, MAX_DIFF_BYTES)).toString("utf8"));
const sizeOf = (s: DiffSide): number | null => (s.kind === "absent" ? null : s.size);
const sameSides = (a: DiffSide, b: DiffSide): boolean =>
  a.kind === "absent" ? b.kind === "absent" : b.kind !== "absent" && a.size === b.size && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));
const cut = (a: DiffSide, b: DiffSide): boolean => (sizeOf(a) ?? 0) > MAX_DIFF_BYTES || (sizeOf(b) ?? 0) > MAX_DIFF_BYTES;

/** The reader's parser (document-reader spec §3): remark-parse + remark-gfm, no raw HTML path. */
const processor = unified().use(remarkParse).use(remarkGfm);

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join(node.type === "listItem" || node.type === "blockquote" ? "\n" : "");
  return "";
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
  before: b.source,
  after: b.source,
  ...depthOf(b),
  ...(b.cells ? { cells: { before: b.cells, after: b.cells } } : {}),
});

/**
 * Blocks aligned on their source (§4.2): in a run of removed-then-added blocks, the i-th of each pair up when they are
 * the same type ("changed"); the rest stay removed or added. Every jsdiff call shares `deadline` (a `Date.now()` value).
 */
export function diffMarkdown(before: string, after: string, deadline = deadlineIn(DIFF_TIMEOUT_MS)): MdDiffBlock[] {
  const a = markdownBlocks(before);
  const b = markdownBlocks(after);
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
  return out;
}

/**
 * What changed in `file` from `before` to `after` (§4.2): blocks for Markdown, lines for text, sizes for binary.
 * The whole call shares one time budget (`budgetMs`); what is left when it runs out shows as removed, then added.
 */
export function diffFile(file: string, before: DiffSide, after: DiffSide, budgetMs = DIFF_TIMEOUT_MS): FileDiffView {
  const deadline = deadlineIn(budgetMs);
  const same = sameSides(before, after);
  const binary = (before.kind === "bytes" && isBinary(file, before.bytes)) || (after.kind === "bytes" && isBinary(file, after.bytes));
  if (binary) return { ok: true, kind: "binary", same, sizes: { before: sizeOf(before), after: sizeOf(after) } };
  const ext = extensionOf(file);
  if (ext === "md" || ext === "markdown") {
    const a = textOf(before);
    const b = textOf(after);
    return { ok: true, kind: "markdown", same, truncated: cut(before, after), blocks: diffMarkdown(a, b, deadline), source: lineChanges(a, b, deadline) };
  }
  return { ok: true, kind: "text", same, truncated: cut(before, after), lines: lineChanges(textOf(before), textOf(after), deadline), lang: ext || null };
}
