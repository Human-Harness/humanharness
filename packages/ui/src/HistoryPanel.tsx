import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { ActionOption, HarnessClient, HistoryItem, HistoryTaskView } from "./client";

/** The i18n key (and its values) that tells a history entry in plain language; null keeps the commit subject. */
export function entryLabel(message: string): { key: string; values?: Record<string, string> } | null {
  if (message === "Start") return { key: "history.entry.start" };
  if (message === "Before message") return { key: "history.entry.before" };
  if (message.startsWith("Turn: ")) return { key: "history.entry.turn" };
  if (message.startsWith("Stopped: ")) return { key: "history.entry.stopped" };
  if (message.startsWith("Undo: ")) return { key: "history.entry.undo" };
  if (message === "Went back to before the task") return { key: "history.entry.restoredTask" };
  if (message === "Went back to an earlier point") return { key: "history.entry.restored" };
  const note = /^Note: (.+)$/.exec(message);
  if (note) return { key: "history.entry.note", values: { title: note[1] } };
  return null;
}

const keyOf = (g: HistoryTaskView) => g.taskId ?? "earlier";

type Restore = { kind: "task" | "point"; id: string };

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
  onRestored?: () => void;
  /** Going back is not allowed while a turn is live. */
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<HistoryTaskView[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<Restore | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
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
      () => setGroups([]),
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

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const restore = (r: Restore) => {
    setFailed(false);
    (r.kind === "task" ? client.restoreTask(r.id) : client.restore(r.id)).then(
      () => {
        onRestored?.();
        close();
      },
      () => {
        setConfirming(null);
        setFailed(true);
      },
    );
  };

  /** The button, or its confirmation while it waits for a yes. */
  const goBack = (r: Restore, label: string) =>
    confirming?.kind === r.kind && confirming.id === r.id && !disabled ? (
      <div className="hh-confirm">
        <p>{t(r.kind === "task" ? "history.confirmTask" : "history.confirm")}</p>
        <button onClick={() => restore(r)}>{t("history.confirmYes")}</button>
        <button onClick={() => setConfirming(null)}>{t("history.cancel")}</button>
      </div>
    ) : (
      <button disabled={disabled} onClick={() => setConfirming(r)}>
        {label}
      </button>
    );

  const rowLabel = (g: HistoryTaskView) =>
    g.taskId === null ? t("history.earlier") : g.actionId && actions[g.actionId] ? actions[g.actionId].label[lang] : t("history.question");
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
      {groups?.length === 0 && <p>{t("history.empty")}</p>}
      <ol className="hh-history-tasks">
        {groups?.map((g) => {
          const key = keyOf(g);
          const expanded = open.has(key);
          const bodyId = `hh-history-${key}`;
          return (
            <li key={key}>
              <button className="hh-history-row" aria-expanded={expanded} aria-controls={bodyId} onClick={() => toggle(key)}>
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
                  {g.taskId !== null && g.start !== null && goBack({ kind: "task", id: g.taskId }, t("history.restoreTask"))}
                  <ol className="hh-history-entries">
                    {g.entries.map((e) => (
                      <li key={e.sha}>
                        <span>{entryText(e)}</span>
                        <time dateTime={e.date}>{when(e.date)}</time>
                        {goBack({ kind: "point", id: e.sha }, t("history.restore"))}
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
