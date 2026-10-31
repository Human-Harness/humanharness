import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "./chrome";
import type { NoteView } from "./client";
import { Drawer } from "./Drawer";
import { shownLanguage } from "./language";

/** "What's clear so far": the notes of `.harness/notes/`, one opened at a time. */
export function NotesPanel({
  notes,
  expanded,
  disabled,
  onResume,
  onOpen,
  onClose,
}: {
  notes: NoteView[];
  /** The note to open first; default the newest. */
  expanded?: string;
  /** A turn runs: a topic can't be picked up now. */
  disabled: boolean;
  onResume: (note: NoteView) => void;
  onOpen: (path: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string | undefined>(expanded ?? notes[0]?.slug);
  const [failed, setFailed] = useState(false);
  /** What had focus when the panel opened (read before the drawer takes focus): it gets focus back when the panel closes. */
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Reads only refs, so the Escape listener added on the first render can call it.
  const close = () => {
    const back = opener.current;
    onCloseRef.current();
    if (back?.isConnected) back.focus();
  };
  useEffect(() => {
    // The drawer hears an Escape inside it; this one hears it anywhere else (focus left on the page).
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
  // Another note asked for while the panel is open (from the side panel) opens that one.
  useEffect(() => {
    if (expanded) setOpen(expanded);
  }, [expanded]);

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(shownLanguage(i18n), { dateStyle: "short", timeStyle: "short" });
  };
  const openFile = (path: string) => {
    setFailed(false);
    onOpen(path).then(
      (ok) => setFailed(!ok),
      () => setFailed(true),
    );
  };

  return (
    <Drawer title={t("notes.title")} subtitle={notes.length > 0 ? t("notes.count", { count: notes.length }) : undefined} focusClose onClose={close}>
      <div className="hh-notes">
        <p className="hh-notes-savings">{t("notes.savings")}</p>
        {failed && (
          <p role="alert" className="hh-warn">
            {t("notes.openFailed")}
          </p>
        )}
        {notes.length === 0 ? (
          <p className="hh-caption">{t("notes.empty")}</p>
        ) : (
          <ul className="hh-note-cards">
            {notes.map((n) => {
              const isOpen = n.slug === open;
              return (
                <li key={n.slug} className={isOpen ? "hh-card hh-note open" : "hh-card hh-note"}>
                  {/* The same button in both states, so focus stays on it when the note opens or closes. */}
                  <button type="button" className="hh-note-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : n.slug)}>
                    <span className="hh-note-head">
                      <strong>{n.title}</strong>
                      <time className="hh-caption">{when(n.date)}</time>
                    </span>
                    <span className="hh-note-meta">
                      <Tag tone="blue">{t("notes.keyPoints", { count: n.summary.length })}</Tag>
                      {!isOpen && <code className="hh-caption">{n.path}</code>}
                    </span>
                  </button>
                  {isOpen && (
                    <>
                      <ul>
                        {n.summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                      <code className="hh-caption">{n.path}</code>
                      <div className="hh-note-actions">
                        <button type="button" className="hh-pill" disabled={disabled} onClick={() => onResume(n)}>
                          {t("notes.resume")}
                        </button>
                        <button type="button" className="hh-pill" onClick={() => openFile(n.path)}>
                          {t("notes.open")}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="hh-caption">{t("notes.footer")}</p>
      </div>
    </Drawer>
  );
}
