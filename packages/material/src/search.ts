import MiniSearch from "minisearch";
import type { Fragment } from "./types";

/** Lowercase, accents folded (`Fracción` finds `fraccion`), for the text and the query alike. */
const fold = (term: string) => term.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

export interface SearchHit {
  id: string;
  where: string;
  path: string;
  summary: string;
}

/** Search over one scope's fragments (§9 Fetch): text, summary, keywords and heading path; prefix and fuzzy matches. */
export class MaterialSearch {
  private constructor(private readonly index: MiniSearch<{ id: string; md: string; summary: string; keywords: string; path: string; where: string }>) {}

  /** Built per call: a scope holds hundreds of fragments at most, and a hand edit shows at once. */
  static of(fragments: Fragment[]): MaterialSearch {
    const index = new MiniSearch({
      fields: ["md", "summary", "keywords", "path"],
      storeFields: ["where", "path", "summary"],
      processTerm: fold,
      searchOptions: { boost: { keywords: 3, summary: 2, path: 2 }, prefix: true, fuzzy: 0.2 },
    });
    // A hand-edited registry may list one fragment twice: MiniSearch refuses a duplicate id.
    const seen = new Set<string>();
    const unique = fragments.filter((f) => f.meta.validated !== "pending" && !seen.has(f.meta.id) && seen.add(f.meta.id));
    index.addAll(unique.map((f) => ({ id: f.meta.id, md: f.md, summary: f.meta.summary, keywords: f.meta.keywords.join(" "), path: f.meta.path, where: `${f.meta.source}, ${f.meta.location}` })));
    return new MaterialSearch(index);
  }

  search(query: string, limit = 8): SearchHit[] {
    return this.index
      .search(query.slice(0, 200))
      .slice(0, limit)
      .map((r) => ({ id: String(r.id), where: String(r.where), path: String(r.path), summary: String(r.summary) }));
  }
}
