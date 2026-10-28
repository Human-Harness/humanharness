import { diffLines, diffWordsWithSpace } from "diff";

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

/** A block of a Markdown diff (Task 7 fills it in). */
export interface MdDiffBlock {
  type: string;
  status: "same" | "added" | "removed" | "changed";
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

/** A line diff with line numbers; a timed-out diff is every old line removed, then every new line added. */
export function lineChanges(before: string, after: string): LineChange[] {
  const changes = diffLines(before, after, { timeout: DIFF_TIMEOUT_MS }) ?? [
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
export function wordParts(before: string, after: string): DiffPart[] {
  const changes = diffWordsWithSpace(before, after, { timeout: DIFF_TIMEOUT_MS });
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

/** What changed in `file` from `before` to `after` (§4.2): blocks for Markdown, lines for text, sizes for binary. */
export function diffFile(file: string, before: DiffSide, after: DiffSide): FileDiffView {
  const same = sameSides(before, after);
  const binary = (before.kind === "bytes" && isBinary(file, before.bytes)) || (after.kind === "bytes" && isBinary(file, after.bytes));
  if (binary) return { ok: true, kind: "binary", same, sizes: { before: sizeOf(before), after: sizeOf(after) } };
  const ext = extensionOf(file);
  return { ok: true, kind: "text", same, truncated: cut(before, after), lines: lineChanges(textOf(before), textOf(after)), lang: ext || null };
}
