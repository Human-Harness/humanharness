import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewComment } from "./client";

/** Margin dots beside the marks in focus mode (§6.2): the column is hidden; a dot opens its card. */
export function FocusMarkers({ comments, ranges, host, onPick }: { comments: ReviewComment[]; ranges: Map<string, Range>; host: HTMLElement | null; onPick(id: string): void }) {
  const { t } = useTranslation();
  const [tops, setTops] = useState<{ id: string; top: number; text: string }[]>([]);
  useLayoutEffect(() => {
    if (!host) return setTops([]);
    const base = host.getBoundingClientRect().top - host.scrollTop;
    setTops(
      comments.flatMap((c) => {
        const r = ranges.get(c.id);
        return r && c.state !== "resolved" ? [{ id: c.id, top: r.getBoundingClientRect().top - base, text: c.text }] : [];
      }),
    );
  }, [comments, ranges, host]);
  return (
    <div className="hh-focus-markers">
      {tops.map((m) => (
        <button key={m.id} type="button" className="hh-focus-marker" style={{ top: m.top }} aria-label={t("focus.marker", { text: m.text })} onClick={() => onPick(m.id)} />
      ))}
    </div>
  );
}
