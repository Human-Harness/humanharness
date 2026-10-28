import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "./chrome";
import type { HarnessClient, TimelineEntry } from "./client";
import { EntryDiff } from "./EntryDiff";
import { FileTimeline } from "./FileTimeline";
import { trapTab } from "./focus";

/**
 * A file's timeline outside the reader (file-timeline spec §6.2): any file but a `.md` the reader can open, and a
 * deleted `.md` (Q10). A picked entry's diff takes the list's place; the list stays mounted (hidden) so going back
 * keeps it and its scroll, and focus returns to the entry.
 */
export function FileTimelinePanel({ client, path, busy = false, onClose }: { client: HarnessClient; path: string; busy?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the panel opened: it gets focus back when the panel closes. */
  const opener = useRef<HTMLElement | null>(null);
  /** The entry button that opened the diff: it gets focus back once the list shows again. */
  const from = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    if (picked || !refocus.current) return;
    refocus.current = false;
    const back = from.current;
    (back?.isConnected ? back : closeRef.current)?.focus();
  }, [picked]);
  const close = () => {
    const back = opener.current;
    onClose();
    if (back?.isConnected) back.focus();
  };
  const pick = (entry: TimelineEntry) => {
    from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPicked(entry);
  };
  const leaveDiff = () => {
    refocus.current = true;
    setPicked(null);
  };
  const title = t("timeline.panelTitle", { file: path });
  return (
    <aside
      ref={panel}
      className="hh-timeline-panel"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Tab" && panel.current) trapTab(panel.current, e.nativeEvent);
        // Handled here, it is marked: focus mode's window listener does not also leave.
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        if (picked) leaveDiff();
        else close();
      }}
    >
      <header className="hh-timeline-panel-head">
        <h2>{title}</h2>
        <button ref={closeRef} type="button" className="hh-icon-button" aria-label={t("timeline.close")} onClick={close}>
          <CloseIcon />
        </button>
      </header>
      {picked && <EntryDiff client={client} path={path} entry={picked} busy={busy} backLabel={t("timeline.backToList")} onBack={leaveDiff} />}
      <div hidden={picked !== null}>
        <FileTimeline client={client} path={path} selected={picked?.to} onPick={pick} />
      </div>
    </aside>
  );
}
