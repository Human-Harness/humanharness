import { isCanonicalPath } from "./history";

/** Who a turn's changed paths belong to (parallel spec §5.2). Every list is sorted. */
export interface Attribution {
  /** This turn's: committed with it, restored on its crash, undone with its task. */
  owned: string[];
  /** Nobody's edit events named them: committed with this turn in a shared commit. */
  shared: string[];
  /** The running tasks the shared paths are shared with (the `Shared:` trailers). */
  with: string[];
  /** Named only by another running turn: left uncommitted for that turn's own end. */
  left: string[];
}

/** The canonical folder-relative paths of `paths`, each once, sorted; any other spelling is dropped. */
const canonical = (paths: readonly string[]): string[] => [...new Set(paths.filter(isCanonicalPath))].sort();

/**
 * Splits the paths a turn changed. Without overlap, all are its own (D7: today's commit). With overlap: a path its own
 * edit events named is its own; a path only another still-running turn named is left for that turn; the rest is
 * shared with every still-running turn. When no other turn runs any more, there is nobody to share with: all its own.
 * Edit events are a hint, not a full list: a path no turn named (a shell write) is simply shared. Only canonical
 * folder-relative paths count (the ledger has already made edit paths relative); any other spelling lands in no list.
 */
export function attribute(o: {
  changed: readonly string[];
  overlapped: boolean;
  ownEdits: ReadonlySet<string>;
  others: readonly { task: string; edits: ReadonlySet<string> }[];
}): Attribution {
  const sorted = canonical(o.changed);
  if (!o.overlapped || o.others.length === 0) return { owned: sorted, shared: [], with: [], left: [] };
  const owned: string[] = [];
  const shared: string[] = [];
  const left: string[] = [];
  for (const p of sorted) {
    if (o.ownEdits.has(p)) owned.push(p);
    else if (o.others.some((x) => x.edits.has(p))) left.push(p);
    else shared.push(p);
  }
  const withTasks = shared.length > 0 ? [...new Set(o.others.map((x) => x.task))].sort() : [];
  return { owned, shared, with: withTasks, left };
}

/**
 * The turn's paths another task's commit changed since the turn started (spec §5.3): both tasks get a notice. `commits`
 * is `History.commitsSince(before)`, newest first; commits of `ownTask` and those outside any task don't count. Each
 * conflict names its tasks once, newest commit first; non-canonical paths never conflict.
 */
export function conflictsOf(
  paths: readonly string[],
  commits: readonly { task: string | null; paths: readonly string[] }[],
  ownTask: string | undefined,
): { path: string; tasks: string[] }[] {
  const out: { path: string; tasks: string[] }[] = [];
  for (const p of canonical(paths)) {
    const tasks = new Set<string>();
    for (const c of commits) if (c.task !== null && c.task !== ownTask && c.paths.includes(p)) tasks.add(c.task);
    if (tasks.size > 0) out.push({ path: p, tasks: [...tasks] });
  }
  return out;
}
