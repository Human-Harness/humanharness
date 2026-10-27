import { type ReactNode, useRef } from "react";

type Span = readonly [number, number];

/**
 * The text cut at the flagged spans. Spans come from the model too, so they are clamped to the text and a reversed
 * or empty one is skipped; overlapping spans merge.
 */
export function flaggedParts(text: string, spans: readonly Span[]): { text: string; flagged: boolean }[] {
  const clamp = (n: number) => Math.min(Math.max(n, 0), text.length);
  const valid = spans
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .map(([a, b]) => [clamp(a), clamp(b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of valid) {
    const last = merged.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const parts: { text: string; flagged: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) parts.push({ text: text.slice(at, a), flagged: false });
    parts.push({ text: text.slice(a, b), flagged: true });
    at = b;
  }
  if (at < text.length) parts.push({ text: text.slice(at), flagged: false });
  return parts;
}

/**
 * The composer with the card's flagged spans underlined (sidekick spec §7): a backdrop with the same text and metrics
 * sits behind the transparent-backed textarea. Hidden from screen readers: the card says the same in words. The wrapper
 * stays when nothing is flagged so the field keeps its place in the tree (and its focus) as spans come and go; the
 * backdrop follows the field's scroll.
 */
export function FlaggedText({ text, spans, children }: { text: string; spans: readonly Span[]; children: ReactNode }) {
  const parts = flaggedParts(text, spans);
  const backdrop = useRef<HTMLDivElement>(null);
  return (
    <div
      className="hh-sk-flagged"
      onScrollCapture={(e) => {
        if (backdrop.current && e.target instanceof HTMLElement) backdrop.current.scrollTop = e.target.scrollTop;
      }}
    >
      {parts.some((p) => p.flagged) && (
        <div ref={backdrop} className="hh-sk-backdrop" aria-hidden="true">
          {parts.map((p, i) => (p.flagged ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
        </div>
      )}
      {children}
    </div>
  );
}
