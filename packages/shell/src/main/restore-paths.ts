import { BEFORE_MESSAGE, type History, RESTORE_TASK, laterChangesSharing, ownedPathsOf, sharedPathsOf } from "@humanharness/workspace";

/** How many commits back an undo by paths reads: the task's commits and every later one must fit. */
const DEPTH = 500;

type Running = readonly { task: string; paths: ReadonlySet<string> }[];

export type RestoreByPaths =
  | { ok: true; paths: string[]; sharedLeft: string[]; skipped: string[] }
  /** A running turn touched `path` (P2). */
  | { ok: false; reason: "running"; path: string }
  /** `path` has changes the history hasn't saved: undoing would throw them away. */
  | { ok: false; reason: "uncommitted"; path: string }
  /** A later task (`tasks`) or a commit outside any task (`outside`, a count) changed `path` after this task began. */
  | { ok: false; reason: "later"; path: string; tasks: string[]; outside: number }
  /** The task began further back than the history is read: a later change could be missed. */
  | { ok: false; reason: "too-far" }
  | { ok: false; reason: "nothing" };

/**
 * "Undo this task" in board mode (parallel spec §5.3, Decision 12): its own paths (and its shared ones when
 * `includeShared`) back to how they were at its start, in one commit. A path both owned and shared counts as owned.
 *
 * Refused, with the file named, while a running turn touched one of them (P2), while one has changes not yet in the
 * history, and when a later task or a commit outside any task changed one after this task began (undoing would undo
 * their change too). Refused too when the task began more than `depth` commits back, where those reads stop.
 */
export async function restoreTaskByPaths(
  history: History,
  task: string,
  o: {
    /** The running turns' paths, or how to read them: read as late as possible, right before the restore. */
    running: Running | (() => Promise<Running>);
    includeShared: boolean;
    depth?: number;
    /** Only the checks: the answer a restore would give, with nothing restored (an undo over several histories). */
    check?: boolean;
  },
): Promise<RestoreByPaths> {
  const depth = o.depth ?? DEPTH;
  const group = (await history.tasks(depth, { ownCommits: true })).find((g) => g.taskId === task);
  if (!group?.start) return { ok: false, reason: "nothing" };
  // A full window never reached the task's start: its first commits and the changes right after it are out of view.
  const since = await history.commitsSince(group.start, depth);
  if (since.length >= depth) return { ok: false, reason: "too-far" };
  // A history longer than the window may hold older commits of this task past it: the group then starts at its oldest
  // commit in view, not at the task's start. Only a start that is this task's own "Before message", in the newer half
  // of the window, is taken as its start.
  const window = await history.list(depth);
  if (window.length >= depth) {
    const at = window.findIndex((e) => e.sha === group.start);
    const opening = group.entries.at(-1);
    if (at < 0 || at >= depth / 2 || opening?.sha !== group.start || opening.message !== BEFORE_MESSAGE) return { ok: false, reason: "too-far" };
  }
  const owned = await ownedPathsOf(history, group);
  const shared = (await sharedPathsOf(history, group)).filter((p) => !owned.includes(p));
  const paths = [...new Set([...owned, ...(o.includeShared ? shared : [])])].sort();
  if (paths.length === 0) return { ok: false, reason: "nothing" };
  // The same commits the window guard read: a shorter read would miss a later change past it.
  const later = laterChangesSharing(since, group, paths);
  if (later.tasks.length > 0 || later.outside.length > 0) {
    const others = new Set([...later.outside, ...since.filter((c) => c.task !== null && later.tasks.includes(c.task)).map((c) => c.sha)]);
    const path = since.find((c) => others.has(c.sha))?.paths.find((p) => paths.includes(p)) ?? paths[0];
    return { ok: false, reason: "later", path, tasks: later.tasks, outside: later.outside.length };
  }
  // Last, right before the restore: what running turns touched and what is unsaved now. A turn already running can
  // still write one of the paths between these reads and the restore's own (each is its own history operation); new
  // turns are held while an undo runs (the host's checkTurn waits for it), so only one already under way can.
  const running = typeof o.running === "function" ? await o.running() : o.running;
  for (const p of paths) if (running.some((r) => r.task !== task && r.paths.has(p))) return { ok: false, reason: "running", path: p };
  const dirty = new Set(await history.changedSince(null));
  const unsaved = paths.find((p) => dirty.has(p));
  if (unsaved !== undefined) return { ok: false, reason: "uncommitted", path: unsaved };
  if (o.check) return { ok: true, paths, sharedLeft: o.includeShared ? [] : shared, skipped: [] };
  const r = await history.restorePaths(paths, group.start, RESTORE_TASK, { task });
  return { ok: true, paths, sharedLeft: o.includeShared ? [] : shared, skipped: r.skipped };
}
