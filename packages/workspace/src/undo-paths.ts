import { isCanonicalPath, type FileChange, type History, type HistoryTask } from "./history";

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

/**
 * The tasks after `after` other than `own` whose changes touch one of `paths`: what undoing `own` by paths would also
 * undo (spec §5.3 "it counts only later tasks that changed the same paths"). Pass groups from
 * `tasks(depth, { ownCommits: true })` so a task counts only for its own commits. Newest first, as given.
 */
export function laterTasksSharing<
  G extends { taskId: string | null; date: Date | string; changes: readonly Pick<FileChange, "path">[] },
>(groups: readonly G[], own: string | null, after: Date | string, paths: readonly string[]): G[] {
  const mine = new Set(paths);
  const since = new Date(after).getTime();
  return groups.filter(
    (g) => g.taskId !== null && g.taskId !== own && new Date(g.date).getTime() > since && g.changes.some((c) => mine.has(c.path)),
  );
}
