import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SidekickLearned } from "../client";

type Level = SidekickLearned["level"];

/**
 * "What Sidekick learned" (spec §6.4, mockup board 6): both levels in two columns, "Forget this" per item, "Edit" as
 * an editable list (edited items become the person's), and "Forget everything" after one confirmation.
 */
export function LearnedList({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SidekickLearned[]>([]);
  /** The texts being edited by id (only the touched ones); null when not editing. */
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((n) => n + 1), []);
  const ids = useId();
  const confirmTextId = `${ids}-confirm`;
  const yesRef = useRef<HTMLButtonElement>(null);
  const forgetAllRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  /** The button that opened the closing view, to focus once it is back (it is not mounted while the view is open). */
  const back = useRef<"edit" | "forgetAll" | null>(null);
  const isEditing = editing !== null;

  // Every view switch moves focus into the new view, and back to its opener when it closes (as in HistoryPanel).
  useEffect(() => {
    if (confirm) yesRef.current?.focus();
    else if (isEditing) firstInputRef.current?.focus();
    else if (back.current) {
      (back.current === "edit" ? editRef : forgetAllRef).current?.focus();
      back.current = null;
    }
  }, [confirm, isEditing]);

  useEffect(() => {
    let live = true;
    client.sidekick.learned().then(
      (list) => live && setItems(list),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [client, loads]);

  // Every change: the list is read again afterwards, whatever happened; a failure says why.
  const run = (change: () => Promise<void>) => {
    setFailed(null);
    change()
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)))
      .finally(reload);
  };

  const save = () => {
    if (!editing) return;
    const changes = Object.entries(editing)
      .map(([id, text]) => ({ id, text: text.trim() }))
      .filter(({ id, text }) => text && items.find((i) => i.id === id)?.text !== text);
    back.current = "edit";
    setEditing(null);
    if (changes.length) run(() => client.sidekick.editLearned(changes));
  };

  // The first input on screen: the "About you" column comes first.
  const first = items.find((i) => i.level === "you") ?? items[0];
  const column = (level: Level, label: string) => {
    const mine = items.filter((i) => i.level === level);
    return (
      <section aria-label={label} className="hh-sk-learned-col">
        <h4>{label}</h4>
        {mine.length === 0 && <p className="hh-caption">{t("sidekick.learned.empty")}</p>}
        <ul className="hh-sk-learned-items">
          {mine.map((i) => (
            <li key={i.id}>
              {editing ? (
                <input
                  ref={i === first ? firstInputRef : undefined}
                  type="text"
                  value={editing[i.id] ?? i.text}
                  aria-label={i.text}
                  maxLength={300}
                  onChange={(e) => setEditing({ ...editing, [i.id]: e.target.value })}
                />
              ) : (
                <>
                  <span id={`${ids}-${i.id}`}>{i.text}</span>
                  {i.source === "person" && <span className="hh-caption"> · {t("sidekick.learned.yours")}</span>}{" "}
                  <button
                    type="button"
                    className="hh-link"
                    aria-describedby={`${ids}-${i.id}`}
                    onClick={() => run(() => client.sidekick.forget(i.id))}
                  >
                    {t("sidekick.learned.forget")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="hh-sk-learned">
      <h3>{t("sidekick.learned.title")}</h3>
      <div className="hh-sk-learned-cols">
        {column("you", t("sidekick.learned.you"))}
        {column("harness", t("sidekick.learned.harness"))}
      </div>
      {editing ? (
        <div className="hh-sk-actions">
          <button type="button" className="hh-primary" onClick={save}>
            {t("sidekick.learned.save")}
          </button>
          <button
            type="button"
            onClick={() => {
              back.current = "edit";
              setEditing(null);
            }}
          >
            {t("sidekick.learned.cancel")}
          </button>
        </div>
      ) : confirm ? (
        <div className="hh-sk-actions">
          <p id={confirmTextId}>{t("sidekick.learned.confirmAllText")}</p>
          <button
            ref={yesRef}
            type="button"
            aria-describedby={confirmTextId}
            onClick={() => {
              setConfirm(false);
              run(() => client.sidekick.forgetAll());
            }}
          >
            {t("sidekick.learned.confirmAll")}
          </button>
          <button
            type="button"
            onClick={() => {
              back.current = "forgetAll";
              setConfirm(false);
            }}
          >
            {t("sidekick.learned.cancel")}
          </button>
        </div>
      ) : (
        <div className="hh-sk-actions">
          <button ref={editRef} type="button" onClick={() => setEditing({})} disabled={items.length === 0}>
            {t("sidekick.learned.edit")}
          </button>
          <button ref={forgetAllRef} type="button" onClick={() => setConfirm(true)} disabled={items.length === 0}>
            {t("sidekick.learned.forgetAll")}
          </button>
        </div>
      )}
      {failed !== null && <p role="alert">{t("sidekick.settings.failed", { message: failed })}</p>}
    </div>
  );
}
