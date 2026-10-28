import { createHash, randomUUID } from "node:crypto";
import nodeFs, { constants, promises as fs } from "node:fs";
import path from "node:path";
import { type Review, type ReviewSummary, isMarkdownPath, refusedShape, reviewSchema, summarizeReview } from "@humanharness/harness-sdk";

/** Over this a document is not reviewed (the reader's own limit). */
export const MAX_REVIEW_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Over this a record is "broken". */
const MAX_RECORD_BYTES = 5 * 1024 * 1024;

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
export type OwnDocument = { ok: true; file: string; text: string; bytes: Buffer } | { ok: false; reason: OwnReason };

/** git's blob id of `bytes`: what the history stores for that content, so an approval names a version (D4). */
export function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * `rel` as a document of the person's folder a review may touch: a plain relative `.md` path, not under `.harness/`,
 * whose real path is exactly the path asked (a link anywhere on the way is refused, so a write never lands outside).
 */
async function ownPath(base: string, rel: unknown): Promise<{ ok: true; file: string } | { ok: false; reason: OwnReason }> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  const r = rel as string;
  if (!isMarkdownPath(r)) return { ok: false, reason: "not-markdown" };
  const root = await fs.realpath(base);
  const file = path.resolve(root, r);
  if (!file.startsWith(root + path.sep)) return { ok: false, reason: "outside" };
  // Checked on the resolved path (so `a/../.harness/x.md` is caught) and in any case (a case-insensitive disk).
  if (path.relative(root, file).split(path.sep)[0].toLowerCase() === ".harness") return { ok: false, reason: "outside" };
  const real = await fs.realpath(file).catch(() => null);
  if (real === null) return { ok: false, reason: "missing" };
  if (real !== file) return { ok: false, reason: "outside" };
  return { ok: true, file };
}

/** A document the review reads (§4 "inside the person's folder only"): never a reference folder, a link or a hard link. */
export async function readOwnDocument(base: string, rel: unknown): Promise<OwnDocument> {
  const at = await ownPath(base, rel);
  if (!at.ok) return at;
  const handle = await fs.open(at.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return { ok: false, reason: "missing" };
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink > 1) return { ok: false, reason: "outside" };
    if (st.size > MAX_REVIEW_DOCUMENT_BYTES) return { ok: false, reason: "too-large" };
    const bytes = await handle.readFile();
    return { ok: true, file: at.file, bytes, text: bytes.toString("utf8") };
  } finally {
    await handle.close();
  }
}

/**
 * Writes the document's new text (an answer's swap, §5.1), only when its bytes still equal `expected` (what the caller
 * read under the lock). Through a temp file in the same folder and a rename; the file keeps its mode.
 */
export async function writeOwnDocument(
  base: string,
  rel: string,
  expected: Uint8Array,
  next: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: OwnReason | "changed" }> {
  const now = await readOwnDocument(base, rel);
  if (!now.ok) return now;
  if (!Buffer.from(expected).equals(now.bytes)) return { ok: false, reason: "changed" };
  const bytes = Buffer.from(next, "utf8");
  const mode = (await fs.stat(now.file)).mode & 0o777;
  const tmp = path.join(path.dirname(now.file), `.${path.basename(now.file)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, bytes, { flag: "wx", mode });
  try {
    await fs.rename(tmp, now.file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { ok: true, bytes };
}

const broken = (doc: string) => new ReviewRefused(`the review of ${path.posix.basename(doc)} can't be read`, "broken");

/** The record's file, `<real base>/.harness/reviews/<doc>.json`, and the reviews folder. */
async function recordPath(base: string, doc: string): Promise<{ file: string; top: string }> {
  if (refusedShape(doc)) throw new ReviewRefused(`${doc} is outside your folder`, "outside");
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
  let raw: string;
  try {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > MAX_RECORD_BYTES) throw broken(doc);
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err instanceof ReviewRefused ? err : broken(doc);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw broken(doc);
  }
  const r = reviewSchema.safeParse(parsed);
  if (!r.success || r.data.path !== doc) throw broken(doc);
  return r.data as Review;
}

/** Writes the record atomically (a temp file the history skips, then a rename). Never through a linked folder. */
export async function saveReview(base: string, review: Review): Promise<void> {
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
  // A swap between the check and the write: caught here.
  if ((await fs.realpath(dir)) !== dir) throw new ReviewRefused("the review folder is a link", "outside");
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(review, null, 2)}\n`, { flag: "wx" });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** One writer at a time per document (§3): the agent's tools and the person's actions. */
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
    const root = nodeFs.realpathSync(base);
    const recordFile = path.join(root, ".harness", "reviews", ...`${doc}.json`.split("/"));
    const docFile = path.join(root, ...doc.split("/"));
    for (const [f, max] of [
      [recordFile, MAX_RECORD_BYTES],
      [docFile, MAX_REVIEW_DOCUMENT_BYTES],
    ] as const) {
      const st = nodeFs.lstatSync(f, { throwIfNoEntry: false });
      if (!st || !st.isFile() || st.size > max) return null;
    }
    const parsed = reviewSchema.safeParse(JSON.parse(nodeFs.readFileSync(recordFile, "utf8")));
    // The record is untrusted: one that names another document is broken.
    if (!parsed.success || parsed.data.path !== doc) return null;
    return summarizeReview(parsed.data as Review, blobId(nodeFs.readFileSync(docFile)));
  } catch {
    return null;
  }
}
