import { promises as fs } from "node:fs";
import path from "node:path";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import type { HistoryTaskView, LinkedHistoryView } from "@humanharness/ui/client";
import { History, type LinkedFolderEntry, type ScopeEntry, isScopeId } from "@humanharness/workspace";
import { type RestoreByPaths, restoreTaskByPaths } from "./restore-paths";

/** A tracked linked folder's history, by the key and label it is shown with. */
export interface LinkedHistoryRef {
  key: string;
  label: string;
  path: string;
  history: History;
}

type Open = (path: string) => Promise<History | null>;
type Link = LinkedFolderEntry & { label: string };

/**
 * The write links of `scope` whose key the manifest still declares, split by whether the app's history covers them:
 * tracked, and not waiting for the person after gaining git (Decision 13). A read folder is in neither: the agent can't
 * change it. `entries` must already be the checked ones (`ScopeAccess.entries`): a hand-written link never gets here.
 */
function writeLinks(entries: ScopeEntry[], scope: string | null, decl: Record<string, LinkedFolderDecl>): { covered: Link[]; uncovered: Link[] } {
  const out = { covered: [] as Link[], uncovered: [] as Link[] };
  if (scope === null || !isScopeId(scope)) return out;
  const s = entries.find((e) => e.id === scope && !e.archived);
  for (const l of s?.linked ?? []) {
    if (!Object.hasOwn(decl, l.key) || decl[l.key].mode !== "write") continue;
    const link = { ...l, mode: "write" as const, label: decl[l.key].label };
    (l.tracked && !l.gitChanged ? out.covered : out.uncovered).push(link);
  }
  return out;
}

/**
 * The histories of `scope`'s tracked linked folders (L7: only those; an untracked folder, a read one or one that
 * gained git is never given to `History`). Git is looked at again here, failing closed: a folder that has git now, or
 * whose git can't be told, is left out, as is one whose history can't be opened (none yet).
 */
export async function linkedHistoriesFor(
  entries: ScopeEntry[],
  scope: string | null,
  decl: Record<string, LinkedFolderDecl>,
  open: Open,
  isGit: (dir: string) => Promise<boolean>,
): Promise<LinkedHistoryRef[]> {
  const out: LinkedHistoryRef[] = [];
  for (const l of writeLinks(entries, scope, decl).covered) {
    if (await isGit(l.path).catch(() => true)) continue;
    const history = await open(l.path);
    if (history) out.push({ key: l.key, label: l.label, path: l.path, history });
  }
  return out;
}

/**
 * A linked folder's history: the workspace's while a turn opened it, else one over its gitdir in the app's data
 * folder when that exists as a real folder (never made here, never through a link). Null: no history yet.
 */
export function openLinkedHistory(gitdirOf: (path: string) => string, opened: Open): Open {
  return async (dir) => {
    const live = await opened(dir);
    if (live) return live;
    const gitdir = gitdirOf(dir);
    const st = await fs.lstat(gitdir).catch(() => null);
    if (!st?.isDirectory()) return null;
    // A history the workspace made has a HEAD: without one, `init` would make a repository here.
    const head = await fs.lstat(path.join(gitdir, "HEAD")).catch(() => null);
    if (!head?.isFile()) return null;
    // The workspace's own options (linked folders ignore nothing).
    const h = new History(dir, gitdir, [], []);
    await h.init();
    return h;
  };
}

/**
 * Plain mode's "Undo this task" in each tracked linked folder: the whole folder back to the task's start there, as the
 * work folder (one untagged commit each). A history where the task made no commits is left alone. Returns how many
 * were restored.
 */
export async function restoreLinkedTask(histories: LinkedHistoryRef[], taskId: string, message: string): Promise<number> {
  let restored = 0;
  for (const { history } of histories) {
    const group = (await history.tasks()).find((g) => g.taskId === taskId);
    if (!group?.start) continue;
    await history.restore(group.start, message);
    restored++;
  }
  return restored;
}

const prefixed = (key: string, r: RestoreByPaths): RestoreByPaths => {
  if (r.ok) return { ...r, paths: r.paths.map((p) => `${key}/${p}`), sharedLeft: r.sharedLeft.map((p) => `${key}/${p}`), skipped: r.skipped.map((p) => `${key}/${p}`) };
  return "path" in r ? { ...r, path: `${key}/${r.path}` } : r;
};

type Running = Parameters<typeof restoreTaskByPaths>[2]["running"];

/**
 * An undo over several histories that restored some and then was refused in another (a turn already under way wrote
 * there between the checks and the restores). `workFolder`: the work folder was restored; `restored`: the linked
 * folders' keys restored; `notRestored`: the one that refused first, then the ones never reached; `refusal`: why.
 */
export interface PartialRestore {
  ok: false;
  reason: "partial";
  workFolder: boolean;
  restored: string[];
  notRestored: string[];
  refusal: Exclude<RestoreByPaths, { ok: true }>;
}

