import { isCanonicalPath, type CommitSince, type History, type HistoryTask } from "./history";

/**
 * The paths a task's own commits changed (commits without `Shared:` trailers), sorted. The commit at the task's
 * `start` (its opening "Before message", the person's own edits) is left out. Every path comes from a commit tree, so
 * it is safe to hand to `History.restorePaths`.
 */
export async function ownedPathsOf(history: History, task: HistoryTask): Promise<string[]> {
  return pathsOf(history, task, false);
}

/** The paths its shared commits changed (spec §5.3: undone only after the person confirms), sorted. */
export async function sharedPathsOf(history: History, task: HistoryTask): Promise<string[]> {
  return pathsOf(history, task, true);
}

async function pathsOf(history: History, task: HistoryTask, shared: boolean): Promise<string[]> {
  const out = new Set<string>();
  for (const e of task.entries) {
    // Ownership comes from the parsed trailers only, never from the subject's text.
    if (e.sha === task.start || (e.shared !== undefined && e.shared.length > 0) !== shared) continue;
    for (const c of await history.commitChanges(e.sha)) if (isCanonicalPath(c.path)) out.add(c.path);
  }
  return [...out].sort();
}

/** What undoing a task by paths would also undo (`laterChangesSharing`). */
export interface LaterChanges {
  /** The other tasks whose commits after the task's start touch one of the paths, newest first, once each. */
  tasks: string[];
  /** The commits outside any task that touch one of the paths (the person's own edits), newest first. */
  outside: string[];
}

/**
 * Which commits after `task.start` other than the task's own entries touch one of `paths` (spec §5.3 "it counts only
 * later tasks that changed the same paths"). Decided by commit order, never by dates: git dates are whole seconds and
 * a task's commits may interleave with others'. `commits` is `History.commitsSince(task.start)` (newest first); a
 * "Before message" of another task counts under that task, so the person's edits it swept in are never missed.
 */
export function laterChangesSharing(
  commits: readonly Pick<CommitSince, "sha" | "task" | "paths">[],
  task: Pick<HistoryTask, "entries">,
  paths: readonly string[],
): LaterChanges {
  const mine = new Set(paths);
  const own = new Set(task.entries.map((e) => e.sha));
  const tasks: string[] = [];
  const outside: string[] = [];
  for (const c of commits) {
    if (own.has(c.sha) || !c.paths.some((p) => mine.has(p))) continue;
    if (c.task === null) outside.push(c.sha);
    else if (!tasks.includes(c.task)) tasks.push(c.task);
  }
  return { tasks, outside };
}

/**
 * `laterChangesSharing` over the history's commits since `task.start`. It queues a read on the history's one write
 * queue, so never call it from inside another serialized history operation.
 */
export async function laterChangesOf(history: History, task: HistoryTask, paths: readonly string[]): Promise<LaterChanges> {
  return laterChangesSharing(await history.commitsSince(task.start), task, paths);
}
