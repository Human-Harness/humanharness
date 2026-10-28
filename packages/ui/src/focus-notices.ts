/** What focus mode held back (§6.2): the three notices that exist today (Conflicts 4). */
export interface Paused {
  waiting: boolean;
  quota: boolean;
  proposals: number;
}
export const NO_PAUSED: Paused = { waiting: false, quota: false, proposals: 0 };

export function countPaused(p: Paused, e: { waiting?: boolean; quota?: boolean; proposal?: boolean }): Paused {
  return { waiting: p.waiting || e.waiting === true, quota: p.quota || e.quota === true, proposals: p.proposals + (e.proposal ? 1 : 0) };
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The line shown on leaving focus mode, or null when nothing was held back. */
export function pausedSummary(t: T, p: Paused): string | null {
  const items = [
    ...(p.waiting ? [t("focus.waiting")] : []),
    ...(p.quota ? [t("focus.quota")] : []),
    ...(p.proposals > 0 ? [t("focus.proposal", { count: p.proposals })] : []),
  ];
  return items.length > 0 ? t("focus.summary", { items: items.join(", ") }) : null;
}
