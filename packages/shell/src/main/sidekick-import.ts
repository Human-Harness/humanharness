import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, resolve, sep } from "node:path";

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
/**
 * Where the engines' settings folders are: under `home`, plus where the environment moved them (CLAUDE_CONFIG_DIR,
 * CODEX_HOME, $XDG_CONFIG_HOME/opencode, $XDG_DATA_HOME/opencode). Tests pass a fake home and env.
 */
export interface ImportPlace {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}
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

/** The engine folders as written: under home, and where the environment moved them. */
function engineFolders(where: ImportPlace): string[] {
  const dirs = ENGINE_DIRS.map((d) => resolve(where.home, d));
  const env = (k: string) => (where.env[k] ? resolve(where.env[k]!) : null);
  for (const d of [env("CLAUDE_CONFIG_DIR"), env("CODEX_HOME")]) if (d) dirs.push(d);
  for (const [k, rel] of [["XDG_CONFIG_HOME", "opencode"], ["XDG_DATA_HOME", "opencode"]] as const) {
    const base = env(k);
    if (base) dirs.push(join(base, rel));
  }
  return dirs;
}

/** A folder's identity (device and inode), or null when it can't be looked up. Only the folder itself: nothing in it is listed. */
async function identity(p: string): Promise<string | null> {
  try {
    const s = await stat(p, { bigint: true });
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/** The folders from the root down to `p`'s own folder (`/`, `/a`, `/a/b` for `/a/b/c.md`). */
function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let d = dirname(p); ; d = dirname(d)) {
    out.unshift(d);
    if (d === parse(d).root) return out;
  }
}

/**
 * Whether a picked path is refused: it is, or resolves into, an engine's settings folder. First by path: as written
 * (refused before anything there is even looked up), then resolved. Then by identity, for another name of the same
 * folder that no path comparison sees (macOS's `/System/Volumes/Data` firmlinks, hard-to-spot mounts): each engine
 * folder is looked up (missing ones skipped), then the resolved file's folders from the root down; any one that is
 * an engine folder refuses it, before a folder inside it is ever looked up.
 */
export async function refusedPath(p: string, where: ImportPlace): Promise<boolean> {
  const literal = resolve(p);
  const folders = engineFolders(where);
  if (folders.some((d) => inside(literal, d))) return true;
  const real = await resolvedPath(literal);
  const resolved = await Promise.all(folders.map((d) => resolvedPath(d)));
  if ([...folders, ...resolved].some((d) => inside(real, d))) return true;
  const ids = new Set((await Promise.all(folders.map(identity))).filter((id): id is string => id !== null));
  if (ids.size === 0) return false;
  for (const d of ancestors(real)) {
    const id = await identity(d);
    if (id === null) return false; // Missing: so is everything under it.
    if (ids.has(id)) return true;
  }
  return false;
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

/** A file's identity and size as looked up before it is opened. */
export interface ImportStat {
  /** Device and inode: the opened file must be this same one. */
  id: string;
  size: number;
  /** A regular file (a link, folder, FIFO or device is not). */
  file: boolean;
}

export interface ImportIo {
  /** The file's identity and size, the path's last step not followed (it is already resolved). */
  stat(p: string): Promise<ImportStat>;
  /**
   * The file's text, opened without following a link or blocking, and checked before any byte is read: a regular
   * file, at most IMPORT_MAX_BYTES (else ImportTooBig), and the same file `expected` described (else it throws).
   */
  read(p: string, expected: ImportStat, signal: AbortSignal): Promise<string>;
}

/** A file that grew past IMPORT_MAX_BYTES after its size was read. */
export class ImportTooBig extends Error {}

const statId = (s: { dev: bigint; ino: bigint }) => `${s.dev}:${s.ino}`;

/** Reads at most IMPORT_MAX_BYTES bytes (more throws ImportTooBig) of the file `expected` described, and only that one. */
async function boundedRead(p: string, expected: ImportStat, signal: AbortSignal): Promise<string> {
  // O_NONBLOCK: a FIFO swapped in opens without waiting for a writer, and is refused below.
  const fh = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const s = await fh.stat({ bigint: true });
    if (!s.isFile()) throw new Error("Not a file");
    if (statId(s) !== expected.id) throw new Error("Not the file that was checked");
    if (s.size > BigInt(IMPORT_MAX_BYTES)) throw new ImportTooBig();
    const buf = Buffer.alloc(IMPORT_MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      signal.throwIfAborted();
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

/** The real file system's ImportIo. */
export const importFileIo: ImportIo = {
  stat: async (p) => {
    const s = await lstat(p, { bigint: true });
    return { id: statId(s), size: Number(s.size), file: s.isFile() };
  },
  read: boundedRead,
};

/** `work`, or a rejection as soon as `signal` aborts (a read that hangs never holds the import). */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((ok, fail) => {
    const onAbort = () => fail(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => (signal.removeEventListener("abort", onAbort), ok(v)),
      (e) => (signal.removeEventListener("abort", onAbort), fail(e)),
    );
  });
}

/**
 * The picked files for an import (spec §2a.6): refused when one is in an engine's settings folder (by path and by
 * identity, every file checked before any is looked at further), when there are too many, one isn't plain text or one
 * is too big. Then each file, in turn: refusal checked again first, then its size and identity looked up, then opened
 * and checked to be that same regular file before any byte is read. An abort (the import's timeout or cancel) ends it
 * as unreadable. `hash` lets the import notice a changed original.
 */
export async function readImportFiles(paths: readonly string[], where: ImportPlace, io: ImportIo = importFileIo, signal: AbortSignal = new AbortController().signal): Promise<ImportRead> {
  if (paths.length === 0) return { ok: false, reason: "unreadable" };
  if (paths.length > IMPORT_MAX_FILES) return { ok: false, reason: "too-many" };
  // Every refusal check runs before any file is looked up.
  const real: string[] = [];
  for (const p of paths) {
    if (await refusedPath(p, where)) return { ok: false, reason: "engine-settings" };
    real.push(await resolvedPath(p));
  }
  for (const [i, p] of paths.entries()) {
    // The picked name and the file it resolves to: both plain text.
    if (!EXTS.has(extname(p).toLowerCase()) || !EXTS.has(extname(real[i]).toLowerCase())) return { ok: false, reason: "type", file: basename(p) };
  }
  const files: { name: string; text: string }[] = [];
  for (const [i, p] of paths.entries()) {
    // Checked again first: a link swapped in after the first check is still refused, before it is even looked up.
    if (await refusedPath(real[i], where)) return { ok: false, reason: "engine-settings" };
    if (signal.aborted) return { ok: false, reason: "unreadable", file: basename(p) };
    const info = await io.stat(real[i]).catch(() => null);
    if (!info?.file) return { ok: false, reason: "unreadable", file: basename(p) };
    if (info.size > IMPORT_MAX_BYTES) return { ok: false, reason: "too-big", file: basename(p) };
    let text: string;
    try {
      text = await abortable(io.read(real[i], info, signal), signal);
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
