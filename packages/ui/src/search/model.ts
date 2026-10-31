import { SEARCH_INDEX_KINDS, type SearchAnswer, type SearchHitView, type SearchRowKind } from "../client";

export interface Section {
  key: SearchRowKind | "recent";
  hits: SearchHitView[];
}

/** §5.2: nothing typed shows the recents; otherwise the groups in the order main sends them (§3). */
export function sectionsOf(a: SearchAnswer | null): Section[] {
  if (!a?.ok) return [];
  if (!a.query.trim()) return a.recent.length > 0 ? [{ key: "recent", hits: a.recent }] : [];
  return a.groups.map((g) => ({ key: g.kind, hits: g.hits }));
}

/** ↑↓ move across groups: one flat list of rows. */
export const rowsOf = (sections: readonly Section[]): SearchHitView[] => sections.flatMap((s) => s.hits);

/** §5.5: "All · N", then one chip per kind that has results. `kind` null: All. */
export interface Chip {
  kind: SearchRowKind | null;
  count: number;
}

export function chipsOf(a: SearchAnswer | null): Chip[] {
  if (!a?.ok || !a.query.trim()) return [];
  const count = (k: SearchRowKind) => (k === "data" ? (a.counts.data ?? 0) : a.counts[k]);
  const all = SEARCH_INDEX_KINDS.reduce((n, k) => n + count(k), 0);
  if (all === 0) return [];
  return [{ kind: null, count: all }, ...SEARCH_INDEX_KINDS.filter((k) => count(k) > 0).map((k) => ({ kind: k, count: count(k) }))];
}

export const step = (i: number, delta: number, length: number): number => (length === 0 ? 0 : Math.min(length - 1, Math.max(0, i + delta)));
