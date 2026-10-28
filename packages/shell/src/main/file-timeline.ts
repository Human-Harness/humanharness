import path from "node:path";
import { isMarkdownPath, refusedShape } from "@humanharness/harness-sdk/documents";
import type { FileDiffResult, FileRefusal, FileRestoreAnswer, FileRestorePromptResult, FileTimelineResult, TimelineEntry } from "@humanharness/ui/client";
import { type DiffSide, FILE_RESTORE_PREFIX, type History, MAX_DIFF_BYTES, canonicalDocumentPath, readPrefix } from "@humanharness/workspace";
import { type DiffRunner, inProcessDiff } from "./diff-runner";
import { locate } from "./documents";
import { isSha } from "./history-view";
import { stillSafe } from "./open-path";

export interface FileTimelineDeps {
  /** The person's folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  /** The history of that folder; null while it moves or before setup. */
  history(): Promise<History | null>;
  /** The label of a task's action; null: a free question. */
  actionLabel(id: string | null): string;
  /** A document's approvals from its review record, oldest first; [] without one. */
  approvals(base: string, doc: string): Promise<{ blob: string; at: string; reason?: string }[]>;
  /** A turn or a task operation runs, turns are held, or the app quits: a go-back waits. */
  busy(): boolean;
  /** Runs a go-back through the restore guard (`restoreWith`): one at a time, turns held meanwhile. */
  restore(run: (history: History) => Promise<unknown>): Promise<void>;
  /** A go-back went through (the settings may have changed). */
  restored(): void;
  /** Where a diff is computed. The app passes `workerDiff` (off Electron main); default: here, with a small budget. */
  diff?: DiffRunner;
}

type Resolved = { ok: true; base: string; path: string; history: History } | { ok: false; reason: FileRefusal };
type Refusal = { ok: false; reason: FileRefusal };
/** A diff side and git's blob id of its whole content (null: absent, or unknown). */
type Side = { side: DiffSide; oid: string | null };

const no = (reason: FileRefusal): Refusal => ({ ok: false, reason });

/**
 * What a side reads: the cap plus a few bytes, so `diffFile`'s cut can back up to a whole UTF-8 character. A bigger
 * file is never held whole (§4.2 "Large files").
 */
const READ_BYTES = MAX_DIFF_BYTES + 4;
/** Timelines kept per history; the oldest read goes first. */
const MAX_CACHED_TIMELINES = 32;

/**
 * A file's timeline, its diffs and going back one file (file-timeline spec §3–§5). Every answer is data. Paths are
 * the person's folder's only, checked here; reading the current file never follows a link out of it. A commit id a
 * call names must be the `from` or `to` of an entry on that path's timeline before the history reads it.
 */
export class FileTimelineService {
  private readonly runDiff: DiffRunner;
  constructor(private readonly d: FileTimelineDeps) {
    this.runDiff = d.diff ?? inProcessDiff();
  }

  /** Per history and path: the timeline, keyed on the path's newest commit (building one walks up to 1,000 commits). */
  private readonly cache = new WeakMap<History, Map<string, { last: string; entries: TimelineEntry[] }>>();

  /** `rel` as the history names it: plain, relative, inside the folder, tracked. Its shape is checked before anything else. */
  private async resolve(rel: unknown): Promise<Resolved> {
    if (refusedShape(rel)) return no("outside");
    const base = await this.d.base();
    const history = base ? await this.d.history() : null;
    if (!base || !history) return no("not-ready");
    let p = path.posix.normalize(rel as string);
    while (p.startsWith("./")) p = p.slice(2);
    if (p === "." || p === "" || p.endsWith("/")) return no("bad-input");
    if (isMarkdownPath(p)) {
      const canonical = await canonicalDocumentPath(base, p);
      if (canonical === null) return no("outside");
      p = canonical;
    }
    if (!history.tracks(p)) return no("untracked");
    return { ok: true, base, path: p, history };
  }

  /** Runs `fn`, answering "failed" for a throw (a bug or a broken history): nothing leaves as an error. */
  private async guarded<T>(what: string, fn: () => Promise<T>): Promise<T | Refusal> {
    try {
      return await fn();
    } catch (err) {
      console.error(`Could not ${what}`, err);
      return no("failed");
    }
  }

  /** `file`'s timeline, from the cache while the path's newest commit is the same. A fresh copy each time. */
  private async entries(history: History, file: string): Promise<TimelineEntry[]> {
    let byPath = this.cache.get(history);
    if (!byPath) this.cache.set(history, (byPath = new Map()));
    const commits = await history.fileCommits(file);
    const last = commits.at(-1);
    if (last === undefined) return [];
    let hit = byPath.get(file);
    if (hit?.last === last) {
      // Read again: it moves to the end of the eviction order.
      byPath.delete(file);
    } else {
      hit = { last, entries: await history.fileTimeline(file, (id) => this.d.actionLabel(id)) };
      if (byPath.size >= MAX_CACHED_TIMELINES) byPath.delete(byPath.keys().next().value!);
    }
    byPath.set(file, hit);
    return structuredClone(hit.entries);
  }

  timeline(rel: unknown): Promise<FileTimelineResult> {
    return this.guarded("read the file's timeline", async () => {
      const r = await this.resolve(rel);
      if (!r.ok) return r;
      const entries = await this.entries(r.history, r.path);
      if (isMarkdownPath(r.path)) await this.markReasons(r.base, r.path, entries);
      return { ok: true as const, entries };
    });
  }

