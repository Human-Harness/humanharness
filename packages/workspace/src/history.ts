import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { NOTES_PREFIX } from "./notes";

const AUTHOR = { name: "Human Harness", email: "history@humanharness.local" };

/** The temp file `writeNote` renames into place (`.harness/notes/<slug>.md.<uuid>.tmp`); the person's own `.tmp` files stay tracked. */
const isNoteTempFile = (file: string): boolean =>
  file.startsWith(NOTES_PREFIX) && /\.md\.[0-9a-f-]+\.tmp$/.test(file.slice(NOTES_PREFIX.length));

export interface HistoryEntry {
  sha: string;
  /** The commit's subject (its first line). */
  message: string;
  date: Date;
  /** The task the commit belongs to (its `Task:` trailer); null outside any task. */
  task: string | null;
  /** The task's manifest action (its `Action:` trailer); null for a free question or outside any task. */
  action: string | null;
}

/** The task a history commit belongs to, written as git trailers under its subject. */
export interface HistoryTrailer {
  task: string;
  action?: string;
}

/** A file a task added, changed or deleted (tracked files only). */
export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** The history commits of one task, as the History panel shows them. */
export interface HistoryTask {
  /** Null: the "Other changes" group (commits outside any task). */
  taskId: string | null;
  actionId: string | null;
  /**
   * Where "Go back to before this task" lands: the task's first "Before message" snapshot when its first
   * commit is one (so the person's own edits made before the task stay), else the commit before the task's
   * first commit; null when the group starts at the very first commit.
   */
  start: string | null;
  /** The group's newest commit. */
  end: string;
  /** The date of `end`. */
  date: Date;
  /** Tasks: the tree diff from `start` to `end`. Other changes: the union of its commits' own changes. */
  changes: FileChange[];
  /** Newest first. */
  entries: HistoryEntry[];
}

const byPath = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The subject of the snapshot the runtime saves before each turn: the person's edits, not the AI's. */
const BEFORE_MESSAGE = "Before message";

/** How far back `tasks` follows a task past the depth to find its first commit. */
const MAX_WALK_BACK = 1000;

/** Ids a trailer may carry (task UUIDs, manifest action ids): no spaces or line breaks. */
const TRAILER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** `message` folded to one line, plus `Task:` and `Action:` trailers when `trailer` holds valid ids. */
export function withTrailer(message: string, trailer?: HistoryTrailer): string {
  const subject = message.replace(/\s*\n\s*/g, " ").trim();
  if (!trailer || !TRAILER_ID.test(trailer.task)) return subject;
  const lines = [`Task: ${trailer.task}`];
  if (trailer.action !== undefined && TRAILER_ID.test(trailer.action)) lines.push(`Action: ${trailer.action}`);
  return `${subject}\n\n${lines.join("\n")}`;
}

/** A trailer line as `withTrailer` writes it. */
const TRAILER_LINE = /^(Task|Action): \S+$/;

/** A commit message's subject and its trailers (null when absent or not a valid id). Only a last paragraph made entirely of trailer lines counts. */
export function parseCommitMessage(raw: string): { subject: string; task: string | null; action: string | null } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const trailers = last.split("\n").every((line) => TRAILER_LINE.test(line)) ? last : "";
  const value = (key: string): string | null => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(trailers);
    return m && TRAILER_ID.test(m[1]) ? m[1] : null;
  };
  return { subject: text.split("\n")[0], task: value("Task"), action: value("Action") };
}

/**
 * Local, invisible version history of the user folder. The git data lives in `gitdir`
 * (outside the folder) so the user never sees it and cloud sync never touches it.
 */
export class History {
  constructor(
    private readonly folder: string,
    private readonly gitdir: string,
    private readonly ignore: string[] = [".harness/"],
    /** Prefixes tracked even inside an ignored one (the notes under `.harness/`). */
    private readonly keep: string[] = [],
  ) {}

