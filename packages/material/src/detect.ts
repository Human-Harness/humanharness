import path from "node:path";
import type { Detected, MaterialType } from "./types";

const MEDIA = "The app only works with files that have text.";
const OLD_OFFICE = "Save it as .docx, .xlsx or .pptx and add it again.";
const BINARY = "This file has no text the app can read.";

const starts = (b: Buffer, sig: number[] | string, at = 0) => {
  const s = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
  return b.length >= at + s.length && b.subarray(at, at + s.length).equals(s);
};

const ZIP_TYPES: Record<string, Exclude<Detected, { ok: false }>> = {
  ".docx": { ok: true, type: "docx", family: "word" },
  ".odt": { ok: true, type: "odt", family: "word" },
  ".xlsx": { ok: true, type: "xlsx", family: "spreadsheet" },
  ".ods": { ok: true, type: "ods", family: "spreadsheet" },
  ".pptx": { ok: true, type: "pptx", family: "presentation" },
  ".odp": { ok: true, type: "odp", family: "presentation" },
  ".epub": { ok: true, type: "epub", family: "ebook" },
};
const OLD = new Set([".doc", ".xls", ".ppt"]);
const MEDIA_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".tif", ".tiff", ".bmp", ".svg", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const TEXT_EXT: Record<string, MaterialType> = { ".md": "md", ".markdown": "md", ".txt": "txt", ".json": "json", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml" };
const CODE_EXT = new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".h", ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".sql", ".sh", ".css", ".scss"]);

/** Image, audio and video signatures (§3 "Refused at intake"). */
function isMedia(b: Buffer): boolean {
  if (starts(b, [0xff, 0xd8, 0xff]) || starts(b, [0x89, 0x50, 0x4e, 0x47]) || starts(b, "GIF8") || starts(b, "II*\0") || starts(b, "MM\0*") || starts(b, "BM")) return true;
  if (starts(b, "RIFF") && (starts(b, "WEBP", 8) || starts(b, "WAVE", 8) || starts(b, "AVI ", 8))) return true;
  if (starts(b, "ftyp", 4)) return true; // mp4, mov, heic, m4a
  if (starts(b, "ID3") || starts(b, [0xff, 0xfb]) || starts(b, "OggS") || starts(b, "fLaC") || starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return true;
  return false;
}

/** Text: no NUL byte, and at most 10% control characters (tabs, line and page breaks excepted) in the first 64 KB. */
export function looksLikeText(b: Buffer): boolean {
  const head = b.subarray(0, 65536);
  if (head.includes(0)) return false;
  let control = 0;
  for (const c of head) if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) control++;
  return head.length === 0 || control / head.length <= 0.1;
}

/**
 * The file's type from its content first (magic bytes), its extension second (§3), or why it is refused. Zip-based
 * formats are told apart by their extension here; their converter refuses a zip that lacks the expected parts.
 * `head` is the file's first bytes (64 KB are enough).
 */
export function detectType(name: string, head: Buffer): Detected {
  const ext = path.extname(name).toLowerCase();
  if (starts(head, "%PDF-")) return { ok: true, type: "pdf", family: "pdf" };
  if (isMedia(head)) return { ok: false, reason: "media", message: MEDIA };
  if (OLD.has(ext) || starts(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { ok: false, reason: "old-office", message: OLD_OFFICE };
  if (starts(head, [0x50, 0x4b, 0x03, 0x04])) {
    return Object.hasOwn(ZIP_TYPES, ext) ? ZIP_TYPES[ext] : { ok: false, reason: "unreadable", message: BINARY };
  }
  if (MEDIA_EXT.has(ext)) return { ok: false, reason: "media", message: MEDIA };
  if (!looksLikeText(head)) return { ok: false, reason: "binary", message: BINARY };
  if (starts(head, "{\\rtf")) return { ok: true, type: "rtf", family: "word" };
  const start = head.subarray(0, 1024).toString("latin1").trimStart().toLowerCase();
  if (ext === ".html" || ext === ".htm" || start.startsWith("<!doctype html") || start.startsWith("<html")) return { ok: true, type: "html", family: "web" };
  if (ext === ".csv") return { ok: true, type: "csv", family: "spreadsheet" };
  if (ext === ".tsv") return { ok: true, type: "tsv", family: "spreadsheet" };
  if (Object.hasOwn(TEXT_EXT, ext)) return { ok: true, type: TEXT_EXT[ext], family: "text" };
  if (CODE_EXT.has(ext)) return { ok: true, type: "code", family: "text" };
  return { ok: true, type: "txt", family: "text" };
}

/** Refusal messages the pipeline uses beyond detection (§3, §7). English, shown to the person. */
export const REFUSAL_TEXT = {
  scanned: "This PDF is scanned: it has no text the app can read.",
  protected: "This file is protected by a password or damaged.",
  unreadable: "This file is damaged or not what its name says.",
  "too-big": "This file is too big. Add only the chapters you need.",
  "not-accepted": "This app doesn't take this kind of file.",
  fetch: "The page couldn't be read. Check the link and try again.",
} as const;
