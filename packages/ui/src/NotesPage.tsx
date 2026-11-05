import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NoteView } from "./client";
import { Icon, Rx, SecondaryPage } from "./guide";
import { shownLanguage } from "./language";

/**
 * Files › Notes (DESIGN.md "Secondary pages", stage 4b2): the notes of `.harness/notes/` as a list, and one note's
 * detail in the same column. Which note is open is the caller's (`open`), so the top bar's Volver can go back to
 * the list. Only the Notes kind exists yet, so the page has no tabs.
 */
export function NotesPage({
  notes,
  open,
  focusKey,
  disabled,
  onPick,
  onResume,
  onOpenFile,
  onBack,
}: {
  notes: NoteView[];
  /** The note shown in detail; none shows the list. */
  open?: string;
  /** A new value (a rail pick) puts the focus on the page's title. */
  focusKey?: number;
  /** A turn runs: a topic can't be picked up now. */
  disabled: boolean;
  /** A row picked (its slug), or back to the list (undefined). */
  onPick: (slug: string | undefined) => void;
  onResume: (note: NoteView) => void;
  onOpenFile: (path: string) => Promise<boolean>;
  /** From the list: back to the task. */
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(false);
  const note = open ? notes.find((n) => n.slug === open) : undefined;
  const rows = useRef(new Map<string, HTMLButtonElement>());
  /** The note whose detail was on screen: back on the list, its row gets the focus. */
  const left = useRef<string | undefined>(undefined);
  // Entering a detail (or another one) puts the focus on its title, as a rail pick does on the list's.
  const [titleKey, setTitleKey] = useState(0);
  useLayoutEffect(() => {
    setFailed(false);
    if (note) {
      left.current = note.slug;
      setTitleKey((k) => k + 1);
      return;
    }
    const back = left.current;
    left.current = undefined;
    if (back) rows.current.get(back)?.focus();
  }, [note?.slug]);
  useEffect(() => {
    if (focusKey !== undefined) setTitleKey((k) => k + 1);
  }, [focusKey]);

  const when = (iso: string) => {
    // A note dated by day only ("2026-10-30") is that day where the person is, with no time.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = new Date(day ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(shownLanguage(i18n), day ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
  };
  const meta = (n: NoteView) => [when(n.date), t("notes.keyPoints", { count: n.summary.length })].filter(Boolean).join(" · ");
  const openFile = (path: string) => {
    setFailed(false);
    onOpenFile(path).then(
      (ok) => setFailed(!ok),
      () => setFailed(true),
    );
  };

  if (note) {
    return (
      <SecondaryPage
        title={<span dir="auto">{note.title}</span>}
        line={meta(note)}
        focusKey={titleKey}
        onBack={() => onPick(undefined)}
        action={
          <Rx.Flex gap="3" wrap="wrap">
            <Rx.Button variant="soft" color="gray" onClick={() => openFile(note.path)}>
              {t("notes.open")}
            </Rx.Button>
            <Rx.Button disabled={disabled} onClick={() => onResume(note)}>
              {t("notes.resume")}
            </Rx.Button>
          </Rx.Flex>
        }
      >
        {failed && (
          <Rx.Callout.Root color="red" role="alert" mb="4">
            <Rx.Callout.Text>{t("notes.openFailed")}</Rx.Callout.Text>
          </Rx.Callout.Root>
        )}
        <Rx.Heading as="h2" size="1" color="gray" weight="medium" mb="2">
          {t("notes.points")}
        </Rx.Heading>
        <Rx.Box asChild pl="5" mt="0" mb="5">
          <ul className="hh-notes-points">
            {note.summary.map((s, i) => (
              <Rx.Text asChild size="2" key={i}>
                <li dir="auto">{s}</li>
              </Rx.Text>
            ))}
          </ul>
        </Rx.Box>
        <Rx.Text as="p" size="1" color="gray" className="hh-gd-path">
          {note.path}
        </Rx.Text>
      </SecondaryPage>
    );
  }

  return (
    <SecondaryPage title={t("files.title")} line={t("notes.savings")} focusKey={titleKey} onBack={onBack}>
      <section aria-labelledby="hh-notes-head">
        <Rx.Flex align="center" gap="2" mb="2">
          <Rx.Heading as="h2" size="1" color="gray" weight="medium" id="hh-notes-head">
            {t("notes.list")}
          </Rx.Heading>
          {notes.length > 0 && (
            <Rx.Badge color="gray" variant="outline">
              {t("notes.count", { count: notes.length })}
            </Rx.Badge>
          )}
        </Rx.Flex>
        {notes.length === 0 ? (
          <Rx.Text as="p" size="2" color="gray">
            {t("notes.empty")}
          </Rx.Text>
        ) : (
          <ul className="hh-gd-list">
            {notes.map((n) => (
              <li key={n.slug}>
                <button
                  type="button"
                  className="hh-notes-row"
                  ref={(el) => {
                    if (el) rows.current.set(n.slug, el);
                    else rows.current.delete(n.slug);
                  }}
                  onClick={() => onPick(n.slug)}
                >
                  <Rx.Flex direction="column" gap="1" minWidth="0" flexGrow="1">
                    <Rx.Text size="2" weight="bold" dir="auto">
                      {n.title}
                    </Rx.Text>
                    <Rx.Text size="1" color="gray">
                      {meta(n)}
                    </Rx.Text>
                  </Rx.Flex>
                  <Icon name="chevron" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Rx.Text as="p" size="1" color="gray" mt="5">
        {t("notes.footer")}
      </Rx.Text>
    </SecondaryPage>
  );
}
