import {
  BEFORE_MESSAGE,
  CONTEXT_CHANGE_PREFIX,
  DATA_CHANGE_PREFIX,
  FILE_RESTORE_PREFIX,
  type HistoryTaskView,
  NOTE,
  RESTORE_POINT,
  RESTORE_TASK,
  START,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
} from "./client";

/** The i18n key (and its values) that tells a history entry in plain language; null keeps the commit subject. */
export function entryLabel(message: string): { key: string; values?: Record<string, string> } | null {
  if (message === START) return { key: "history.entry.start" };
  if (message === BEFORE_MESSAGE) return { key: "history.entry.before" };
  if (message.startsWith(TURN_PREFIX)) return { key: "history.entry.turn" };
  if (message.startsWith(STOPPED_PREFIX)) return { key: "history.entry.stopped" };
  if (message.startsWith(UNDO_PREFIX)) return { key: "history.entry.undo" };
  if (message === RESTORE_TASK) return { key: "history.entry.restoredTask" };
  if (message === RESTORE_POINT) return { key: "history.entry.restored" };
  if (message.startsWith(DATA_CHANGE_PREFIX)) return { key: "history.entry.data", values: { collection: message.slice(DATA_CHANGE_PREFIX.length) } };
  if (message.startsWith(CONTEXT_CHANGE_PREFIX)) return { key: "history.entry.context", values: { change: message.slice(CONTEXT_CHANGE_PREFIX.length) } };
  if (message.startsWith(FILE_RESTORE_PREFIX)) {
    // `Go back: <path> to <target>`: the target never holds " to " (v2, "the version of <ISO time>"), so the last one splits.
    const rest = message.slice(FILE_RESTORE_PREFIX.length);
    const cut = rest.lastIndexOf(" to ");
    return { key: "history.entry.fileBack", values: { file: cut < 0 ? rest : rest.slice(0, cut) } };
  }
  const note = NOTE.exec(message);
  if (note) return { key: "history.entry.note", values: { title: note[1] } };
  return null;
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The groups split by local day, keeping their order (newest first). */
export function byDay(groups: HistoryTaskView[]): { day: Date; items: HistoryTaskView[] }[] {
  const days: { day: Date; items: HistoryTaskView[] }[] = [];
  for (const g of groups) {
    const d = new Date(g.date);
    const last = days[days.length - 1];
    if (last && sameDay(last.day, d)) last.items.push(g);
    else days.push({ day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [g] });
  }
  return days;
}
