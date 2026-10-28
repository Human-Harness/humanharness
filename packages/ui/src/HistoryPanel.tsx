import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ActionOption,
  BEFORE_MESSAGE,
  type HarnessClient,
  type HistoryItem,
  type HistoryTaskView,
  DATA_CHANGE_PREFIX,
  FILE_RESTORE_PREFIX,
  type HistoryFileChange,
  NOTE,
  RESTORE_POINT,
  RESTORE_TASK,
  START,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
} from "./client";
import { ChevronIcon, ClockIcon, CloseIcon, UndoIcon, WarnIcon } from "./chrome";
import { shownLanguage } from "./language";

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

/** The tasks other than `own` that changed something after `after` (an ISO date), newest first: going back undoes them too. */
export function laterTasks(groups: HistoryTaskView[], own: string | null, after: string): HistoryTaskView[] {
  const t = Date.parse(after);
  return groups.filter((g) => g.taskId !== null && g.taskId !== own && Date.parse(g.date) > t);
}

const keyOf = (g: HistoryTaskView) => g.taskId ?? "other";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

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

type Restore = { kind: "task" | "point"; id: string };

/** The id of a "go back" button, so focus can return to it when its confirmation is cancelled. */
const triggerId = (r: Restore) => `hh-history-back-${r.kind}-${r.id}`;

