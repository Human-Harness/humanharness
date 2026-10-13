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

/** A commit message's subject and its trailers (null when absent or not a valid id). */
export function parseCommitMessage(raw: string): { subject: string; task: string | null; action: string | null } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const trailers = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
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

  async list(depth = 50): Promise<HistoryEntry[]> {
    if ((await this.last()) === null) return [];
    const log = await git.log({ ...this.repo(), depth });
    return log.map((e) => {
      const { subject, task, action } = parseCommitMessage(e.commit.message);
      return { sha: e.oid, message: subject, date: new Date(e.commit.author.timestamp * 1000), task, action };
    });
  }
}
