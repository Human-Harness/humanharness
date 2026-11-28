// What a file's diff looks like to the window, and which files are binary. The diff itself is the documents mod's.

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
export type MdBlockType = "frontMatter" | "heading" | "paragraph" | "listItem" | "tableRow" | "code" | "mermaid" | "callout" | "quote" | "other";

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

/** Bytes looked at for a NUL. */
const SNIFF_BYTES = 8 * 1024;
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "heic", "ico", "bmp", "tif", "tiff", "psd",
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "m4v", "avi", "mkv", "webm",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "dmg", "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages", "odt", "ods", "odp",
  "woff", "woff2", "ttf", "otf", "eot", "sqlite", "db", "bin", "exe", "dll", "so", "dylib", "class", "jar", "wasm",
]);

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
