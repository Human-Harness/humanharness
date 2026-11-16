/** The icon rail's entries (UI refresh spec §4.2): an entry shows only when the harness has the feature (D0). */
export type RailEntry = "home" | "tasks" | "inbox" | "jobs" | "notes" | "plugins" | "settings" | TaskRailEntry;

/** The rail's TASK group (task view one column): the open task's own pages, only while a task is open. */
export type TaskRailEntry = "task-notes" | "task-history" | "task-settings";

export const TASK_RAIL: readonly TaskRailEntry[] = ["task-notes", "task-history", "task-settings"];

export interface RailFeatures {
  parallel: boolean;
  jobs: boolean;
  notes: boolean;
  pluginPanels: boolean;
  /** The open task, with its note count; null or absent: none open. */
  task?: { notes: number } | null;
}

export function railEntries(f: RailFeatures): RailEntry[] {
  const out: RailEntry[] = ["home", "tasks"];
  if (f.parallel) out.push("inbox");
  if (f.parallel && f.jobs) out.push("jobs");
  if (f.notes) out.push("notes");
  if (f.pluginPanels) out.push("plugins");
  if (f.task) out.push(...TASK_RAIL);
  return out;
}

/** The counts over the rail's entries: the Inbox's waiting count, and the open task's notes. */
export function railCounts(f: RailFeatures, waiting: number): Partial<Record<RailEntry, number>> {
  return { inbox: waiting, ...(f.task ? { "task-notes": f.task.notes } : {}) };
}
