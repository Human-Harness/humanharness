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

/** The index file of one history's git data. Reads are cached while the file's inode, time and size stay the same. */
export class FileIndex {
  private readonly file: string;
  private memo: { data: FileIndexData; ino: number; mtimeMs: number; size: number } | null = null;

  constructor(gitdir: string) {
    this.file = path.join(gitdir, FILE_INDEX_NAME);
  }

  /** The index, or null when it is missing, too big or not an index. */
  async load(): Promise<FileIndexData | null> {
    const stat = await fs.stat(this.file).catch(() => null);
    if (!stat || stat.size > MAX_INDEX_BYTES) return null;
    const m = this.memo;
    if (m && m.ino === stat.ino && m.mtimeMs === stat.mtimeMs && m.size === stat.size) return m.data;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!valid(raw)) return null;
      this.memo = { data: raw, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
      return raw;
    } catch {
      return null;
    }
  }

  /**
   * Writes `data` through a temp file and a rename (another `History` on the same git data may write too: last wins).
   * The cache keeps `data` itself, so a caller hands over an object it no longer changes.
   */
  async save(data: FileIndexData): Promise<void> {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    const stat = await fs.stat(this.file);
    this.memo = { data, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
  }

  /**
   * A new commit: added when its parent is the head (or it is the history's first commit and there is no index).
   * Anything else is left for the next read, which catches up or rebuilds.
   */
  async record(parent: string | null, sha: string, paths: readonly string[]): Promise<void> {
    const data = await this.load();
    if (data === null) {
      if (parent !== null) return;
      const fresh = emptyIndex(null);
      addCommit(fresh, sha, paths);
      await this.save(fresh);
      return;
    }
    if (data.head !== parent) return;
    // A copy: `data` is the cache's, which must keep matching the file if the save fails.
    const next = structuredClone(data);
    addCommit(next, sha, paths);
    await this.save(next);
  }
}
