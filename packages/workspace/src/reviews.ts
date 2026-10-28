import { createHash, randomUUID } from "node:crypto";
import nodeFs, { promises as fs } from "node:fs";
import path from "node:path";
import { type Review, type ReviewSummary, isMarkdownPath, refusedShape, reviewSchema, summarizeReview } from "@humanharness/harness-sdk";
import { readCapped } from "./safe-read";

/** Over this a document is not reviewed (the reader's own limit). */
export const MAX_REVIEW_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Over this a record is "broken", so no save makes one larger. */
export const MAX_RECORD_BYTES = 5 * 1024 * 1024;

export type ReviewReason = "outside" | "missing" | "not-markdown" | "too-large" | "broken" | "unknown" | "not-found" | "bad-input" | "full";

/** A refusal whose message is safe to show the agent (a tool error) or the person; `reason` is for the window. */
export class ReviewRefused extends Error {
  constructor(
    message: string,
    readonly reason: ReviewReason = "bad-input",
  ) {
    super(message);
    this.name = "ReviewRefused";
  }
}

export type OwnReason = "outside" | "missing" | "not-markdown" | "too-large";
export type OwnDocument = { ok: true; file: string; path: string; text: string; bytes: Buffer } | { ok: false; reason: OwnReason };

/** git's blob id of `bytes`: what the history stores for that content, so an approval names a version (D4). */
export function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Where `rel` is under the real base, with its canonical path; null when its shape is refused or it leaves the base. */
async function resolveDocument(base: string, rel: unknown): Promise<{ root: string; file: string; real: string | null; path: string } | null> {
  if (refusedShape(rel)) return null;
  const root = await fs.realpath(base);
  const file = path.resolve(root, rel as string);
  if (!file.startsWith(root + path.sep)) return null;
  const real = await fs.realpath(file).catch(() => null);
  // A disk that ignores case gives the name as stored; only that may differ (a link elsewhere is left to the caller).
  const named = real !== null && real.toLowerCase() === file.toLowerCase() ? real : file;
  return { root, file, real, path: path.relative(root, named).split(path.sep).join("/") };
}

/**
 * The one key of a document for its record, its lock and `Review.path`: relative to the real base, forward slashes,
 * no `.`/`..`/empty parts, and the name as the disk stores it (`./specs/A.md` and `specs//a.md` are `specs/a.md` on a
 * disk that ignores case). A missing document keeps the name asked. Null when the path is refused or leaves the base.
 */
export async function canonicalDocumentPath(base: string, rel: unknown): Promise<string | null> {
  return (await resolveDocument(base, rel))?.path ?? null;
}

/**
 * `rel` as a document of the person's folder a review may touch: a plain relative `.md` path, not under `.harness/`,
 * whose real path is the path asked up to case (a link anywhere on the way is refused, so a write never lands outside).
 * `file` is the real path and `path` the canonical key.
 */
async function ownPath(base: string, rel: unknown): Promise<{ ok: true; file: string; path: string } | { ok: false; reason: OwnReason }> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  if (!isMarkdownPath(rel as string)) return { ok: false, reason: "not-markdown" };
  const at = await resolveDocument(base, rel);
  if (!at) return { ok: false, reason: "outside" };
  // Checked on the canonical path (so `a/../.harness/x.md` is caught) and in any case (a disk that ignores case).
  if (at.path.split("/")[0].toLowerCase() === ".harness") return { ok: false, reason: "outside" };
  if (at.real === null) return { ok: false, reason: "missing" };
  if (at.real.toLowerCase() !== at.file.toLowerCase()) return { ok: false, reason: "outside" };
  return { ok: true, file: at.real, path: at.path };
}

/** The document at `file` is still the own document `rel` resolved to (no link swapped in since). */
const stillOwn = (base: string, rel: unknown, file: string) => async (): Promise<boolean> => {
  const again = await ownPath(base, rel);
  return again.ok && again.file === file;
};

/**
 * A document the review reads (§4 "inside the person's folder only"): never a reference folder, a link or a hard link.
 * `path` is its canonical key (`canonicalDocumentPath`).
 */
export async function readOwnDocument(base: string, rel: unknown): Promise<OwnDocument> {
  const at = await ownPath(base, rel);
  if (!at.ok) return at;
  const got = await readCapped(at.file, MAX_REVIEW_DOCUMENT_BYTES, stillOwn(base, rel, at.file));
  if (!got) return { ok: false, reason: "outside" };
  if (!("bytes" in got)) return { ok: false, reason: "too-large" };
  return { ok: true, file: at.file, path: at.path, bytes: got.bytes, text: got.bytes.toString("utf8") };
}

/**
 * Writes the document's new text (an answer's swap, §5.1), only when its bytes still equal `expected` (what the caller
 * read under the lock) and the new text is within the size a review takes. Through a temp file in the same folder (the
 * history skips it) and a rename; the file keeps its mode.
 */
