import type { HistoryTaskView } from "@humanharness/ui/client";
import type { HistoryTask } from "@humanharness/workspace";

/** The commit messages of the two restores (raw git data; the panel shows them through i18n keys). */
export const RESTORE_POINT = "Went back to an earlier point";
export const RESTORE_TASK = "Went back to before the task";

const NOTE = /^Note: (.+)$/;

/** A commit id from the window: 40 lowercase hex characters. */
export const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** What the History panel gets of each group: ISO dates, and the title of the note a task saved. */
export function historyView(groups: HistoryTask[]): HistoryTaskView[] {
  return groups.map((g) => {
    const note = g.taskId === null ? undefined : g.entries.map((e) => NOTE.exec(e.message)?.[1]).find((title) => title !== undefined);
    return {
      taskId: g.taskId,
      actionId: g.actionId,
      start: g.start,
      end: g.end,
      date: g.date.toISOString(),
      ...(note ? { noteTitle: note } : {}),
      changes: g.changes,
      entries: g.entries.map((e) => ({ sha: e.sha, message: e.message, date: e.date.toISOString() })),
    };
  });
}
