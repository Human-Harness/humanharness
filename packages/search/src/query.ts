import type MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";
import { FIELD_BOOST } from "./options";
import type { Kind, SearchDoc, SearchHit } from "./types";

export interface QueryOptions {
  /** Absent: every scope ("All scopes", or a harness without scopes). */
  scopes?: readonly string[];
  kinds?: readonly Kind[];
  /** False: leave the reference folders out (the palette's toggle). */
  references?: boolean;
  /** A small boost for the open scope. */
  openScope?: string | null;
  now?: number;
}

export interface QueryResult {
  hits: SearchHit[];
  /** Nothing matched every word: these match some (§5.3 "Showing partial matches"). */
  partial: boolean;
}

export const MAX_QUERY_CHARS = 200;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const RECENT_BOOST = 1.2;
const OPEN_SCOPE_BOOST = 1.1;

function toHit(r: SearchResult): SearchHit {
  return {
    id: String(r.id),
    kind: r.kind as Kind,
    scope: String(r.scope),
    title: String(r.title),
    path: typeof r.path === "string" ? r.path : "",
    at: typeof r.at === "number" ? r.at : 0,
    ...(typeof r.root === "string" ? { root: r.root } : {}),
    ...(r.chat ? { chat: r.chat } : {}),
    ...(typeof r.action === "string" ? { action: r.action } : {}),
    ...(typeof r.task === "string" ? { task: r.task } : {}),
    ...(r.meta ? { meta: r.meta } : {}),
    ...(r.data ? { data: r.data } : {}),
    score: r.score,
    terms: r.terms,
  };
}

/** AND first; with no hit and more than one word, OR (partial). Prefix, fuzzy 0.2 from 4 characters, the boosts. */
export function runQuery(ms: MiniSearch<SearchDoc>, query: string, o: QueryOptions = {}): QueryResult {
  const text = query.trim().slice(0, MAX_QUERY_CHARS);
  if (!text) return { hits: [], partial: false };
  const now = o.now ?? Date.now();
  const options = {
    prefix: true,
    fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
    boost: FIELD_BOOST,
    filter: (r: SearchResult) =>
      (!o.kinds || o.kinds.includes(r.kind as Kind)) && (!o.scopes || o.scopes.includes(String(r.scope))) && (o.references !== false || !String(r.root ?? "").startsWith("ref:")),
    boostDocument: (_id: unknown, _term: string, stored?: Record<string, unknown>) => {
      let b = 1;
      const at = typeof stored?.at === "number" ? stored.at : 0;
      if (at > 0 && now - at < WEEK_MS) b *= RECENT_BOOST;
      if (o.openScope && stored?.scope === o.openScope) b *= OPEN_SCOPE_BOOST;
      return b;
    },
  };
  let results = ms.search(text, { ...options, combineWith: "AND" });
  let partial = false;
  if (results.length === 0 && /\s/.test(text)) {
    results = ms.search(text, { ...options, combineWith: "OR" });
    partial = results.length > 0;
  }
  return { hits: results.map(toHit), partial };
}
