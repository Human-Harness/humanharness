import { useState } from "react";

/**
 * The messages that came while the reader was scrolled up (task view one column): the count is taken when they
 * leave the end, and the difference is what the jump pill shows. Back at the end, nothing is new.
 */
export function useNewSinceScroll(count: number) {
  const [since, setSince] = useState<number | null>(null);
  return {
    newCount: since === null ? 0 : Math.max(0, count - since),
    /** Each scroll: at the end or not. */
    report: (atEnd: boolean) => setSince((s) => (atEnd ? null : (s ?? count))),
  };
}
