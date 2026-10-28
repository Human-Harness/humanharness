/**
 * A sidekick's mark: `"spark"` (or none) is the core's small speech bubble with a spark, colour from the token, grey
 * when off; any other mark (an emoji) is shown as text.
 */
export function SidekickMark({ off, size = 20, mark = "spark" }: { off?: boolean; size?: number; mark?: string }) {
  if (mark !== "spark") {
    return (
      <span className={`hh-sk-mark hh-sk-mark-text${off ? " hh-sk-mark-off" : ""}`} style={{ fontSize: size * 0.8 }} aria-hidden="true">
        {mark}
      </span>
    );
  }
  return (
    <svg className={`hh-sk-mark${off ? " hh-sk-mark-off" : ""}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 6.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" />
    </svg>
  );
}
