import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, TimelineEntry } from "./client";
import { EntryDiff } from "./EntryDiff";
import { FileTimeline } from "./FileTimeline";
import { Icon, Rx } from "./guide";

/**
 * A file's timeline outside the reader (file-timeline spec §6.2), as a split view (DESIGN.md template 2, stage 4b1):
 * any file but a `.md` the reader can open, and a deleted `.md` (Q10). It takes the right part next to the chat, like
 * the reader and the context. A picked entry's diff takes the list's place; the list stays mounted (hidden) so going
 * back keeps it and its scroll, and focus returns to the entry.
 */
export function FileTimelineSplit({ client, path, busy = false, onClose }: { client: HarnessClient; path: string; busy?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  /** The entry button that opened the diff: it gets focus back once the list shows again. */
  const from = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  // Opening (or another file) puts the focus on the title, as the reader does.
  useEffect(() => {
    title.current?.focus();
  }, [path]);
  // A picked entry hides the list (and the entry with the focus): the focus goes to the diff's way back.
  useEffect(() => {
    if (picked) body.current?.querySelector<HTMLElement>("button")?.focus();
  }, [picked]);
  useEffect(() => {
    if (picked || !refocus.current) return;
    refocus.current = false;
    const back = from.current;
    // Without the entry, Cerrar.
    (back?.isConnected ? back : closeRef.current)?.focus();
  }, [picked]);
  const pick = (entry: TimelineEntry) => {
    from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPicked(entry);
  };
  const leaveDiff = () => {
    refocus.current = true;
    setPicked(null);
  };
  return (
    <section
      className="hh-split"
      aria-labelledby={id}
      onKeyDown={(e) => {
        // In a diff, Escape goes back to the list; the split view closes on the next one. Marked handled, so focus
        // mode's window listener does not also act on it.
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (picked) leaveDiff();
        else onClose();
      }}
    >
      <Rx.Flex align="center" justify="between" gap="3" className="hh-split-head">
        <Rx.Flex direction="column" gap="1" minWidth="0">
          <Rx.Heading as="h2" size="3" id={id} ref={title} tabIndex={-1}>
            {t("timeline.title")}
          </Rx.Heading>
          <Rx.Text size="1" color="gray" truncate title={path}>
            {path}
          </Rx.Text>
        </Rx.Flex>
        <Rx.IconButton ref={closeRef} variant="ghost" color="gray" size="2" aria-label={t("timeline.close")} onClick={onClose}>
          <Icon name="close" size={18} />
        </Rx.IconButton>
      </Rx.Flex>
      <div className="hh-split-body" ref={body}>
        {picked && <EntryDiff client={client} path={path} entry={picked} busy={busy} backLabel={t("timeline.backToList")} onBack={leaveDiff} />}
        <div hidden={picked !== null}>
          <FileTimeline client={client} path={path} selected={picked?.to} onPick={pick} />
        </div>
      </div>
    </section>
  );
}