/**
 * Board and `single` mode's "Undo this task" (parallel spec §5.3) over the work folder and each tracked linked folder.
 * Every history is checked first and nothing is restored while any refuses (a linked folder's path named `<key>/…`);
 * a history the task never changed is skipped, and only when none has anything is the answer "nothing". Each linked
 * folder's running turns are its own (`linkedRunning`, the paths relative to it). A refusal between the checks and the
 * restores (a turn already under way) leaves some histories restored: a `PartialRestore`, logged.
 */
export async function restoreTaskWithLinked(
  main: History,
  linked: LinkedHistoryRef[],
  task: string,
  o: { running: Running; linkedRunning: (path: string) => Promise<{ task: string; paths: ReadonlySet<string> }[]>; includeShared: boolean; log?: (message: string) => void },
): Promise<RestoreByPaths | PartialRestore> {
  const all = [{ key: null as string | null, path: "", history: main }, ...linked];
  const one = async (h: (typeof all)[number], check: boolean): Promise<RestoreByPaths> => {
    const running: Running = h.key === null ? o.running : () => o.linkedRunning(h.path);
    const r = await restoreTaskByPaths(h.history, task, { running, includeShared: o.includeShared, check });
    return h.key === null ? r : prefixed(h.key, r);
  };
  const todo: (typeof all)[number][] = [];
  for (const h of all) {
    const r = await one(h, true);
    if (r.ok) todo.push(h);
    else if (r.reason !== "nothing") return r;
  }
  if (todo.length === 0) return { ok: false, reason: "nothing" };
  const result = { ok: true as const, paths: [] as string[], sharedLeft: [] as string[], skipped: [] as string[] };
  for (const [i, h] of todo.entries()) {
    const r = await one(h, false);
    if (!r.ok) {
      const done = todo.slice(0, i);
      // Nothing restored yet: a plain refusal, as without linked folders.
      if (done.length === 0) return r;
      const partial: PartialRestore = {
        ok: false,
        reason: "partial",
        workFolder: done.some((d) => d.key === null),
        restored: done.flatMap((d) => (d.key === null ? [] : [d.key])),
        notRestored: todo.slice(i).flatMap((d) => (d.key === null ? [] : [d.key])),
        refusal: r,
      };
      (o.log ?? console.error)(`Undo restored ${partial.workFolder ? "the work folder" : ""}${partial.restored.length ? ` ${partial.restored.join(", ")}` : ""} but not ${partial.notRestored.join(", ")}`);
      return partial;
    }
    result.paths.push(...r.paths);
    result.sharedLeft.push(...r.sharedLeft);
    result.skipped.push(...r.skipped);
  }
  return result;
}

/**
 * Plain mode's "Undo this task" groups: the work folder's, plus the tracked linked folders' (`linked`, newest first
 * each), so the confirm lists a later task that changed only a linked folder, and a task that changed only one can be
 * undone. A task in several histories keeps the work folder's group (else the first linked one's) with its newest
 * date anywhere; a linked folder's changes are named `<key>/…`.
 */
export function mergeTaskGroups(main: HistoryTaskView[], linked: { key: string; groups: HistoryTaskView[] }[]): HistoryTaskView[] {
  const out = main.map((g) => ({ ...g }));
  for (const { key, groups } of linked) {
    for (const g of groups) {
      if (g.taskId === null) continue;
      const have = out.find((x) => x.taskId === g.taskId);
      if (have) {
        if (Date.parse(g.date) > Date.parse(have.date)) have.date = g.date;
        continue;
      }
      out.push({ ...g, changes: g.changes.map((c) => ({ ...c, path: `${key}/${c.path}` })) });
    }
  }
  // Newest first, the "Outside a task" group last, as `History.tasks` orders them.
  return [...out.filter((g) => g.taskId !== null).sort((x, y) => Date.parse(y.date) - Date.parse(x.date)), ...out.filter((g) => g.taskId === null)];
}

/**
 * The History panel's view of `scope`'s linked folders: each task's changes in every tracked folder, and the write
 * folders undo doesn't cover (their own git) for the "not covered" line.
 */
export async function linkedHistoryView(
  entries: ScopeEntry[],
  scope: string | null,
  decl: Record<string, LinkedFolderDecl>,
  open: Open,
  isGit: (dir: string) => Promise<boolean>,
): Promise<LinkedHistoryView> {
  const { uncovered } = writeLinks(entries, scope, decl);
  const tasks: LinkedHistoryView["tasks"] = {};
  for (const { key, label, history } of await linkedHistoriesFor(entries, scope, decl, open, isGit)) {
    for (const g of await history.tasks()) {
      if (g.taskId === null || g.changes.length === 0) continue;
      // An own-property map: a task id like "__proto__" stays a plain key.
      if (!Object.hasOwn(tasks, g.taskId)) Object.defineProperty(tasks, g.taskId, { value: [], enumerable: true, writable: true, configurable: true });
      tasks[g.taskId].push({ key, label, changes: g.changes });
    }
  }
  return { uncovered: uncovered.map((l) => ({ key: l.key, label: l.label })), tasks };
}
