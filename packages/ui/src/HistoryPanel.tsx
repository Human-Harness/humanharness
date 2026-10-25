import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import {
  type ActionOption,
  BEFORE_MESSAGE,
  type HarnessClient,
  type HistoryItem,
  type HistoryTaskView,
  DATA_CHANGE_PREFIX,
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
  const note = NOTE.exec(message);
  if (note) return { key: "history.entry.note", values: { title: note[1] } };
  return null;
}

/** How many tasks other than `own` changed something after `after` (an ISO date): going back undoes them too. */
export function laterTasks(groups: HistoryTaskView[], own: string | null, after: string): number {
  const t = Date.parse(after);
  return groups.filter((g) => g.taskId !== null && g.taskId !== own && Date.parse(g.date) > t).length;
}

const keyOf = (g: HistoryTaskView) => g.taskId ?? "other";

type Restore = { kind: "task" | "point"; id: string };

/** The id of a "go back" button, so focus can return to it when its confirmation is cancelled. */
const triggerId = (r: Restore) => `hh-history-back-${r.kind}-${r.id}`;

/** History (spec 3d §1): one row per task, with the files it changed, its entries and both ways back. */
export function HistoryPanel({
  client,
  actions,
  lang,
  onClose,
  onRestored,
  disabled = false,
}: {
  client: HarnessClient;
  /** The harness's actions: a task's row shows its action's label. */
  actions: Record<string, ActionOption>;
  lang: Language;
  onClose: () => void;
  /** Called after a restore succeeded, before the panel closes. */
  onRestored?: (kind: Restore["kind"]) => void;
  /** Going back is not allowed while a turn is live. */
  disabled?: boolean;
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
      // A dialog above it (the pre-flight question) handled this Escape itself.
      if (e.key === "Escape" && !e.defaultPrevented) close();
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

  /** The button, or its confirmation while it waits for a yes; `later` tasks are undone too. */
  const goBack = (r: Restore, label: string, later: number) =>
    confirming?.kind === r.kind && confirming.id === r.id && !disabled ? (
      <div className="hh-confirm">
        <p>
          {t(r.kind === "task" ? "history.confirmTask" : "history.confirm")}
          {later > 0 && ` ${t("history.laterTasks", { count: later })}`}
        </p>
        <button ref={yesRef} disabled={restoring} onClick={() => restore(r)}>
          {t("history.confirmYes")}
        </button>
        <button disabled={restoring} onClick={() => cancel(r)}>
          {t("history.cancel")}
        </button>
      </div>
    ) : (
      <button id={triggerId(r)} disabled={disabled || restoring} onClick={() => setConfirming(r)}>
        {label}
      </button>
    );

  const rowLabel = (g: HistoryTaskView) => {
    if (g.taskId === null) return t("history.other");
    if (g.actionId === null) return t("history.question");
    // An action the harness no longer has (or a trailer such as "toString") is just "a task".
    return Object.hasOwn(actions, g.actionId) ? actions[g.actionId].label[lang] : t("history.task");
  };
  const entryText = (e: HistoryItem) => {
    const label = entryLabel(e.message);
    return label ? t(label.key, label.values ?? {}) : e.message;
  };
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <aside className="hh-history" role="dialog" aria-modal="true" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button ref={closeRef} onClick={close}>
          {t("history.close")}
        </button>
      </header>
      {failed && <p role="alert">{t("history.restoreFailed")}</p>}
      {loadFailed && <p role="alert">{t("history.loadFailed")}</p>}
      {groups?.length === 0 && <p>{t("history.empty")}</p>}
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
      <ol className="hh-history-tasks">
        {shown?.map((g) => {
          const key = keyOf(g);
          const expanded = open.has(key);
          const bodyId = `hh-history-${key}`;
          return (
            <li key={key}>
              {/* aria-controls only names a body that is there. */}
              <button className="hh-history-row" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={() => toggle(key)}>
                <span className="hh-history-label">{rowLabel(g)}</span>
                {g.noteTitle && <span>{g.noteTitle}</span>}
                <time dateTime={g.date}>{when(g.date)}</time>
                <span className="hh-caption">{t("history.filesChanged", { count: g.changes.length })}</span>
              </button>
              {expanded && (
                <div id={bodyId} className="hh-history-body">
                  {g.changes.length > 0 && (
                    <ul className="hh-history-files" aria-label={t("history.changedFiles")}>
                      {g.changes.map((c) => (
                        <li key={c.path}>
                          <span className={`hh-change ${c.kind}`}>{t(`history.change.${c.kind}`)}</span>
                          <code>{c.path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  {g.taskId !== null &&
                    g.start !== null &&
                    goBack({ kind: "task", id: g.taskId }, t("history.restoreTask"), laterTasks(groups ?? [], g.taskId, g.date))}
                  <ol className="hh-history-entries">
                    {g.entries.map((e) => (
                      <li key={e.sha}>
                        <span>{entryText(e)}</span>
                        <time dateTime={e.date}>{when(e.date)}</time>
                        {goBack({ kind: "point", id: e.sha }, t("history.restore"), laterTasks(groups ?? [], g.taskId, e.date))}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