  /** An approval made with a reason (§3.1 "con motivo"): paired with the record's approvals, newest first. */
  private async markReasons(base: string, doc: string, entries: TimelineEntry[]): Promise<void> {
    const record = [...(await this.d.approvals(base, doc).catch(() => []))].reverse();
    let k = 0;
    for (const e of entries) {
      if (e.kind !== "approval") continue;
      if (record[k]?.reason) e.reason = true;
      k++;
    }
  }

  /**
   * What changed from `from` (a commit, null: nothing) to `to` (a commit, or "current": the file in the folder now).
   * Each commit must be an entry's `from` or `to` on this path's timeline. `same` comes from the blob ids, never from
   * the cut bytes, so two big files that only differ past the cap are not "the same".
   */
  diff(rel: unknown, from: unknown, to: unknown): Promise<FileDiffResult> {
    return this.guarded("compute the diff", async () => {
      const r = await this.resolve(rel);
      if (!r.ok) return r;
      if ((from !== null && !isSha(from)) || (to !== "current" && !isSha(to))) return no("bad-input");
      const entries = await this.entries(r.history, r.path);
      const known = (sha: string) => entries.some((e) => e.from === sha || e.to === sha);
      if ((from !== null && !known(from)) || (to !== "current" && !known(to as string))) return no("not-found");
      const before = from === null ? absent : await this.sideAt(r.history, from, r.path);
      const after = to === "current" ? await this.current(r.base, r.path, before) : await this.sideAt(r.history, to as string, r.path);
      if (after === "outside") return no("outside");
      const view = await this.runDiff(r.path, before.side, after.side);
      if (!view) return no("failed");
      return { ...view, same: sameContent(before, after) };
    });
  }

  private async sideAt(history: History, sha: string, file: string): Promise<Side> {
    const got = await history.readBytesAt(sha, file, READ_BYTES);
    return got ? { side: { kind: "bytes", bytes: got.bytes, size: got.size }, oid: got.oid } : absent;
  }

  /**
   * The file in the folder now: absent when it isn't there; "outside" when it leads out (a link). Its blob id is
   * hashed only when it could equal `other` (the same size): a big file is otherwise read no further than the cap.
   */
  private async current(base: string, file: string, other: Side): Promise<Side | "outside"> {
    const at = await locate(file, [base]);
    if (!at.ok) return at.reason === "missing" ? absent : "outside";
    const otherSize = other.side.kind === "bytes" ? other.side.size : -1;
    const got = await readPrefix(at.file, READ_BYTES, () => stillSafe(at.file, [base]), (size) => size === otherSize);
    return got ? { side: { kind: "bytes", bytes: got.bytes, size: got.size }, oid: got.oid ?? null } : "outside";
  }

  /** The entry whose version `commit` is, for the confirmation; refused when a go-back can't run now. */
  restorePrompt(rel: unknown, commit: unknown): Promise<FileRestorePromptResult> {
    return this.guarded("prepare the go-back", async () => {
      const r = await this.resolve(rel);
      if (!r.ok) return r;
      const found = await this.entryFor(r, commit);
      if (!("kind" in found)) return found;
      // With one task at a time, any running turn blocks it (Conflicts 1): the one place a per-file check would go.
      if (this.d.busy()) return no("busy");
      const prompt = { path: r.path, author: found.author, at: found.at, kind: found.kind, ...(found.version ? { version: found.version } : {}) };
      return { ok: true as const, prompt };
    });
  }

  /** The entry whose `to` is `commit`; a "deleted" entry is refused (there is no file to go back to). */
  private async entryFor(r: Extract<Resolved, { ok: true }>, commit: unknown): Promise<TimelineEntry | Refusal> {
    if (!isSha(commit)) return no("bad-input");
    const entry = (await this.entries(r.history, r.path)).find((e) => e.to === commit);
    if (!entry) return no("not-found");
    if (entry.deleted) return no("deleted");
    return entry;
  }

  /** "Go back to this version" (§5), after the core's confirmation: one file, its own untagged commit. */
  restore(rel: unknown, commit: unknown): Promise<FileRestoreAnswer> {
    return this.guarded("bring the file back", async () => {
      const r = await this.resolve(rel);
      if (!r.ok) return r;
      const found = await this.entryFor(r, commit);
      if (!("kind" in found)) return found;
      if (this.d.busy()) return no("busy");
      const target = found.kind === "approval" ? `v${found.version}` : `the version of ${found.at}`;
      let skipped: string[] = [];
      try {
        await this.d.restore(async (h) => {
          skipped = (await h.restoreFile(r.path, found.to, `${FILE_RESTORE_PREFIX}${r.path} to ${target}`)).skipped;
        });
      } catch (err) {
        console.error("Could not bring the file back", err);
        return no(this.d.busy() ? "busy" : "failed");
      }
      if (skipped.length > 0) return no("unsafe");
      this.d.restored();
      return { ok: true as const };
    });
  }
}

const absent: Side = { side: { kind: "absent" }, oid: null };

/** Both absent, or both there with the same size and the same blob id (an unknown id is never the same). */
function sameContent(a: Side, b: Side): boolean {
  if (a.side.kind === "absent" || b.side.kind === "absent") return a.side.kind === b.side.kind;
  return a.side.size === b.side.size && a.oid !== null && a.oid === b.oid;
}
