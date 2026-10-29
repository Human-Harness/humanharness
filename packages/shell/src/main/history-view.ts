import { type HistoryTaskView, NOTE } from "@humanharness/ui/client";
import type { HistoryTask } from "@humanharness/workspace";

/** A commit id from the window: 40 lowercase hex characters. */
export const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** What the History panel gets of each group: ISO dates, the title of the note a task saved, the job a run is of. */
export function historyView(groups: HistoryTask[]): HistoryTaskView[] {
  return groups.map((g) => {
    const note = g.taskId === null ? undefined : g.entries.map((e) => NOTE.exec(e.message)?.[1]).find((title) => title !== undefined);
    const job = g.taskId === null ? undefined : g.entries.find((e) => e.job !== undefined)?.job;
    return {
      taskId: g.taskId,
      actionId: g.actionId,
      ...(g.scopeId ? { scopeId: g.scopeId } : {}),
      ...(job ? { jobId: job } : {}),
      start: g.start,
      end: g.end,
      date: g.date.toISOString(),
      ...(note ? { noteTitle: note } : {}),
      changes: g.changes,
      entries: g.entries.map((e) => ({ sha: e.sha, message: e.message, date: e.date.toISOString(), ...(e.phase ? { phase: e.phase } : {}) })),
    };
  });
}
