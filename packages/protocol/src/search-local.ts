// Settings and actions in ⌘K (search spec §6): matched in the window, never stored (§4.2, plan deviations 1–2).
import type { SearchMarked } from "./views";

/** Case and accents folded, as `packages/search` folds the index (`fold`). */
export const foldText = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const words = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 2: every typed word starts a word of the label; 1: of the label, its section or a keyword; 0: no match. */
export function localScore(query: string, label: string, extra: readonly string[]): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const own = words(label);
  if (q.every((w) => own.some((x) => x.startsWith(w)))) return 2;
  const all = [...own, ...extra.flatMap(words)];
  return q.every((w) => all.some((x) => x.startsWith(w))) ? 1 : 0;
}

/** The label with the typed prefix of each matching word marked. */
export function markLocal(label: string, query: string): SearchMarked {
  const q = words(query).sort((a, b) => b.length - a.length);
  const out: SearchMarked = [];
  let at = 0;
  for (const m of label.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = q.find((x) => foldText(m[0]).startsWith(x));
    if (!w || m.index === undefined) continue;
    const end = m.index + Math.min(w.length, m[0].length);
    if (m.index > at) out.push({ text: label.slice(at, m.index) });
    out.push({ text: label.slice(m.index, end), mark: true });
    at = end;
  }
  if (at < label.length) out.push({ text: label.slice(at) });
  return out;
}
