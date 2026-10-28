import { promises as fs } from "node:fs";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import type { LinkedHistoryView } from "@humanharness/ui/client";
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
 * gained git is never given to `History`). A folder whose history can't be opened (none yet) is left out.
 */
export async function linkedHistoriesFor(
  entries: ScopeEntry[],
  scope: string | null,
  decl: Record<string, LinkedFolderDecl>,
  open: Open,
): Promise<LinkedHistoryRef[]> {
  const out: LinkedHistoryRef[] = [];
  for (const l of writeLinks(entries, scope, decl).covered) {
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
    // The workspace's own options (linked folders ignore nothing).
    const h = new History(dir, gitdir, [], []);
    await h.init();
    return h;
  };
}

/**
 * Plain mode's "Undo this task" in each tracked linked folder: the whole folder back to the task's start there, as the
 * work folder (one untagged commit each). A history where the task made no commits is left alone.
 */
export async function restoreLinkedTask(histories: LinkedHistoryRef[], taskId: string, message: string): Promise<void> {
  for (const { history } of histories) {
    const group = (await history.tasks()).find((g) => g.taskId === taskId);
    if (group?.start) await history.restore(group.start, message);
  }
}

const prefixed = (key: string, r: RestoreByPaths): RestoreByPaths => {
  if (r.ok) return { ...r, paths: r.paths.map((p) => `${key}/${p}`), sharedLeft: r.sharedLeft.map((p) => `${key}/${p}`), skipped: r.skipped.map((p) => `${key}/${p}`) };
  return "path" in r ? { ...r, path: `${key}/${r.path}` } : r;
};

/**
 * Board and `single` mode's "Undo this task" (parallel spec §5.3) over the work folder and each tracked linked folder.
 * Every history is checked first and nothing is restored while any refuses (a linked folder's path named `<key>/…`);
 * a history the task never changed is skipped, and only when none has anything is the answer "nothing". The running
 * turns' paths are the work folder's: in a linked folder only its unsaved changes refuse (a running turn's edits stay
 * unsaved until its end). A refusal between the checks and the restores (a turn already under way) can still leave
 * one history restored and another not: logged, and the refusal returned.
 */
export async function restoreTaskWithLinked(
  main: History,
  linked: LinkedHistoryRef[],
  task: string,
  o: { running: Parameters<typeof restoreTaskByPaths>[2]["running"]; includeShared: boolean; log?: (message: string) => void },
): Promise<RestoreByPaths> {
  const all = [{ key: null as string | null, history: main }, ...linked];
  const run = async (check: boolean) => {
    const out: { key: string | null; history: History; r: RestoreByPaths }[] = [];
    for (const h of all) {
      const r = await restoreTaskByPaths(h.history, task, { running: h.key === null ? o.running : [], includeShared: o.includeShared, check });
      const shown = h.key === null ? r : prefixed(h.key, r);
      if (!shown.ok && shown.reason !== "nothing") return { refused: shown, done: out };
      out.push({ key: h.key, history: h.history, r: shown });
    }
    return { refused: null, done: out };
  };
  const checked = await run(true);
  if (checked.refused) return checked.refused;
  const todo = checked.done.filter((d) => d.r.ok);
  if (todo.length === 0) return { ok: false, reason: "nothing" };
  const result = { ok: true as const, paths: [] as string[], sharedLeft: [] as string[], skipped: [] as string[] };
  for (const d of todo) {
    const r = await restoreTaskByPaths(d.history, task, { running: d.key === null ? o.running : [], includeShared: o.includeShared });
    const shown = d.key === null ? r : prefixed(d.key, r);
    if (!shown.ok) {
      if (result.paths.length > 0) (o.log ?? console.error)(`Undo covered ${result.paths.join(", ")} but not ${d.key ?? "the work folder"}`);
      return shown;
    }
    result.paths.push(...shown.paths);
    result.sharedLeft.push(...shown.sharedLeft);
    result.skipped.push(...shown.skipped);
  }
  return result;
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
): Promise<LinkedHistoryView> {
  const { uncovered } = writeLinks(entries, scope, decl);
  const tasks: LinkedHistoryView["tasks"] = {};
  for (const { key, label, history } of await linkedHistoriesFor(entries, scope, decl, open)) {
    for (const g of await history.tasks()) {
      if (g.taskId === null || g.changes.length === 0) continue;
      // An own-property map: a task id like "__proto__" stays a plain key.
      if (!Object.hasOwn(tasks, g.taskId)) Object.defineProperty(tasks, g.taskId, { value: [], enumerable: true, writable: true, configurable: true });
      tasks[g.taskId].push({ key, label, changes: g.changes });
    }
  }
  return { uncovered: uncovered.map((l) => ({ key: l.key, label: l.label })), tasks };
}