  private headTime = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** Runs `fn` after every previously queued operation has settled. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async refreshHeadTime(): Promise<void> {
    const head = await this.last();
    if (head === null) {
      this.headTime = 0;
      return;
    }
    const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: head });
    this.headTime = commit.committer.timestamp;
  }

  private repo() {
    return { fs, dir: this.folder, gitdir: this.gitdir };
  }

  private tracked = (file: string): boolean =>
    !file.endsWith(".DS_Store") &&
    !isNoteTempFile(file) &&
    (this.keep.some((k) => file.startsWith(k)) || !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)));

  async init(): Promise<void> {
    await fs.promises.mkdir(this.gitdir, { recursive: true });
    if (!fs.existsSync(path.join(this.gitdir, "HEAD"))) {
      await git.init({ ...this.repo(), defaultBranch: "main" });
    }
    await this.refreshHeadTime();
  }

  async last(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, gitdir: this.gitdir, ref: "HEAD" });
    } catch {
      return null;
    }
  }

  /**
   * statusMatrix trusts its stat cache (size + mtime), so a same-size rewrite within the same
   * timestamp tick looks unchanged. Compare the actual bytes against HEAD to be sure.
   */
  private async differsFromHead(file: string): Promise<boolean> {
    const head = await this.last();
    if (head === null) return true;
    const { mtimeMs } = await fs.promises.stat(path.join(this.folder, file));
    // Only files modified around the HEAD commit time can be "racily clean".
    if (Math.floor(mtimeMs / 1000) < this.headTime - 1) return false;
    const { blob } = await git.readBlob({ ...this.repo(), oid: head, filepath: file });
    const current = await fs.promises.readFile(path.join(this.folder, file));
    return !Buffer.from(blob).equals(current);
  }

  /** Commits the current state; `trailer` names the task it belongs to. Returns the new sha, or null when nothing changed. */
  save(message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.saveNow(withTrailer(message, trailer)));
  }

  private async saveNow(message: string): Promise<string | null> {
    const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    let changed = false;
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      changed = true;
      if (workdir === 0) await git.remove({ ...this.repo(), filepath: file });
      else await git.add({ ...this.repo(), filepath: file });
    }
    if (!changed && (await this.last()) !== null) return null;
    const sha = await git.commit({ ...this.repo(), message, author: AUTHOR });
    await this.refreshHeadTime();
    return sha;
  }

  /** Makes the folder look exactly like `sha` (tracked files only) and records that as a new commit, tagged with `trailer`. */
  restore(sha: string, message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.restoreNow(sha, withTrailer(message, trailer)));
  }

  private async restoreNow(sha: string, message: string): Promise<string | null> {
    const target = new Set((await git.listFiles({ ...this.repo(), ref: sha })).filter(this.tracked));
    const current = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    for (const [file] of current) {
      if (target.has(file)) continue;
      await fs.promises.rm(path.join(this.folder, file), { force: true });
      await this.pruneEmptyParents(path.dirname(file));
    }
    for (const file of target) {
      const { blob } = await git.readBlob({ ...this.repo(), oid: sha, filepath: file });
      const absolute = path.join(this.folder, file);
      const existing = await fs.promises.readFile(absolute).catch(() => null);
      if (existing !== null && Buffer.from(blob).equals(existing)) continue;
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, blob);
    }
    return this.saveNow(message);
  }

  /** Removes `rel` and its ancestors while they are empty. Never removes the folder root. */
  private async pruneEmptyParents(rel: string): Promise<void> {
    let dir = rel;
    while (dir !== "." && dir !== "" && dir !== path.sep) {
      try {
        await fs.promises.rmdir(path.join(this.folder, dir));
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  }

  list(depth = 50): Promise<HistoryEntry[]> {
    return this.listWith(depth, {});
  }

  private async listWith(depth: number, cache: object): Promise<HistoryEntry[]> {
    if ((await this.last()) === null) return [];
    const log = await git.log({ ...this.repo(), depth, cache });
    return log.map((e) => {
      const { subject, task, action } = parseCommitMessage(e.commit.message);
      return { sha: e.oid, message: subject, date: new Date(e.commit.author.timestamp * 1000), task, action };
    });
  }

  /**
   * The commits of the last `depth`, grouped by task id, newest task first; the "Other changes" group always last.
   * A task's commits need not be contiguous: its changes run from its `start` to its last commit, so they
   * include whatever happened in between (untagged commits too). A task cut by `depth` is followed back
   * past it to find its true first commit.
   */
  async tasks(depth = 200): Promise<HistoryTask[]> {
    const cache = {};
    const groups = new Map<string | null, HistoryEntry[]>();
    for (const e of await this.listWith(depth, cache)) {
      const list = groups.get(e.task);
      if (list) list.push(e);
      else groups.set(e.task, [e]);
    }
    // A Map keeps the order of first insertion: each group's newest commit, newest first.
    const out: HistoryTask[] = [];
    for (const [taskId, entries] of groups) {
      const oldest = entries[entries.length - 1].sha;
      const start = taskId === null ? await this.parentOf(oldest, cache) : await this.taskStart(taskId, oldest, cache);
      const end = entries[0];
      out.push({
        taskId,
        actionId: entries.find((e) => e.action !== null)?.action ?? null,
        start,
        end: end.sha,
        date: end.date,
        changes: taskId === null ? await this.unionOfChanges(entries, cache) : await this.diff(start, end.sha, cache),
        entries,
      });
    }
    return [...out.filter((g) => g.taskId !== null), ...out.filter((g) => g.taskId === null)];
  }

  /** The files the history tracks in the folder now (relative, forward slashes). */
  trackedFiles(): Promise<string[]> {
    return this.serialize(async () => {
      const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
      return matrix.filter(([, , workdir]) => workdir !== 0).map(([file]) => file);
    });
  }

  private async parentOf(sha: string, cache: object = {}): Promise<string | null> {
    const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: sha, cache });
    return commit.parent[0] ?? null;
  }

  /**
   * Follows `taskId` back from `oldest` (its oldest listed commit) while the parent carries the same task,
   * then returns that first commit when it is a "Before message" snapshot, else its parent.
   */
  private async taskStart(taskId: string, oldest: string, cache: object): Promise<string | null> {
    let first = oldest;
    let { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: first, cache });
    for (let step = 0; step < MAX_WALK_BACK && commit.parent[0]; step++) {
      const parent = await git.readCommit({ fs, gitdir: this.gitdir, oid: commit.parent[0], cache });
      if (parseCommitMessage(parent.commit.message).task !== taskId) break;
      first = parent.oid;
      commit = parent.commit;
    }
    if (parseCommitMessage(commit.message).subject === BEFORE_MESSAGE) return first;
    return commit.parent[0] ?? null;
  }

  /** A folder the history never tracks anything in: ignored, and no `keep` prefix lies inside it. */
  private skipsFolder(dir: string): boolean {
    const prefix = `${dir}/`;
    return (
      this.ignore.some((i) => i.endsWith("/") && prefix.startsWith(i)) &&
      !this.keep.some((k) => k.startsWith(prefix) || prefix.startsWith(k))
    );
  }

  /** Tracked files that differ between two commits; with no `from`, every file of `to` is added. */
  private async diff(from: string | null, to: string, cache: object = {}): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const trees = from === null ? [git.TREE({ ref: to })] : [git.TREE({ ref: from }), git.TREE({ ref: to })];
    await git.walk({
      fs,
      gitdir: this.gitdir,
      trees,
      cache,
      // Returning undefined walks into a folder; null skips it.
      map: async (filepath, entries) => {
        if (filepath === ".") return undefined;
        const [a, b] = from === null ? [null, entries[0]] : entries;
        const [ta, tb] = await Promise.all([a?.type(), b?.type()]);
        const [oa, ob] = await Promise.all([a?.oid(), b?.oid()]);
        if (ta === "tree" || tb === "tree") {
          if (oa === ob || this.skipsFolder(filepath)) return null;
          // A file replaced by a folder (or the reverse): the file side is deleted or added.
          if (ta === "blob" && this.tracked(filepath)) changes.push({ path: filepath, kind: "deleted" });
          if (tb === "blob" && this.tracked(filepath)) changes.push({ path: filepath, kind: "added" });
          return undefined;
        }
        if (!this.tracked(filepath) || oa === ob) return undefined;
        changes.push({ path: filepath, kind: !a ? "added" : !b ? "deleted" : "modified" });
        return undefined;
      },
    });
    return changes.sort(byPath);
  }

  /** Each commit's own changes, merged: the newest kind of each file wins. */
  private async unionOfChanges(entries: HistoryEntry[], cache: object): Promise<FileChange[]> {
    const seen = new Map<string, FileChange>();
    for (const e of entries) {
      for (const c of await this.diff(await this.parentOf(e.sha, cache), e.sha, cache)) if (!seen.has(c.path)) seen.set(c.path, c);
    }
    return [...seen.values()].sort(byPath);
  }
}
