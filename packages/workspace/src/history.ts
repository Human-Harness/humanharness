import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { PLUGIN_ID } from "@humanharness/harness-sdk";
import { DATA_PREFIX, MATERIAL_KEEP, NOTES_PREFIX, isScopeDir } from "./layout";
import { BEFORE_MESSAGE } from "./subjects";

/**
 * A path the history tracks inside an ignored folder: a prefix (the notes, the data), or the files `match` names at
 * most `depth` folders below `prefix` (material spec §4: `MATERIAL_KEEP`).
 */
export type HistoryKeep = string | { readonly prefix: string; readonly match: RegExp; readonly depth: number };

/**
 * What the app's history keeps under `.harness/`: the notes and the data; with material, its registry and decisions
 * (`MATERIAL_KEEP`). The one rule for the shell's history and the runtime's, so both agree (D0 without material).
 */
export const appHistoryKeep = (material: boolean): HistoryKeep[] => [NOTES_PREFIX, DATA_PREFIX, ...(material ? [MATERIAL_KEEP] : [])];

const keeps = (k: HistoryKeep, file: string): boolean => (typeof k === "string" ? file.startsWith(k) : k.match.test(file));

const AUTHOR = { name: "Human Harness", email: "history@humanharness.local" };

/**
 * The temp files `writeNote` and the data store rename into place (`<file>.md.<uuid>.tmp`, `<file>.json.<uuid>.tmp`);
 * the person's own `.tmp` files stay tracked.
 */
const isAppTempFile = (file: string): boolean =>
  (file.startsWith(NOTES_PREFIX) && /\.md\.[0-9a-f-]+\.tmp$/.test(file.slice(NOTES_PREFIX.length))) ||
  (file.startsWith(DATA_PREFIX) && /\.json\.[0-9a-f-]+\.tmp$/.test(file.slice(DATA_PREFIX.length)));

export interface HistoryEntry {
  sha: string;
  /** The commit's subject (its first line). */
  message: string;
  date: Date;
  /** The task the commit belongs to (its `Task:` trailer); null outside any task. */
  task: string | null;
  /** The task's manifest action (its `Action:` trailer); null for a free question or outside any task. */
  action: string | null;
  /** The task's scope (its `Scope:` trailer), only for a harness with scopes. */
  scope?: string;
  /** The task's phase (its `Phase:` trailer), only for an action with phases. */
  phase?: string;
  /** The plugin whose prepared task this is (its `Plugin:` trailer), only for such tasks. */
  plugin?: string;
  /** The job this run is (its `Job:` trailer), only for job runs. */
  job?: string;
  /** The other running tasks this commit's paths are shared with (its `Shared:` trailers), only on a shared commit. */
  shared?: string[];
}

/** The task a history commit belongs to, written as git trailers under its subject. */
export interface HistoryTrailer {
  task: string;
  action?: string;
  /** The task's scope, `_app` included; only for a harness with scopes (spec §3.3). */
  scope?: string;
  /** The task's phase now (task-phases spec §6); only for an action with phases. */
  phase?: string;
  /** The plugin whose prepared task this is, plugins spec §5.3; only for such tasks. */
  plugin?: string;
  /** The job this run is (parallel spec §8); only for job runs. */
  job?: string;
  /** Other running tasks that may also have changed this commit's paths (spec §5.2); only on a shared commit. */
  shared?: string[];
}

/** The tracked paths that differ from HEAD, each with its working blob id (null: deleted). */
export type DirtyState = ReadonlyMap<string, string | null>;

/** A commit after a given point, with the paths it changed (`History.commitsSince`). */
export interface CommitSince {
  sha: string;
  task: string | null;
  paths: string[];
}

/** A file a task added, changed or deleted (tracked files only). */
export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** The history commits of one task, as the History panel shows them. */
export interface HistoryTask {
  /** Null: the "Outside a task" group (commits outside any task). */
  taskId: string | null;
  actionId: string | null;
  /** The scope the task ran in, when the harness has scopes. */
  scopeId?: string;
  /**
   * Where "Undo this task" lands: the task's first "Before message" snapshot when its first
   * commit is one (so the person's own edits made before the task stay), else the commit before the task's
   * first commit; null when the group starts at the very first commit.
   */
  start: string | null;
  /** The group's newest commit. */
  end: string;
  /** The date of `end`. */
  date: Date;
  /** Tasks: the tree diff from `start` to `end`. Outside a task: the union of its commits' own changes. */
  changes: FileChange[];
  /** Newest first. */
  entries: HistoryEntry[];
}

