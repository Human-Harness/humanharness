import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

/** Import limits (sidekick plan Decision 14): at most this many files, each at most this many bytes; paste the same. */
export const IMPORT_MAX_FILES = 4;
export const IMPORT_MAX_BYTES = 64 * 1024;
/** Plain-text files only: `.md`, `.txt` or no extension. */
const EXTS = new Set([".md", ".txt", ""]);
/**
 * Engines' settings folders, under the home folder (spec §2a.6 and the compliance rules): a picked file inside one is
 * refused by its path, after links are resolved and before any byte of it is read. Nothing inside them is ever listed
 * or opened.
 */
export const ENGINE_DIRS: readonly string[] = [".claude", ".codex", ".gemini", join(".config", "opencode"), join(".local", "share", "opencode")];
/** How many links one path may go through before it counts as unresolvable. */
const MAX_LINKS = 40;

/** Paths compare without case where the file system usually ignores it. */
const folded = (p: string) => (process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p);
const inside = (child: string, parent: string) => {
  const c = folded(child);
  const d = folded(parent);
  return c === d || c.startsWith(d.endsWith(sep) ? d : d + sep);
};

/**
 * The real path of `p`: its links resolved, a dangling one too (its target, resolved through its own folder), and a
 * missing file through its resolved folder. Only path lookups (realpath, readlink): no file is opened.
 */
export async function resolvedPath(p: string, depth = 0): Promise<string> {
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch {
    if (depth >= MAX_LINKS) return abs;
    try {
      const target = await readlink(abs);
      return resolvedPath(isAbsolute(target) ? target : join(dirname(abs), target), depth + 1);
    } catch {
      const parent = dirname(abs);
      if (parent === abs) return abs;
      return join(await resolvedPath(parent, depth + 1), basename(abs));
    }
  }
}

/** The engine folders under `home`, both as written and resolved (a linked folder counts as where it points). */
async function engineDirs(home: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const d of ENGINE_DIRS) {
    const literal = resolve(home, d);
    dirs.push(literal, await resolvedPath(literal));
  }
  return dirs;
}

/**
 * Whether a picked path is refused: it is, or resolves into, an engine's settings folder under `home`. The path as
 * written is checked first, so a path inside one is refused before anything there is even looked up.
 */
export async function refusedPath(p: string, home: string): Promise<boolean> {
  const literal = resolve(p);
  if (ENGINE_DIRS.some((d) => inside(literal, resolve(home, d)))) return true;
  const real = await resolvedPath(literal);
  return (await engineDirs(home)).some((d) => inside(real, d));
}

export type ImportReadFailure = "engine-settings" | "too-many" | "too-big" | "type" | "unreadable";
export type ImportRead = { ok: true; text: string; hash: string; paths: string[] } | { ok: false; reason: ImportReadFailure; file?: string };

/** A file's name as the prompt shows it: letters, digits, spaces, dots, dashes and underscores only. */
const safeName = (name: string) => name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 100);

/**
 * The imported files as one text, each in its own `<file>` block. The text is untrusted: it can't close or open a
 * block (`<file`, `</file` and `</instructions` are broken up). The hash covers exactly this text.
 */
export function joinImportFiles(files: readonly { name: string; text: string }[]): string {
  return files.map((f) => `<file name="${safeName(f.name)}">\n${f.text.replace(/<(\/?)(file|instructions)/gi, "< $1$2")}\n</file>`).join("\n");
}

export const importHash = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface ImportIo {
  /** The file's text; rejects with ImportTooBig past IMPORT_MAX_BYTES (it never reads much more). */
  read(p: string): Promise<string>;
  /** The file's size in bytes; throws when it isn't a regular file. */
  size(p: string): Promise<number>;
}

/** A file that grew past IMPORT_MAX_BYTES after its size was read. */
export class ImportTooBig extends Error {}

/** Reads at most IMPORT_MAX_BYTES bytes (more throws ImportTooBig), never following a link at the last step (the path is already resolved). */
async function boundedRead(p: string): Promise<string> {
  const fh = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buf = Buffer.alloc(IMPORT_MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > IMPORT_MAX_BYTES) throw new ImportTooBig();
    return buf.subarray(0, n).toString("utf8");
  } finally {
    await fh.close();
  }
}

const fileIo: ImportIo = {
  read: boundedRead,
  size: async (p) => {
    const s = await stat(p);
    if (!s.isFile()) throw new Error("Not a file");
    return s.size;
  },
};

/**
 * The picked files for an import (spec §2a.6): refused when one is in an engine's settings folder (by resolved path,
 * every file checked before any is read), when there are too many, one isn't plain text or one is too big. Each file
 * is read from its resolved path, size-checked before and after reading. `hash` lets the import notice a changed original.
 */
export async function readImportFiles(paths: readonly string[], home: string, io: ImportIo = fileIo): Promise<ImportRead> {
  if (paths.length === 0) return { ok: false, reason: "unreadable" };
  if (paths.length > IMPORT_MAX_FILES) return { ok: false, reason: "too-many" };
  // Every refusal check runs before any file is opened.
  const real: string[] = [];
  for (const p of paths) {
    if (await refusedPath(p, home)) return { ok: false, reason: "engine-settings" };
    real.push(await resolvedPath(p));
  }
  for (const [i, p] of paths.entries()) {
    // The picked name and the file it resolves to: both plain text.
    if (!EXTS.has(extname(p).toLowerCase()) || !EXTS.has(extname(real[i]).toLowerCase())) return { ok: false, reason: "type", file: basename(p) };
  }
  const files: { name: string; text: string }[] = [];
  for (const [i, p] of paths.entries()) {
    const size = await io.size(real[i]).catch(() => -1);
    if (size < 0) return { ok: false, reason: "unreadable", file: basename(p) };
    if (size > IMPORT_MAX_BYTES) return { ok: false, reason: "too-big", file: basename(p) };
    // Checked again just before reading: a link swapped in after the first check is still refused.
    if (await refusedPath(real[i], home)) return { ok: false, reason: "engine-settings" };
    let text: string;
    try {
      text = await io.read(real[i]);
    } catch (err) {
      // It may have grown since its size was read.
      return { ok: false, reason: err instanceof ImportTooBig ? "too-big" : "unreadable", file: basename(p) };
    }
    if (text.length > IMPORT_MAX_BYTES) return { ok: false, reason: "too-big", file: basename(p) };
    files.push({ name: basename(p), text });
  }
  const text = joinImportFiles(files);
  return { ok: true, text, hash: importHash(text), paths: [...paths] };
}
