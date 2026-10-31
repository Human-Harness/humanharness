// One index build or reconcile (search spec §4.2, §4.3): run in a worker thread by the app, in-process by tests.
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CHATS_DIR,
  type ChatMeta,
  FOLDER_ROOT,
  type FileMeta,
  MAX_FILES,
  MAX_TEXT_BYTES,
  MAX_TOTAL_TEXT_BYTES,
  type SearchDoc,
  chatDocs,
  docIdFor,
  fileDoc,
  fileKey,
  isNotePath,
  overTextBudget,
  secretShaped,
  splitKey,
} from "@humanharness/search";
import { isBinary, readCapped } from "@humanharness/workspace";
import { readChatFrom, stillInside } from "./read";
import { type WalkEntry, statPaths, walkRoot } from "./walk";

export interface BuildRoot {
  /** `folder`, or `ref:<id>`. */
  key: string;
  path: string;
}
export interface BuildLimits {
  files: number;
  textBytes: number;
  totalText: number;
}
export interface BuildJob {
  /** The folder first, then the reference folders in manifest order (§4.5). */
  roots: BuildRoot[];
  scoped: boolean;
  /** `files.json` as main knows it: what isn't new or changed is not read again. */
  known: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  /** A commit's paths in the folder; absent: the whole reconcile. */
  only?: string[];
  extraDenied?: string[];
  limits?: BuildLimits;
}
export type BuildMessage =
  | { type: "names"; docs: SearchDoc[]; total: number; truncated: boolean }
  | { type: "docs"; docs: SearchDoc[]; done: number; total: number }
  | { type: "removed"; ids: string[] }
  /** `truncated` only from a whole reconcile (a commit's update doesn't know). */
  | { type: "done"; files: Record<string, FileMeta>; chats: Record<string, ChatMeta>; truncated?: boolean };

const BATCH = 200;

async function readOne(root: BuildRoot, realRoot: string | null, e: WalkEntry, scoped: boolean, overBudget: boolean, maxBytes: number): Promise<{ doc: SearchDoc | null; how: FileMeta["how"] }> {
  const base = { root: root.key, rel: e.rel, mtimeMs: e.mtimeMs, scoped };
  const nameOnly = (how: FileMeta["how"]) => ({ doc: fileDoc({ ...base, text: null }), how });
  if (e.link) return nameOnly("skipped:link");
  if (e.size > maxBytes) return nameOnly("name-only");
  if (overBudget) return nameOnly("skipped:total-cap");
  if (!realRoot) return { doc: null, how: "skipped:unsafe" };
  const file = path.join(root.path, e.rel);
  const got = await readCapped(file, maxBytes, () => stillInside(file, realRoot)).catch(() => null);
  if (!got) return { doc: null, how: "skipped:unsafe" };
  if (!("bytes" in got) || isBinary(e.rel, got.bytes)) return nameOnly("name-only");
  const text = got.bytes.toString("utf8");
  // Notes keep their text without the token-shaped lines (fileDoc); any other file goes name-only (§8.2).
  if (!isNotePath(root.key, e.rel) && secretShaped(text)) return nameOnly("skipped:secret-shaped");
  return { doc: fileDoc({ ...base, text }), how: "text" };
}

/** Chat files: `chats/<scope>.jsonl` and board mode's `chats/<scope>/<task>.jsonl`, never `archive/`. */
async function chatFiles(base: string): Promise<string[]> {
  const dir = path.join(base, CHATS_DIR);
  const out: string[] = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (d.isFile() && d.name.endsWith(".jsonl")) out.push(`${CHATS_DIR}${d.name}`);
    else if (d.isDirectory() && d.name !== "archive") {
      for (const f of await fs.readdir(path.join(dir, d.name), { withFileTypes: true }).catch(() => [])) {
        if (f.isFile() && f.name.endsWith(".jsonl")) out.push(`${CHATS_DIR}${d.name}/${f.name}`);
      }
    }
  }
  return out.sort();
}

async function indexChats(base: string, known: Record<string, ChatMeta>, post: (m: BuildMessage) => void, progress: { done: number; total: number }): Promise<Record<string, ChatMeta>> {
  const out: Record<string, ChatMeta> = {};
  const files = await chatFiles(base);
  const gone = Object.keys(known)
    .filter((f) => !files.includes(f))
    .flatMap((f) => known[f].ids);
  if (gone.length) post({ type: "removed", ids: gone });
  const realBase = await fs.realpath(base).catch(() => null);
  if (!realBase) return out;
  for (const rel of files) {
    const prev = known[rel];
    const read = await readChatFrom(path.join(base, rel), realBase, prev?.size ?? 0);
    if (read === null || read.reset) if (prev) post({ type: "removed", ids: prev.ids });
    if (read === null) continue;
    const docs = chatDocs(rel, read.lines);
    if (docs.length) post({ type: "docs", docs, ...progress });
    out[rel] = { size: read.end, ids: [...(read.reset ? [] : (prev?.ids ?? [])), ...docs.map((d) => d.id)] };
  }
  return out;
}

