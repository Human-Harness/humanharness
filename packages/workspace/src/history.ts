import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";

const AUTHOR = { name: "Human Harness", email: "history@humanharness.local" };

export interface HistoryEntry {
  sha: string;
  message: string;
  date: Date;
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
  ) {}

  private repo() {
    return { fs, dir: this.folder, gitdir: this.gitdir };
  }

  private tracked = (file: string): boolean =>
    !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)) && !file.endsWith(".DS_Store");

  async init(): Promise<void> {
    await fs.promises.mkdir(this.gitdir, { recursive: true });
    if (!fs.existsSync(path.join(this.gitdir, "HEAD"))) {
      await git.init({ ...this.repo(), defaultBranch: "main" });
    }
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
    const { blob } = await git.readBlob({ ...this.repo(), oid: head, filepath: file });
    const current = await fs.promises.readFile(path.join(this.folder, file));
    return !Buffer.from(blob).equals(current);
  }

  /** Commits the current state. Returns the new sha, or null when nothing changed. */
  async save(message: string): Promise<string | null> {
    const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    let changed = false;
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      changed = true;
      if (workdir === 0) await git.remove({ ...this.repo(), filepath: file });
      else await git.add({ ...this.repo(), filepath: file });
    }
    if (!changed && (await this.last()) !== null) return null;
    return git.commit({ ...this.repo(), message, author: AUTHOR });
  }

  /** Makes the folder look exactly like `sha` (tracked files only) and records that as a new commit. */
  async restore(sha: string, message: string): Promise<string | null> {
    const target = new Set(await git.listFiles({ ...this.repo(), ref: sha }));
    const current = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    for (const [file] of current) {
      if (!target.has(file)) await fs.promises.rm(path.join(this.folder, file), { force: true });
    }
    for (const file of target) {
      const { blob } = await git.readBlob({ ...this.repo(), oid: sha, filepath: file });
      const absolute = path.join(this.folder, file);
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, blob);
    }
    return this.save(message);
  }

  async list(depth = 50): Promise<HistoryEntry[]> {
    if ((await this.last()) === null) return [];
    const log = await git.log({ ...this.repo(), depth });
    return log.map((e) => ({
      sha: e.oid,
      message: e.commit.message.trim(),
      date: new Date(e.commit.author.timestamp * 1000),
    }));
  }
}