const byPath = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** git's mode for a symlink entry: its blob holds the link's target path. */
const LINK_MODE = 0o120000;

/** What a restore did: the new commit (null when nothing changed) and the paths it skipped because it couldn't write them safely. */
export interface RestoreResult {
  sha: string | null;
  skipped: string[];
}

/** True when `dir` (or its nearest existing ancestor) resolves inside `root`, the folder's real path. */
async function resolvesInside(root: string, dir: string): Promise<boolean> {
  let probe = dir;
  for (;;) {
    try {
      const real = await fs.promises.realpath(probe);
      return real === root || real.startsWith(root + path.sep);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/** Writes `data` to `file` as a regular file; with O_NOFOLLOW (where the OS has it) a link put there meanwhile makes it fail instead of writing through. */
async function writeNoFollow(file: string, data: Buffer, mode: number): Promise<void> {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;
  const handle = await fs.promises.open(file, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, mode);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/**
 * A path written exactly as git names it: relative, `/`-separated, no `.` or `..` segment, no trailing `/`, no `\\`.
 * Anything else could name a tracked file by another spelling (`./a.md`, `sub/../a.md`) and slip past `tracked`.
 */
const isCanonicalPath = (p: string): boolean =>
  p !== "" && !p.startsWith("/") && !p.includes("\\") && path.posix.normalize(p) === p && !p.endsWith("/") && !p.split("/").includes("..");

/** How far back `tasks` follows a task past the depth to find its first commit. */
const MAX_WALK_BACK = 1000;

/** Ids a trailer may carry (task UUIDs, manifest action ids): no spaces or line breaks. */
const TRAILER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** At most this many `Shared:` lines on one commit, written or read. */
const SHARED_MAX = 8;

/** `message` folded to one line, plus `Task:` and `Action:` trailers when `trailer` holds valid ids. */
export function withTrailer(message: string, trailer?: HistoryTrailer): string {
  const subject = message.replace(/\s*\n\s*/g, " ").trim();
  if (!trailer || !TRAILER_ID.test(trailer.task)) return subject;
  const lines = [`Task: ${trailer.task}`];
  if (trailer.action !== undefined && TRAILER_ID.test(trailer.action)) lines.push(`Action: ${trailer.action}`);
  // Checked on its own: `_app` is a scope folder, but not a valid TRAILER_ID.
  if (trailer.scope !== undefined && isScopeDir(trailer.scope)) lines.push(`Scope: ${trailer.scope}`);
  if (trailer.phase !== undefined && TRAILER_ID.test(trailer.phase)) lines.push(`Phase: ${trailer.phase}`);
  if (trailer.plugin !== undefined && PLUGIN_ID.test(trailer.plugin)) lines.push(`Plugin: ${trailer.plugin}`);
  if (trailer.job !== undefined && TRAILER_ID.test(trailer.job)) lines.push(`Job: ${trailer.job}`);
  for (const other of (trailer.shared ?? []).filter((t) => TRAILER_ID.test(t)).slice(0, SHARED_MAX)) lines.push(`Shared: ${other}`);
  return `${subject}\n\n${lines.join("\n")}`;
}

/** A trailer line as `withTrailer` writes it. */
const TRAILER_LINE = /^(Task|Action|Scope|Phase|Plugin|Job|Shared): \S+$/;

/**
 * A commit message's subject and its trailers (null when absent or not a valid id; `scope`, `phase`, `plugin`, `job` and
 * `shared` only when present). Only a last paragraph made entirely of trailer lines counts.
 */
export function parseCommitMessage(raw: string): {
  subject: string;
  task: string | null;
  action: string | null;
  scope?: string;
  phase?: string;
  plugin?: string;
  job?: string;
  shared?: string[];
} {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const trailers = last.split("\n").every((line) => TRAILER_LINE.test(line)) ? last : "";
  const value = (key: string): string | null => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(trailers);
    return m && TRAILER_ID.test(m[1]) ? m[1] : null;
  };
  const scope = /^Scope: (.+)$/m.exec(trailers)?.[1];
  const phase = value("Phase");
  const plugin = /^Plugin: (.+)$/m.exec(trailers)?.[1];
  const job = value("Job");
  const shared = [...trailers.matchAll(/^Shared: (.+)$/gm)].map((m) => m[1]).filter((t) => TRAILER_ID.test(t)).slice(0, SHARED_MAX);
  return {
    subject: text.split("\n")[0],
    task: value("Task"),
    action: value("Action"),
    ...(isScopeDir(scope) ? { scope } : {}),
    ...(phase ? { phase } : {}),
    ...(plugin !== undefined && PLUGIN_ID.test(plugin) ? { plugin } : {}),
    ...(job ? { job } : {}),
    ...(shared.length > 0 ? { shared } : {}),
  };
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
    /** Paths tracked even inside an ignored folder (the notes and the data under `.harness/`, the material's decisions). */
    private readonly keep: HistoryKeep[] = [],
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
    !isAppTempFile(file) &&
    (this.keep.some((k) => keeps(k, file)) || !this.ignore.some((i) => (i.endsWith("/") ? file.startsWith(i) : file === i)));

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
    const absolute = path.join(this.folder, file);
    const stats = await fs.promises.lstat(absolute);
    // Only files modified around the HEAD commit time can be "racily clean".
    if (Math.floor(stats.mtimeMs / 1000) < this.headTime - 1) return false;
    const { blob } = await git.readBlob({ ...this.repo(), oid: head, filepath: file });
    // A link is stored as its target path: compare that, never what it points to.
    const current = stats.isSymbolicLink()
      ? await fs.promises.readlink(absolute, { encoding: "buffer" })
      : await fs.promises.readFile(absolute);
    return !Buffer.from(blob).equals(current);
  }

  /** Commits the current state; `trailer` names the task it belongs to. Returns the new sha, or null when nothing changed. */
  save(message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.saveNow(withTrailer(message, trailer)));
  }

  private async saveNow(message: string, only?: ReadonlySet<string>): Promise<string | null> {
    const filter = only ? (file: string) => only.has(file) && this.tracked(file) : this.tracked;
    const matrix = await git.statusMatrix({ ...this.repo(), filter });
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
    return this.restoreReport(sha, message, trailer).then((r) => r.sha);
  }

  /** `restore`, plus the paths it skipped because it couldn't write them safely. */
  restoreReport(sha: string, message: string, trailer?: HistoryTrailer): Promise<RestoreResult> {
    return this.serialize(() => this.restoreNow(sha, withTrailer(message, trailer)));
  }

  /**
   * Restores never write through a symlink: a link in the folder is removed (never its target) and
   * a link entry of the restore point is recreated as a link. An entry it can't write safely (its
   * parent folder leads outside the folder, a folder sits where it goes, the link can't be made) is
   * logged and skipped; the rest of the restore goes on.
   */
  private async restoreNow(sha: string, message: string): Promise<RestoreResult> {
    const target = await this.entriesAt(sha);
    const current = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    const root = await fs.promises.realpath(this.folder);
    const inside = new Map<string, Promise<boolean>>();
    const staysInside = (dir: string): Promise<boolean> => {
      let known = inside.get(dir);
      if (!known) inside.set(dir, (known = resolvesInside(root, dir)));
      return known;
    };
    const skipped: string[] = [];
    const skip = (file: string, why: unknown) => {
      console.error(`Restore skipped ${file}`, why);
      skipped.push(file);
    };
    for (const [file] of current) {
      if (target.has(file)) continue;
      const absolute = path.join(this.folder, file);
      if (!(await staysInside(path.dirname(absolute)))) {
        skip(file, "its folder leads outside the folder");
        continue;
      }
      try {
        // rm never follows a link: it removes the link itself.
        await fs.promises.rm(absolute, { force: true });
      } catch (err) {
        skip(file, err);
        continue;
      }
      await this.pruneEmptyParents(path.dirname(file));
    }
    // Removing and pruning changed folders: check them afresh.
    inside.clear();
    for (const [file, entry] of target) await this.writeEntry(root, file, entry, staysInside, (dir) => inside.delete(dir), skip);
    return { sha: await this.saveNow(message), skipped };
  }

  /**
   * Writes one entry of a restore point (never through a link): a link entry as a link, a file with O_NOFOLLOW; its
   * parent's real path checked before and again right after `mkdir`. False when it was skipped.
   */
  private async writeEntry(
    root: string,
    file: string,
    { mode, oid }: { mode: number; oid: string },
    staysInside: (dir: string) => Promise<boolean>,
    forget: (dir: string) => void,
    skip: (file: string, why: unknown) => void,
  ): Promise<boolean> {
    const absolute = path.join(this.folder, file);
    const parent = path.dirname(absolute);
    if (!(await staysInside(parent))) {
      skip(file, "its folder leads outside the folder");
      return false;
    }
    try {
      const { blob } = await git.readBlob({ ...this.repo(), oid });
      const wanted = Buffer.from(blob);
      const existing = await fs.promises.lstat(absolute).catch(() => null);
      if (existing?.isDirectory()) {
        skip(file, "a folder is in its place");
        return false;
      }
      if (mode === LINK_MODE) {
        if (existing?.isSymbolicLink() && wanted.equals(await fs.promises.readlink(absolute, { encoding: "buffer" }))) return true;
      } else if (existing?.isFile() && wanted.equals(await fs.promises.readFile(absolute))) return true;
      // unlink removes a link itself, never its target.
      if (existing) await fs.promises.unlink(absolute);
      await fs.promises.mkdir(parent, { recursive: true });
      // mkdir follows links: check again, as close to the write as possible.
      if (!(await resolvesInside(root, parent))) {
        forget(parent);
        skip(file, "its folder leads outside the folder");
        return false;
      }
      if (mode === LINK_MODE) await fs.promises.symlink(wanted.toString(), absolute);
      else await writeNoFollow(absolute, wanted, mode & 0o111 ? 0o777 : 0o666);
      return true;
    } catch (err) {
      skip(file, err);
      return false;
    }
  }

  /**
   * Commits only `paths` (tracked ones) as they are in the folder now; every other path keeps HEAD's content (parallel
   * spec §5.2 step 4: a turn's partial commit). Null when none of them changed.
   */
  commitPaths(paths: readonly string[], message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.saveNow(withTrailer(message, trailer), new Set(paths)));
  }

  /**
   * Brings only `paths` back to how they were at `sha` (a path absent there is removed) and commits just them (spec
   * §5.3: a crashed turn's own paths, a task's undo). The same link checks as `restore`: never through a link, never
   * outside the folder. Only exact tracked names count (a path absent at `sha` is removed only when the folder has it
   * by that very name); others are ignored. The paths it couldn't write safely are skipped, reported and not committed.
   */
  restorePaths(paths: readonly string[], sha: string, message: string, trailer?: HistoryTrailer): Promise<RestoreResult> {
    return this.serialize(async () => {
      const wanted = new Set(paths.filter((p) => isCanonicalPath(p) && this.tracked(p)));
      const target = await this.entriesAt(sha);
      // The folder's own names: `A.md` never stands for `a.md` on a case-insensitive disk.
      const present = new Set(
        (await git.statusMatrix({ ...this.repo(), filter: (f) => wanted.has(f) && this.tracked(f) })).map(([f]) => f),
      );
      const root = await fs.promises.realpath(this.folder);
      const skipped: string[] = [];
      const skip = (file: string, why: unknown) => {
        console.error(`Restore skipped ${file}`, why);
        skipped.push(file);
      };
      for (const file of wanted) {
        const entry = target.get(file);
        if (entry) {
          if (!(await this.writeEntry(root, file, entry, (dir) => resolvesInside(root, dir), () => undefined, skip))) wanted.delete(file);
          continue;
        }
        const absolute = path.join(this.folder, file);
        if (!(await resolvesInside(root, path.dirname(absolute)))) {
          skip(file, "its folder leads outside the folder");
          wanted.delete(file);
          continue;
        }
        if (!present.has(file)) {
          wanted.delete(file);
          continue;
        }
        try {
          // rm never follows a link: it removes the link itself.
          await fs.promises.rm(absolute, { force: true });
        } catch (err) {
          skip(file, err);
          wanted.delete(file);
          continue;
        }
        await this.pruneEmptyParents(path.dirname(file));
      }
      return { sha: await this.saveNow(withTrailer(message, trailer), wanted), skipped };
    });
  }

  /** The folder's dirty tracked paths now (parallel spec Decision 2: a turn that starts while another runs). */
  dirtyState(): Promise<DirtyState> {
    return this.serialize(() => this.dirtyNow());
  }

  /**
   * The tracked paths whose content moved since `start` (null: every dirty path), sorted. A path committed by another
   * turn meanwhile is clean against HEAD and drops out, unless it changed again (spec §5.2 step 1).
   */
  changedSince(start: DirtyState | null): Promise<string[]> {
    return this.serialize(async () => {
      const now = await this.dirtyNow();
      return [...now]
        .filter(([file, oid]) => !start || !start.has(file) || start.get(file) !== oid)
        .map(([file]) => file)
        .sort();
    });
  }

  /** The dirty tracked paths against HEAD, by the same test `saveNow` stages with. */
  private async dirtyNow(): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      if (head === 0 && workdir === 0) continue;
      out.set(file, workdir === 0 ? null : await this.workOid(file));
    }
    return out;
  }

  /** The blob id of a file as it is in the folder (a link: of its target path, as git stores it). */
  private async workOid(file: string): Promise<string> {
    const absolute = path.join(this.folder, file);
    const stats = await fs.promises.lstat(absolute);
    const object = stats.isSymbolicLink()
      ? await fs.promises.readlink(absolute, { encoding: "buffer" })
      : await fs.promises.readFile(absolute);
    return (await git.hashBlob({ object })).oid;
  }

  /** The tracked files of `sha` with their mode and blob id. */
  private async entriesAt(sha: string): Promise<Map<string, { mode: number; oid: string }>> {
    const out = new Map<string, { mode: number; oid: string }>();
    await git.walk({
      fs,
      gitdir: this.gitdir,
      trees: [git.TREE({ ref: sha })],
      map: async (filepath, [entry]) => {
        if (filepath === "." || !entry) return undefined;
        if ((await entry.type()) !== "blob") return undefined;
        if (this.tracked(filepath)) out.set(filepath, { mode: await entry.mode(), oid: await entry.oid() });
        return undefined;
      },
    });
    return out;
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
      const { subject, task, action, scope, phase, plugin, job, shared } = parseCommitMessage(e.commit.message);
      return {
        sha: e.oid,
        message: subject,
        date: new Date(e.commit.author.timestamp * 1000),
        task,
        action,
        ...(scope ? { scope } : {}),
        ...(phase ? { phase } : {}),
        ...(plugin ? { plugin } : {}),
        ...(job ? { job } : {}),
        ...(shared ? { shared } : {}),
      };
    });
  }

  /**
   * The commits after `sha` (exclusive; null: every commit) within the last `depth`, newest first, each with its task
   * and the paths it changed (parallel spec §5.3 conflicts).
   */
  commitsSince(sha: string | null, depth = 200): Promise<CommitSince[]> {
    return this.serialize(async () => {
      const cache = {};
      const out: CommitSince[] = [];
      for (const e of await this.listWith(depth, cache)) {
        if (e.sha === sha) break;
        const changes = await this.diff(await this.parentOf(e.sha, cache), e.sha, cache);
        out.push({ sha: e.sha, task: e.task, paths: changes.map((c) => c.path) });
      }
      return out;
    });
  }

  /**
   * The commits of the last `depth`, grouped by task id, newest task first; the "Outside a task" group always last.
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
      const scopeId = entries.find((e) => e.scope !== undefined)?.scope;
      out.push({
        taskId,
        actionId: entries.find((e) => e.action !== null)?.action ?? null,
        ...(scopeId ? { scopeId } : {}),
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

  /** A file's content at commit `sha` (relative path, forward slashes); null when the commit or the file isn't there. */
  async readFileAt(sha: string | null, file: string): Promise<string | null> {
    if (sha === null) return null;
    try {
      const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid: sha, filepath: file });
      return Buffer.from(blob).toString("utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "NotFoundError") return null;
      throw err;
    }
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

  /** A folder the history never tracks anything in: ignored, and no `keep` entry can name a file inside it. */
  private skipsFolder(dir: string): boolean {
    const prefix = `${dir}/`;
    const keepsInside = (k: HistoryKeep): boolean => {
      if (typeof k === "string") return k.startsWith(prefix) || prefix.startsWith(k);
      if (k.prefix.startsWith(prefix)) return true;
      if (!prefix.startsWith(k.prefix)) return false;
      // Folders deeper than `depth` below the prefix hold nothing the pattern names (the fragments folder).
      return prefix.slice(k.prefix.length).split("/").filter(Boolean).length <= k.depth;
    };
    return this.ignore.some((i) => i.endsWith("/") && prefix.startsWith(i)) && !this.keep.some(keepsInside);
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
