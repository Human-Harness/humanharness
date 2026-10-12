import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { NoteView } from "./client";

/** "Lo que quedó claro": the notes of `.harness/notes/`, one opened at a time. */
export function NotesPanel({
  notes,
  expanded,
  lang,
  disabled,
  onResume,
  onOpen,
  onClose,
}: {
  notes: NoteView[];
  /** The note to open first; default the newest. */
  expanded?: string;
  lang: Language;
  /** A turn runs: a topic can't be picked up now. */
  disabled: boolean;
  onResume: (note: NoteView) => void;
  onOpen: (path: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(expanded ?? notes[0]?.slug);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(lang, { dateStyle: "short", timeStyle: "short" });
  };
  const openFile = (path: string) => {
    setFailed(false);
    onOpen(path).then(
      (ok) => setFailed(!ok),
      () => setFailed(true),
    );
  };

  return (
    <aside className="hh-notes" role="dialog" aria-modal="true" aria-labelledby="hh-notes-title">
      <header>
        <h2 id="hh-notes-title">{t("notes.title")}</h2>
        <button ref={closeRef} type="button" onClick={onClose}>
          {t("notes.close")}
        </button>
      </header>
      {failed && (
        <p role="alert" className="hh-warn">
          {t("notes.openFailed")}
        </p>
      )}
      {notes.length === 0 ? (
        <p className="hh-caption">{t("notes.empty")}</p>
      ) : (
        <ul className="hh-rows hh-note-cards">
          {notes.map((n) =>
            n.slug === open ? (
              <li key={n.slug} className="hh-note open">
                <div className="hh-note-head">
                  <strong>{n.title}</strong>
                  <time className="hh-caption">{when(n.date)}</time>
                </div>
                <ul>
                  {n.summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <code className="hh-caption">{n.path}</code>
                <div className="hh-note-actions">
                  <button type="button" disabled={disabled} onClick={() => onResume(n)}>
                    {t("notes.resume")}
                  </button>
                  <button type="button" onClick={() => openFile(n.path)}>
                    {t("notes.open")}
                  </button>
                </div>
              </li>
            ) : (
              <li key={n.slug} className="hh-note">
                <button type="button" className="hh-note-toggle" aria-expanded={false} onClick={() => setOpen(n.slug)}>
                  <span className="hh-note-head">
                    <strong>{n.title}</strong>
                    <time className="hh-caption">{when(n.date)}</time>
                  </span>
                  <span className="hh-caption">
                    {t("notes.keyPoints", { count: n.summary.length })} · <code>{n.path}</code>
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="hh-notes-savings">{t("notes.savings")}</p>
      <p className="hh-caption">{t("notes.footer")}</p>
    </aside>
  );
}
