import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** The index's file name, inside the history's git data folder (file-timeline spec §3.3). */
export const FILE_INDEX_NAME = "hh-file-index.json";

/** Each tracked path's commits, oldest first, up to `head`. Not a source of truth: losing it costs a rebuild. */
export interface FileIndexData {
  version: 1;
  head: string | null;
  paths: Record<string, string[]>;
}

/**
 * Limits on what `load` accepts; an index past them loads as missing. They sit far above any real history (a folder
 * of 10,000 files with 100,000 commits writes a few MB), so they only refuse a file that was not written by a rebuild:
 * one under the limits refused here would make every read rebuild the whole log again.
 */
export const MAX_INDEX_BYTES = 256 * 1024 * 1024;
export const MAX_INDEX_PATHS = 1_000_000;
export const MAX_PATH_COMMITS = 1_000_000;

const SHA = /^[0-9a-f]{40}$/;

export const emptyIndex = (head: string | null): FileIndexData => ({ version: 1, head, paths: {} });

/** Adds commit `sha` to each of `paths` and makes it the head. */
export function addCommit(data: FileIndexData, sha: string, paths: readonly string[]): void {
  for (const p of paths) {
    let list = Object.hasOwn(data.paths, p) ? data.paths[p] : undefined;
    if (!list) {
      // defineProperty, so a file named `__proto__` is an own entry rather than the object's prototype.
      list = [];
      Object.defineProperty(data.paths, p, { value: list, enumerable: true, writable: true, configurable: true });
    }
    if (list.at(-1) !== sha) list.push(sha);
  }
  data.head = sha;
}

/** A history path: not empty, no NUL, not absolute (`/x`, `\x`, `C:…`). Scanned by hand, no regex. */
function relativeKey(key: string): boolean {
  if (key.length === 0 || key.includes("\0")) return false;
  const c = key[0];
  if (c === "/" || c === "\\") return false;
  const letter = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
  return !(letter && key[1] === ":");
}

function valid(raw: unknown): raw is FileIndexData {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !(r.head === null || (typeof r.head === "string" && SHA.test(r.head)))) return false;
  if (typeof r.paths !== "object" || r.paths === null || Array.isArray(r.paths)) return false;
  const entries = Object.entries(r.paths as Record<string, unknown>);
  if (entries.length > MAX_INDEX_PATHS) return false;
  return entries.every(
    ([k, l]) => relativeKey(k) && Array.isArray(l) && l.length <= MAX_PATH_COMMITS && l.every((s) => typeof s === "string" && SHA.test(s)),
  );
}

/**
 * The index file of one history's git data. Not cached here: the History holds the index it read, and reads the file
 * again only when another History moved HEAD.
 */
export class FileIndex {
  private readonly file: string;

  constructor(gitdir: string) {
    this.file = path.join(gitdir, FILE_INDEX_NAME);
  }

  /** The index, or null when it is missing, too big or not an index. */
  async load(): Promise<FileIndexData | null> {
    const stat = await fs.stat(this.file).catch(() => null);
    if (!stat || stat.size > MAX_INDEX_BYTES) return null;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      return valid(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  /**
   * Writes `data` through a temp file and a rename (another `History` on the same git data may write too: last wins).
   * `data` is serialised before the first await, so the caller may change it as soon as this returns its promise.
   */
  async save(data: FileIndexData): Promise<void> {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const json = JSON.stringify(data);
    try {
      await fs.writeFile(tmp, json);
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
