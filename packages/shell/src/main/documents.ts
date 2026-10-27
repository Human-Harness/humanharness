import nodeFs, { type FSWatcher, constants, promises as fs } from "node:fs";
import path from "node:path";
import type { DocumentRead } from "@humanharness/ui/client";
import { stillSafe } from "./open-path";

/** Over this the reader refuses a document (Open questions Q6). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Over this an image shows its alt text (Open questions Q5). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
/** `.md` and `.markdown` (the SDK's `isMarkdownPath` takes only `.md`). */
const MARKDOWN = /\.(md|markdown)$/i;

/**
 * Whether `rel` is not a plain relative path, checked before any file system call: not a string, empty, too long, a
 * NUL, a backslash (also every UNC path), absolute (also `//host`), a drive letter, or leaving upward from the start
 * (`..`, `../x`, `./../x`). A `..` further in is caught later by the containment check.
 */
export function refusedShape(rel: unknown): boolean {
  if (typeof rel !== "string" || !rel || rel.length > 1000) return true;
  if (rel.includes("\0") || rel.includes("\\")) return true;
  if (rel.startsWith("/") || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return true;
  const normal = path.posix.normalize(rel);
  return normal === ".." || normal.startsWith("../");
}

export type Located = { ok: true; file: string; root: string } | { ok: false; reason: "outside" | "missing" };

/**
 * Where `rel` is, tried in each root in order (the person's folder first, then the reference folders): a regular file
 * whose real path is inside the same root. A path that is inside a root but not there is "missing"; a path that leaves
 * every root, or a link that points out, is "outside".
 */
export async function locate(rel: unknown, roots: string[]): Promise<Located> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  const relPath = rel as string;
  let inside = false;
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    const candidate = path.resolve(realRoot, relPath);
    if (!candidate.startsWith(realRoot + path.sep)) continue;
    inside = true;
    const real = await fs.realpath(candidate).catch(() => null);
    if (!real) continue;
    if (!real.startsWith(realRoot + path.sep)) return { ok: false, reason: "outside" };
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return { ok: true, file: real, root: realRoot };
  }
  return { ok: false, reason: inside ? "missing" : "outside" };
}

/**
 * The bytes of `file` (from `locate`), re-checked right before it is opened, opened without following a link and
 * without blocking (a FIFO swapped in can't hang main), checked again once open (the handle is still the file at that
 * path, which is still inside a root), and read only up to `max` bytes. Null when it is no longer safe, not a regular
 * file, or a hard link (`nlink > 1`: its other names may be outside every root); the size when it is too big.
 */
async function readCapped(file: string, roots: string[], max: number): Promise<{ bytes: Buffer; mtime: Date } | { size: number } | null> {
  if (!(await stillSafe(file, roots))) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1) return null;
    const there = await fs.stat(file).catch(() => null);
    if (!there || there.dev !== stat.dev || there.ino !== stat.ino || !(await stillSafe(file, roots))) return null;
    if (stat.size > max) return { size: stat.size };
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await handle.read(bytes, read, bytes.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return { bytes: bytes.subarray(0, read), mtime: stat.mtime };
  } finally {
    await handle.close();
  }
}

/** A Markdown document's text (§5.3). Only `.md`/`.markdown`; checked again right before it is read. Never writes. */
export async function readDocument(rel: unknown, roots: string[]): Promise<DocumentRead> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  if (!MARKDOWN.test(rel as string)) return { ok: false, reason: "not-markdown" };
  const at = await locate(rel, roots);
  if (!at.ok) return at;
  if (!MARKDOWN.test(at.file)) return { ok: false, reason: "not-markdown" };
  const got = await readCapped(at.file, roots, MAX_DOCUMENT_BYTES);
  if (!got) return { ok: false, reason: "outside" };
  if (!("bytes" in got)) return { ok: false, reason: "too-large", size: got.size };
  return { ok: true, text: got.bytes.toString("utf8"), mtime: got.mtime.toISOString(), size: got.bytes.length };
}

/** A local image as a data: URL (§3.2), or null. No SVG: only PNG, JPEG, GIF and WebP up to 5 MB. */
export async function readImage(rel: unknown, roots: string[]): Promise<string | null> {
  if (refusedShape(rel)) return null;
  const type = IMAGE_TYPES[path.extname(rel as string).toLowerCase()];
  if (!type) return null;
  const at = await locate(rel, roots);
  if (!at.ok || IMAGE_TYPES[path.extname(at.file).toLowerCase()] !== type) return null;
  const got = await readCapped(at.file, roots, MAX_IMAGE_BYTES);
  if (!got || !("bytes" in got)) return null;
  return `data:${type};base64,${got.bytes.toString("base64")}`;
}

/** Most paths one `documentsExist` call answers; a longer list gets no answer (`[]`). */
export const MAX_EXIST_PATHS = 200;

/** Whether each path is a file the reader could open (cards of moved or deleted files are struck through). */
export async function documentsExist(paths: unknown, roots: string[]): Promise<boolean[]> {
  if (!Array.isArray(paths) || paths.length > MAX_EXIST_PATHS) return [];
  return Promise.all(paths.map(async (p) => (await locate(p, roots)).ok));
}

/** Most documents watched at once; a new watch over this closes the oldest. */
export const MAX_WATCHES = 16;

/**
 * Live reload (§5.3): watches a document's folder (a file replaced by a rename keeps being seen) and calls `onChange`
 * with the watch id once things have been quiet for `quietMs`. A watcher that fails (its folder moved or was deleted)
 * is closed and reported as one last change, so the reader reads again and shows what happened.
 */
export class DocumentWatchers {
  private next = 1;
  /** Oldest first (a Map keeps insertion order). */
  private readonly open = new Map<number, () => void>();
  /** Bumped by `closeAll`: a watch still being set up meanwhile is not made. */
  private generation = 0;
  /**
   * Told when a watch ends by itself: closed to make room (`MAX_WATCHES`) or after its watcher failed. Not called for
   * `unwatch` or `closeAll`, which the caller asked for.
   */
  onClosed: ((id: number) => void) | null = null;

  constructor(
    private readonly onChange: (id: number) => void,
    private readonly quietMs = 150,
  ) {}

  async watch(rel: unknown, roots: string[]): Promise<number | null> {
    const generation = this.generation;
    const at = await locate(rel, roots);
    if (!at.ok || generation !== this.generation) return null;
    const name = path.basename(at.file);
    const id = this.next++;
    let timer: NodeJS.Timeout | null = null;
    let watcher: FSWatcher;
    try {
      watcher = nodeFs.watch(path.dirname(at.file), (_event, file) => {
        if (file !== null && file !== undefined && String(file) !== name) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => this.onChange(id), this.quietMs);
      });
    } catch {
      return null;
    }
    watcher.on("error", () => {
      if (!this.open.has(id)) return;
      this.unwatch(id);
      this.onChange(id);
      this.onClosed?.(id);
    });
    while (this.open.size >= MAX_WATCHES) {
      const oldest = this.open.keys().next().value as number;
      this.unwatch(oldest);
      this.onClosed?.(oldest);
    }
    this.open.set(id, () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    });
    return id;
  }

  unwatch(id: unknown): void {
    if (typeof id !== "number") return;
    this.open.get(id)?.();
    this.open.delete(id);
  }

  /** How many watches are open. */
  get size(): number {
    return this.open.size;
  }

  closeAll(): void {
    this.generation++;
    for (const id of [...this.open.keys()]) this.unwatch(id);
  }
}
