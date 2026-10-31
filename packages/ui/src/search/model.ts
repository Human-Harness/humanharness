import { SEARCH_INDEX_KINDS, type SearchAnswer, type SearchHitView, type SearchRowKind } from "../client";

export interface Section {
  key: SearchRowKind | "recent";
  hits: SearchHitView[];
}

/** The window's own rows for the query they were built for (§6). */
export interface LocalRows {
  query: string;
  setting: SearchHitView[];
  command: SearchHitView[];
}

/** §3's order: Tasks, Notes, Files, Settings, Actions, Data. */
export const SEARCH_ROW_KINDS: readonly SearchRowKind[] = ["task", "note", "file", "setting", "command", "data"];
const LOCAL_PER_GROUP = 5;
const LOCAL_PER_KIND = 50;
const isLocal = (k: SearchRowKind): k is "setting" | "command" => k === "setting" || k === "command";

/**
 * §5.2: nothing typed shows the recents (and, with local rows, the available actions after them); otherwise the groups
 * in §3's order, main's and the window's merged. `kind`: the chip pressed. Without main's answer, only the window's.
 */
export function sectionsOf(a: SearchAnswer | null, local?: LocalRows, kind: SearchRowKind | null = null): Section[] {
  if (!local) {
    if (!a?.ok) return [];
    if (!a.query.trim()) return a.recent.length > 0 ? [{ key: "recent", hits: a.recent }] : [];
    return a.groups.map((g) => ({ key: g.kind, hits: g.hits }));
  }
  // Main not ready or failing (or not answered yet): the window's own rows only; Settings and Actions need no index.
  const recent = a?.ok ? a.recent : [];
  if (!local.query.trim()) {
    return [...(recent.length > 0 ? [{ key: "recent" as const, hits: recent }] : []), ...(local.command.length > 0 ? [{ key: "command" as const, hits: local.command }] : [])];
  }
  const fromMain = new Map<SearchRowKind, SearchHitView[]>(a?.ok ? a.groups.map((g) => [g.kind, g.hits]) : []);
  const cap = kind ? LOCAL_PER_KIND : LOCAL_PER_GROUP;
  return SEARCH_ROW_KINDS.filter((k) => !kind || k === kind)
    .map((k) => ({ key: k, hits: isLocal(k) ? local[k].slice(0, cap) : (fromMain.get(k) ?? []) }))
    .filter((s) => s.hits.length > 0);
}

/** ↑↓ move across groups: one flat list of rows. */
export const rowsOf = (sections: readonly Section[]): SearchHitView[] => sections.flatMap((s) => s.hits);

/** §5.5: "All · N", then one chip per kind that has results. `kind` null: All. */
export interface Chip {
  kind: SearchRowKind | null;
  count: number;
}

/** Main counts every match of a kind, beyond the rows it sends; a local kind counts every row that matched, likewise. */
export function chipsOf(a: SearchAnswer | null, local?: LocalRows): Chip[] {
  if (!a?.ok || !a.query.trim()) return [];
  const count = (k: SearchRowKind) => (isLocal(k) ? (local?.query.trim() ? local[k].length : 0) : k === "data" ? (a.counts.data ?? 0) : a.counts[k]);
  const kinds = local ? SEARCH_ROW_KINDS : SEARCH_INDEX_KINDS;
  const all = kinds.reduce((n, k) => n + count(k), 0);
  if (all === 0) return [];
  return [{ kind: null, count: all }, ...kinds.filter((k) => count(k) > 0).map((k) => ({ kind: k, count: count(k) }))];
}

export const step = (i: number, delta: number, length: number): number => (length === 0 ? 0 : Math.min(length - 1, Math.max(0, i + delta)));
