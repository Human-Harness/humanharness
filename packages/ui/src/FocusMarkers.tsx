import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewComment } from "./client";

/**
 * Margin dots beside the marks in focus mode (§6.2): the column is hidden; a dot opens its card. They are placed
 * again when the window (or the text's box) resizes and when the text's look (font, size) changes, since the marks move.
 */
export function FocusMarkers({
  comments,
  ranges,
  host,
  look,
  open,
  onPick,
}: {
  comments: ReviewComment[];
  ranges: Map<string, Range>;
  host: HTMLElement | null;
  /** The reader's font and size: a change moves the marks. */
  look: string;
  /** The card a marker opened now (its marker is expanded). */
  open: string | null;
  onPick(id: string): void;
}) {
  const { t } = useTranslation();
  const [tops, setTops] = useState<{ id: string; top: number; text: string }[]>([]);
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const again = () => setResized((n) => n + 1);
    window.addEventListener("resize", again);
    const box = typeof ResizeObserver === "function" && host ? new ResizeObserver(again) : null;
    if (box && host) box.observe(host);
    return () => {
      window.removeEventListener("resize", again);
      box?.disconnect();
    };
  }, [host]);
  useLayoutEffect(() => {
    if (!host) return setTops([]);
    const base = host.getBoundingClientRect().top - host.scrollTop;
    setTops(
      comments.flatMap((c) => {
        const r = ranges.get(c.id);
        return r && c.state !== "resolved" ? [{ id: c.id, top: r.getBoundingClientRect().top - base, text: c.text }] : [];
      }),
    );
  }, [comments, ranges, host, look, resized]);
  return (
    <div className="hh-focus-markers">
      {tops.map((m) => (
        <button
          key={m.id}
          type="button"
          className="hh-focus-marker"
          data-comment={m.id}
          style={{ top: m.top }}
          aria-label={t("focus.marker", { text: m.text })}
          aria-expanded={open === m.id}
          onClick={() => onPick(m.id)}
        />
      ))}
    </div>
  );
}