/** History (spec 3d §1): one row per task, with the files it changed, its entries and both ways back. */
export function HistoryPanel({
  client,
  actions,
  onClose,
  onRestored,
  disabled = false,
  currentTask,
  onOpenFile,
}: {
  client: HarnessClient;
  /** The harness's actions: a task's row shows its action's label. */
  actions: Record<string, ActionOption>;
  /** The open task's id: its row says it is in progress. */
  currentTask?: string;
  onClose: () => void;
  /** Called after a restore succeeded, before the panel closes. */
  onRestored?: (kind: Restore["kind"]) => void;
  /** Going back is not allowed while a turn is live. */
  disabled?: boolean;
  /** A changed file was picked: its timeline opens (file-timeline spec §6.2). Absent: the paths stay plain text. */
  onOpenFile?: (path: string, kind: HistoryFileChange["kind"]) => void;
}) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<HistoryTaskView[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<Restore | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** A restore was sent and hasn't answered: no other way back can be taken meanwhile. */
  const [restoring, setRestoring] = useState(false);
  /** Harnesses with scopes: the scope whose tasks show ("" for all), and the scopes' titles. */
  const [filter, setFilter] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const scopeIds = [...new Set((groups ?? []).flatMap((g) => (g.scopeId ? [g.scopeId] : [])))];
  const hasScopes = scopeIds.length > 0;
  useEffect(() => {
    if (!hasScopes) return;
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client, hasScopes]);
  // A reload can drop the selected scope: back to all.
  useEffect(() => {
    if (filter && !scopeIds.includes(filter)) setFilter("");
  });
  const shown = filter ? (groups ?? []).filter((g) => g.scopeId === filter) : groups;
  const closeRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  /** The button whose confirmation was cancelled: it gets focus back once it is shown again. */
  const refocus = useRef<string | null>(null);
  /** What had focus when the panel opened: it gets focus back when the panel closes. */
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Reads only refs, so the Escape listener added on the first render can call it.
  const close = () => {
    const back = opener.current;
    onCloseRef.current();
    if (back?.isConnected) back.focus();
  };
  useEffect(() => {
    client.historyTasks().then(
      (g) => {
        setGroups(g);
        // The newest task starts open: it is what the person most likely wants to undo.
        if (g[0]) setOpen(new Set([keyOf(g[0])]));
      },
      () => setLoadFailed(true),
    );
  }, [client]);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A dialog above it (the pre-flight question) handled this Escape itself. Handling it here marks it too, so
      // focus mode's window listener does not also leave.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (confirming) yesRef.current?.focus();
    else if (refocus.current) {
      document.getElementById(refocus.current)?.focus();
      refocus.current = null;
    }
  }, [confirming]);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const restore = (r: Restore) => {
    if (restoring) return;
    setFailed(false);
    setRestoring(true);
    (r.kind === "task" ? client.restoreTask(r.id) : client.restore(r.id)).then(
      () => {
        setRestoring(false);
        onRestored?.(r.kind);
        close();
      },
      () => {
        setRestoring(false);
        setConfirming(null);
        setFailed(true);
      },
    );
  };

  const cancel = (r: Restore) => {
    refocus.current = triggerId(r);
    setConfirming(null);
  };

  /**
   * The button, or its confirmation while it waits for a yes. `later` tasks are undone too; with any, the
   * confirmation lists what goes, `task` (the group being undone, for "Undo this task") first.
   */
  const goBack = (r: Restore, later: HistoryTaskView[], task?: HistoryTaskView) => {
    if (!(confirming?.kind === r.kind && confirming.id === r.id && !disabled)) return trigger(r);
    const undone = later.length > 0 ? [...(task ? [task] : []), ...later] : [];
    return (
      <div className="hh-confirm hh-history-confirm">
        <WarnIcon />
        <div>
          {task && <strong>{t("history.confirmTaskTitle", { name: rowLabel(task) })}</strong>}
          <p>
            {t(task ? "history.confirmTask" : "history.confirm")}
            {later.length > 0 && ` ${t("history.laterTasks", { count: later.length })}`}
          </p>
        </div>
        {undone.length > 0 && (
          <ul className="hh-history-undone" aria-label={t("history.undone")}>
            {undone.map((g) => (
              <li key={keyOf(g)}>
                <span>{rowLabel(g)}</span>
                <span className="hh-caption">{t("history.filesChanged", { count: g.changes.length })}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="hh-history-confirm-buttons">
          <button disabled={restoring} onClick={() => cancel(r)}>
            {t("history.cancel")}
          </button>
          <button ref={yesRef} className="hh-primary" disabled={restoring} onClick={() => restore(r)}>
            {task ? t("history.undoTasks", { count: later.length + 1 }) : t("history.confirmYes")}
          </button>
        </div>
      </div>
    );
  };

  const trigger = (r: Restore) =>
    r.kind === "task" ? (
      <button id={triggerId(r)} className="hh-history-undo" disabled={disabled || restoring} onClick={() => setConfirming(r)}>
        <UndoIcon />
        {t("history.restoreTask")}
      </button>
    ) : (
      <button id={triggerId(r)} className="hh-history-point-back" disabled={disabled || restoring} onClick={() => setConfirming(r)}>
        {t("history.restore")}
      </button>
    );

  const rowLabel = (g: HistoryTaskView) => {
    if (g.taskId === null) return t("history.other");
    if (g.actionId === null) return t("history.question");
    // An action the harness no longer has (or a trailer such as "toString") is just "a task".
    return Object.hasOwn(actions, g.actionId) ? actions[g.actionId].label : t("history.task");
  };
  const entryText = (e: HistoryItem) => {
    const label = entryLabel(e.message);
    return label ? t(label.key, label.values ?? {}) : e.message;
  };
  const language = shownLanguage(i18n);
  /** The time alone; the day is its section's heading, and the full date shows on hover. */
  const when = (iso: string) => {
    const d = new Date(iso);
    return (
      <time dateTime={iso} title={d.toLocaleString(language)}>
        {d.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" })}
      </time>
    );
  };
  // Tasks under their day; the group outside any task always comes last, in a section of its own.
  // With a scope filter on, only that scope's tasks (going back still counts every later task).
  const days: { day: Date | null; items: HistoryTaskView[] }[] = shown ? byDay(shown.filter((g) => g.taskId !== null)) : [];
  const outside = shown?.find((g) => g.taskId === null);
  if (outside) days.push({ day: null, items: [outside] });
  const dayLabel = (day: Date) => {
    const today = new Date();
    if (sameDay(day, today)) return t("history.today");
    if (sameDay(day, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return t("history.yesterday");
    const year = day.getFullYear() === today.getFullYear() ? undefined : "numeric";
    return day.toLocaleDateString(language, { month: "short", day: "numeric", year });
  };

  return (
    <aside className="hh-history" role="dialog" aria-modal="true" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button ref={closeRef} className="hh-icon-button" aria-label={t("history.close")} onClick={close}>
          <CloseIcon />
        </button>
      </header>
      {groups !== null && groups.length > 0 && <p className="hh-caption hh-history-intro">{t("history.intro")}</p>}
      {disabled && (
        <p role="status" className="hh-history-busy">
          <ClockIcon />
          {t("history.busy")}
        </p>
      )}
      {failed && <p role="alert">{t("history.restoreFailed")}</p>}
      {loadFailed && <p role="alert">{t("history.loadFailed")}</p>}
      {groups?.length === 0 && (
        <div className="hh-history-empty">
          <ClockIcon size={28} />
          <strong>{t("history.emptyTitle")}</strong>
          <p className="hh-caption">{t("history.empty")}</p>
        </div>
      )}
      {shown?.length === 0 && (groups?.length ?? 0) > 0 && <p>{t("history.emptyFilter")}</p>}
      {hasScopes && (
        <label className="hh-history-filter">
          {t("history.scopeFilter")}{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t("history.allScopes")}</option>
            {scopeIds.map((id) => (
              <option key={id} value={id}>
                {id === "_app" ? t("history.appScope") : (titles[id] ?? id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {days.map(({ day, items }) => (
        <section key={day?.toDateString() ?? "outside"} className="hh-history-day">
          {day && <h3>{dayLabel(day)}</h3>}
          <ol className="hh-history-tasks">
            {items.map((g) => {
              const key = keyOf(g);
              const expanded = open.has(key);
              const bodyId = `hh-history-${key}`;
              return (
                <li key={key}>
                  {/* aria-controls only names a body that is there. */}
                  <button className="hh-history-row" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={() => toggle(key)}>
                    <ChevronIcon open={expanded} />
                    <span className="hh-history-row-text">
                      <span className="hh-history-label">{rowLabel(g)}</span>
                      <span className="hh-caption">
                        {when(g.date)} · {t("history.filesChanged", { count: g.changes.length })}
                      </span>
                    </span>
                    {currentTask !== undefined && g.taskId === currentTask && <span className="hh-history-chip open">{t("history.inProgress")}</span>}
                    {g.noteTitle && (
                      <span className="hh-history-chip" title={g.noteTitle}>
                        {t("history.noteSaved")}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div id={bodyId} className="hh-history-body">
                      {g.changes.length > 0 && (
                        <ul className="hh-history-files" aria-label={t("history.changedFiles")}>
                          {g.changes.map((c, i) => (
                            <li key={c.path}>
                              <span id={`${bodyId}-k${i}`} className={`hh-change ${c.kind}`}>
                                {t(`history.change.${c.kind}`)}
                              </span>
                              {onOpenFile ? (
                                <button
                                  type="button"
                                  className="hh-link hh-history-file-link"
                                  title={c.path}
                                  aria-label={t("history.openTimeline", { file: c.path })}
                                  aria-describedby={`${bodyId}-k${i}`}
                                  onClick={() => onOpenFile(c.path, c.kind)}
                                >
                                  <code>{c.path}</code>
                                </button>
                              ) : (
                                <code title={c.path}>{c.path}</code>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <ol className="hh-history-entries" aria-label={t("history.points")}>
                        {g.entries.map((e) => (
                          <li key={e.sha}>
                            <span className="hh-history-entry-text">
                              <span>{entryText(e)}</span>
                              {/* The part the task was in (task-phases spec §6); none for a part the manifest no longer has. */}
                              {e.phase && g.actionId && Object.hasOwn(actions, g.actionId) && (
                                <span className="hh-caption">{actions[g.actionId].phases?.find((p) => p.id === e.phase)?.label}</span>
                              )}
                              {when(e.date)}
                            </span>
                            {goBack({ kind: "point", id: e.sha }, laterTasks(groups ?? [], g.taskId, e.date))}
                          </li>
                        ))}
                      </ol>
                      {g.taskId !== null &&
                        g.start !== null &&
                        goBack({ kind: "task", id: g.taskId }, laterTasks(groups ?? [], g.taskId, g.date), g)}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </aside>
  );
}