export async function build(job: BuildJob, post: (m: BuildMessage) => void): Promise<void> {
  const limits = job.limits ?? { files: MAX_FILES, textBytes: MAX_TEXT_BYTES, totalText: MAX_TOTAL_TEXT_BYTES };
  const files: Record<string, FileMeta> = { ...job.known };
  const seen: { root: BuildRoot; e: WalkEntry }[] = [];
  const removed: string[] = [];
  let truncated: boolean | undefined;
  const folder = job.roots[0];
  if (job.only) {
    const { entries, missing } = await statPaths(folder.path, job.only, { extraDenied: job.extraDenied ?? [] });
    for (const e of entries) seen.push({ root: folder, e });
    for (const rel of missing) {
      const key = fileKey(folder.key, rel);
      if (files[key]) removed.push(docIdFor(folder.key, rel));
      delete files[key];
    }
  } else {
    truncated = false;
    let left = limits.files;
    const keys = new Set<string>();
    for (const root of job.roots) {
      if (left <= 0) {
        truncated = true;
        break;
      }
      const isFolder = root.key === FOLDER_ROOT;
      const w = await walkRoot(root.path, { max: left, extraDenied: isFolder ? (job.extraDenied ?? []) : [], skipDirs: isFolder ? [CHATS_DIR.slice(0, -1)] : [] });
      truncated ||= w.truncated;
      left -= w.entries.length;
      for (const e of w.entries) {
        seen.push({ root, e });
        keys.add(fileKey(root.key, e.rel));
      }
    }
    for (const key of Object.keys(files)) {
      if (keys.has(key)) continue;
      const { root, rel } = splitKey(key);
      removed.push(docIdFor(root, rel));
      delete files[key];
    }
  }
  if (removed.length) post({ type: "removed", ids: removed });

  const changed = seen.filter(({ root, e }) => {
    const k = files[fileKey(root.key, e.rel)];
    return !k || k.size !== e.size || k.mtimeMs !== e.mtimeMs;
  });
  const changedKeys = new Set(changed.map(({ root, e }) => fileKey(root.key, e.rel)));
  // A first build shows names within about a second (D8); a reconcile goes straight to texts.
  if (Object.keys(job.known).length === 0 && !job.only && changed.length > 0) {
    post({ type: "names", docs: changed.map(({ root, e }) => fileDoc({ root: root.key, rel: e.rel, mtimeMs: e.mtimeMs, text: null, scoped: job.scoped })), total: changed.length, truncated: truncated === true });
  }
  // The total text cap (§4.5): what is already indexed as text stays; the largest new candidates go name-only first.
  const kept = Object.entries(files)
    .filter(([key, m]) => m.how === "text" && !changedKeys.has(key))
    .reduce((sum, [, m]) => sum + m.size, 0);
  const candidates = changed.filter(({ e }) => !e.link && e.size <= limits.textBytes).map(({ root, e }) => ({ key: fileKey(root.key, e.rel), size: e.size }));
  const over = overTextBudget(candidates, Math.max(0, limits.totalText - kept));

  const realRoots = new Map<string, string | null>();
  for (const root of job.roots) realRoots.set(root.key, await fs.realpath(root.path).catch(() => null));
  let done = 0;
  let batch: SearchDoc[] = [];
  const unsafe: string[] = [];
  const flush = () => {
    if (batch.length) post({ type: "docs", docs: batch, done, total: changed.length });
    batch = [];
  };
  for (const { root, e } of changed) {
    const key = fileKey(root.key, e.rel);
    const { doc, how } = await readOne(root, realRoots.get(root.key) ?? null, e, job.scoped, over.has(key), limits.textBytes);
    done++;
    if (doc) {
      batch.push(doc);
      files[key] = { size: e.size, mtimeMs: e.mtimeMs, how };
    } else {
      unsafe.push(docIdFor(root.key, e.rel));
      delete files[key];
    }
    if (batch.length >= BATCH) flush();
  }
  flush();
  if (unsafe.length) post({ type: "removed", ids: unsafe });

  const chats = job.only ? { ...job.chats } : await indexChats(folder.path, job.chats, post, { done, total: changed.length });
  post({ type: "done", files, chats, ...(truncated === undefined ? {} : { truncated }) });
}
