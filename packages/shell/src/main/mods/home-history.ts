import { type FSWatcher, watch as fsWatch, promises as fs, mkdirSync } from "node:fs";
import path from "node:path";
import type { HomeChange } from "@humanharness/protocol";
import { History } from "@humanharness/workspace";

/** How long the home folder stays quiet before its changes are committed. */
export const HOME_QUIET_MS = 1000;

/**
 * A path under the home folder the history tracks (relative, `/`-separated): only `mods/`, `layouts/` and
 * `settings.json` (Decision), never the `.error` the app writes beside a broken file nor an atomic write's `.tmp`.
 * Everything else in the folder (`storage/`, `sessions/`, `core/`, `harness/`, `.control.json`, the manual) is the
 * app's own.
 */
export function tracksHomePath(rel: string): boolean {
  const name = rel.split("/").pop() ?? "";
  if (name.endsWith(".error") || name.endsWith(".tmp") || name === ".DS_Store") return false;
  const [top, ...rest] = rel.split("/");
  return rel === "settings.json" || ((top === "mods" || top === "layouts") && rest.length > 0);
}

/** A commit's message: "Change to the app: " and the paths it changed, at most three named. */
export function changeMessage(paths: readonly string[]): string {
  if (paths.length === 0) return "Change to the app";
  const named = paths.slice(0, 3).join(", ");
  return `Change to the app: ${named}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}`;
}

/**
 * The home folder's own history (minimal-core 0b2): a hidden git history of the person's layer, `mods/`, `layouts/`
 * and `settings.json`, with its gitdir outside the folder. A change is committed once the folder has been quiet for
 * `quietMs`; `undo` restores the commit before the last one, as a new commit, and the folder's watchers reload what
 * it changed.
 */
export class HomeHistory {
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(c: HomeChange | null) => void>();

  constructor(
    private readonly home: string,
    private readonly gitdir: string,
    private readonly quietMs = HOME_QUIET_MS,
  ) {}

  /**
   * A History over the home folder that tracks only what `tracksHomePath` names. Its ignore list (prefixes and exact
   * paths) is made from the folder as it is now: every other top-level entry, and each `.error` or `.tmp` file in
   * `mods/` and `layouts/` (isomorphic-git's status walk never reads the gitdir's `info/exclude`).
   */
  private async history(): Promise<History> {
    const others: string[] = [];
    const top = await fs.readdir(this.home, { withFileTypes: true }).catch(() => []);
    for (const e of top) {
      if (e.name === "mods" || e.name === "layouts" || e.name === "settings.json") continue;
      others[others.length] = e.isDirectory() ? `${e.name}/` : e.name;
    }
    for (const dir of ["mods", "layouts"]) {
      const entries = await fs.readdir(path.join(this.home, dir), { withFileTypes: true, recursive: true }).catch(() => []);
      for (const e of entries) {
        const rel = path.relative(this.home, path.join(e.parentPath, e.name)).split(path.sep).join("/");
        if (!e.isDirectory() && !tracksHomePath(rel)) others[others.length] = rel;
      }
    }
    return new History(this.home, this.gitdir, others, []);
  }

  /** Told after every commit (and undo) with the last change. */
  onChange(fn: (c: HomeChange | null) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Makes the history (once) and commits what changed while the app was closed. */
  async init(): Promise<void> {
    await fs.mkdir(this.home, { recursive: true });
    await (await this.history()).init();
    await this.commitNow();
  }

  /** Commits the tracked changes now; null when nothing changed (a first commit is made even then). */
  commitNow(): Promise<HomeChange | null> {
    return this.serial(async () => {
      const history = await this.history();
      const changed = await history.changedSince(null);
      if (changed.length === 0 && (await history.last()) !== null) return null;
      const sha = await history.save(changeMessage(changed));
      if (sha === null) return null;
      return this.told();
    });
  }

  /** The last change: its message and when; null before any commit. */
  async last(): Promise<HomeChange | null> {
    const [e] = await (await this.history()).list(1);
    return e ? { message: e.message, at: e.date.toISOString() } : null;
  }

  /** How many commits the history has (at most 1000). */
  async count(): Promise<number> {
    return (await (await this.history()).list(1000)).length;
  }

  /** The files the last commit holds. */
  async trackedFiles(): Promise<string[]> {
    return (await (await this.history()).trackedFiles()).sort();
  }

  /**
   * Brings back the commit before the last one, committed as "Undo: <last message>"; null (and nothing done) when the
   * history has one commit or none. Pending edits are committed first, so an undo never loses them.
   */
  undo(): Promise<HomeChange | null> {
    return this.commitNow().then(() =>
      this.serial(async () => {
        const history = await this.history();
        const [last, before] = await history.list(2);
        if (!last || !before) return null;
        const sha = await history.restore(before.sha, `Undo: ${last.message}`);
        if (sha === null) return null;
        return this.told();
      }),
    );
  }

  private async told(): Promise<HomeChange | null> {
    const c = await this.last();
    for (const l of [...this.listeners]) {
      try {
        l(c);
      } catch (err) {
        console.error("A home history listener failed", err);
      }
    }
    return c;
  }

  /** Watches the home folder: a tracked change is committed once it has been quiet for `quietMs`. */
  watch(): void {
    if (this.watcher) return;
    try {
      mkdirSync(this.home, { recursive: true });
      this.watcher = fsWatch(this.home, { recursive: true }, (_event, name) => {
        if (!name || !tracksHomePath(name.toString().split(path.sep).join("/"))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.commitNow().catch((err: unknown) => console.error("Could not commit the home folder's change", err));
        }, this.quietMs);
      });
      this.watcher.on("error", (err) => console.error("The home history's watcher stopped", err));
    } catch (err) {
      console.error(`Could not watch ${this.home}`, err);
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = null;
  }
}
