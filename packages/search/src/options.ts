import type { Options } from "minisearch";
import type { SearchDoc } from "./types";

/** Bumped when the snapshot's shape or the options change: an older snapshot is thrown away and rebuilt (§4.1). */
export const INDEX_VERSION = 1;

/** Lowercase, accents folded (`Fracción` finds `fraccion`): the text and the query alike (§5.3). */
export const fold = (term: string): string => term.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** Only what a row shows and what opening it needs; never the text (§4.1). */
export const STORE_FIELDS = ["kind", "scope", "title", "path", "at", "root", "chat", "action", "task", "meta"] as const;

/** §5.3: title ×3, path or name ×2, text ×1. */
export const FIELD_BOOST = { title: 3, path: 2, text: 1 };

export function indexOptions(): Options<SearchDoc> {
  return {
    idField: "id",
    fields: ["title", "path", "text"],
    storeFields: [...STORE_FIELDS],
    processTerm: (term) => fold(term) || null,
  };
}
