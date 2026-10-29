/** Sidekick's mark: a small speech bubble with a spark. Colour from the token, grey when off. */
export function SidekickMark({ off, size = 20 }: { off?: boolean; size?: number }) {
  return (
    <svg className={`hh-sk-mark${off ? " hh-sk-mark-off" : ""}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 4h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 6.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" />
    </svg>
  );
}