export async function writeOwnDocument(
  base: string,
  rel: string,
  expected: Uint8Array,
  next: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: OwnReason | "changed" }> {
  const bytes = Buffer.from(next, "utf8");
  if (bytes.length > MAX_REVIEW_DOCUMENT_BYTES) return { ok: false, reason: "too-large" };
  const now = await readOwnDocument(base, rel);
  if (!now.ok) return now;
  if (!Buffer.from(expected).equals(now.bytes)) return { ok: false, reason: "changed" };
  const mode = (await fs.stat(now.file)).mode & 0o777;
  const tmp = path.join(path.dirname(now.file), `.${path.basename(now.file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { flag: "wx", mode });
    // The umask masks the mode given at creation.
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, now.file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { ok: true, bytes };
}

const broken = (doc: string) => new ReviewRefused(`the review of ${path.posix.basename(doc)} can't be read`, "broken");

/**
 * The record's file, `<real base>/.harness/reviews/<doc>.json`, and the reviews folder. `doc` must be the canonical key
 * (`canonicalDocumentPath`): another spelling of the same document would share the file but not the `path` or the lock.
 */
async function recordPath(base: string, doc: string): Promise<{ file: string; top: string }> {
  if (refusedShape(doc)) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
  const canonical = await canonicalDocumentPath(base, doc);
  if (canonical === null) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
  if (canonical !== doc) throw new ReviewRefused(`${doc} is not the document's own path (${canonical})`, "bad-input");
  const top = path.join(await fs.realpath(base), ".harness", "reviews");
  const file = path.join(top, ...`${doc}.json`.split("/"));
  if (!file.startsWith(top + path.sep)) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
  return { file, top };
}

/** A new record (§3): `task` and `scope` from the task open now. */
export function newReview(doc: string, task: { id: string; scope: string } | null): Review {
  return { path: doc, task: task?.id ?? null, ...(task ? { scope: task.scope } : {}), comments: [], approvals: [] };
}

/** The record of `doc`; null when there is none. Throws `ReviewRefused` ("broken") when it fails the schema. */
export async function loadReview(base: string, doc: string): Promise<Review | null> {
  const { file } = await recordPath(base, doc);
  const dir = path.dirname(file);
  const realDir = await fs.realpath(dir).catch(() => null);
  if (realDir === null) return null;
  if (realDir !== dir) throw broken(doc);
  if (!(await fs.lstat(file).catch(() => null))) return null;
  const stillThere = async (): Promise<boolean> => (await fs.realpath(dir).catch(() => null)) === dir;
  const got = await readCapped(file, MAX_RECORD_BYTES, stillThere).catch(() => null);
  if (!got || !("bytes" in got)) throw broken(doc);
  let parsed: unknown;
  try {
    parsed = JSON.parse(got.bytes.toString("utf8"));
  } catch {
    throw broken(doc);
  }
  const r = reviewSchema.safeParse(parsed);
  if (!r.success || r.data.path !== doc) throw broken(doc);
  return r.data as Review;
}

/** Writes the record atomically (a temp file the history skips, then a rename). Never through a linked folder. */
export async function saveReview(base: string, review: Review): Promise<void> {
  const json = `${JSON.stringify(review, null, 2)}\n`;
  // The agent's tools and the person's actions alike: past the cap the next load would call the record broken.
  if (Buffer.byteLength(json) > MAX_RECORD_BYTES) throw new ReviewRefused(`${path.posix.basename(review.path)} has too many comments`, "full");
  const { file, top } = await recordPath(base, review.path);
  const dir = path.dirname(file);
  // Folder by folder from `.harness` down, each checked before the next is made: a link (or a file) on the way is
  // refused, so no folder is ever created through a link.
  let d = path.dirname(top);
  for (const part of ["", "reviews", ...path.relative(top, dir).split(path.sep).filter(Boolean)]) {
    if (part) d = path.join(d, part);
    const st = await fs.lstat(d).catch(() => null);
    if (st && !st.isDirectory()) throw new ReviewRefused("the review folder is a link", "outside");
    if (!st) await fs.mkdir(d);
  }
  // A swap between the check and the write: caught here. A swap in the instant between this check and the write below
  // is a window we accept: only someone who can already write the person's `.harness/` could use it, and the rename
  // still lands only a record file.
  if ((await fs.realpath(dir)) !== dir) throw new ReviewRefused("the review folder is a link", "outside");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, json, { flag: "wx" });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * One writer at a time per document (§3): the agent's tools and the person's actions. Keyed by the canonical path
 * (`canonicalDocumentPath`). Within one process only: the app and `humanharness run` on the same folder don't share it.
 */
export class ReviewLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(doc: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(doc) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(doc, tail);
    void tail.then(() => {
      if (this.tails.get(doc) === tail) this.tails.delete(doc);
    });
    return next;
  }
}

/** `humanharness run`'s line under a card (§10.6), read synchronously; null without a record or when anything fails. */
export function reviewSummarySync(base: string, doc: string): ReviewSummary | null {
  try {
    if (refusedShape(doc) || !isMarkdownPath(doc)) return null;
    const root = nodeFs.realpathSync.native(base);
    const asked = path.resolve(root, doc);
    // The canonical key, as `canonicalDocumentPath` gives it: only the case may differ from the real path.
    const docFile = nodeFs.realpathSync.native(asked);
    if (docFile.toLowerCase() !== asked.toLowerCase() || !docFile.startsWith(root + path.sep)) return null;
    const key = path.relative(root, docFile).split(path.sep).join("/");
    if (key.split("/")[0].toLowerCase() === ".harness") return null;
    const recordFile = path.join(root, ".harness", "reviews", ...`${key}.json`.split("/"));
    for (const [f, max] of [
      [recordFile, MAX_RECORD_BYTES],
      [docFile, MAX_REVIEW_DOCUMENT_BYTES],
    ] as const) {
      const st = nodeFs.lstatSync(f, { throwIfNoEntry: false });
      if (!st || !st.isFile() || st.size > max) return null;
    }
    const parsed = reviewSchema.safeParse(JSON.parse(nodeFs.readFileSync(recordFile, "utf8")));
    // The record is untrusted: one that names another document is broken.
    if (!parsed.success || parsed.data.path !== key) return null;
    return summarizeReview(parsed.data as Review, blobId(nodeFs.readFileSync(docFile)));
  } catch {
    return null;
  }
}
