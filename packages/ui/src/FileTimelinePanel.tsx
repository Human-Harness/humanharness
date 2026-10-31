import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, TimelineEntry } from "./client";
import { Drawer } from "./Drawer";
import { EntryDiff } from "./EntryDiff";
import { FileTimeline } from "./FileTimeline";

/**
 * A file's timeline outside the reader (file-timeline spec §6.2): any file but a `.md` the reader can open, and a
 * deleted `.md` (Q10). A picked entry's diff takes the list's place; the list stays mounted (hidden) so going back
 * keeps it and its scroll, and focus returns to the entry.
 */
export function FileTimelinePanel({ client, path, busy = false, onClose }: { client: HarnessClient; path: string; busy?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const body = useRef<HTMLDivElement>(null);
  /** What had focus when the panel opened (read before the drawer takes focus): it gets focus back when the panel closes. */
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  /** The entry button that opened the diff: it gets focus back once the list shows again. */
  const from = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (picked || !refocus.current) return;
    refocus.current = false;
    const back = from.current;
    // Without the entry, the drawer's Close.
    (back?.isConnected ? back : body.current?.closest<HTMLElement>("[role=dialog]")?.querySelector<HTMLElement>(".hh-drawer-head button"))?.focus();
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
    <Drawer
      title={title}
      wide
      focusClose
      onClose={close}
      onKeyDown={(e) => {
        // In a diff, Escape goes back to the list; the drawer closes on the next one. Marked handled, so neither the
        // drawer nor focus mode's window listener also acts on it.
        if (e.key !== "Escape" || e.defaultPrevented || !picked) return;
        e.preventDefault();
        e.stopPropagation();
        leaveDiff();
      }}
    >
      <div ref={body} className="hh-timeline-panel">
        {picked && <EntryDiff client={client} path={path} entry={picked} busy={busy} backLabel={t("timeline.backToList")} onBack={leaveDiff} />}
        <div hidden={picked !== null}>
          <FileTimeline client={client} path={path} selected={picked?.to} onPick={pick} />
        </div>
      </div>
    </Drawer>
  );
}
