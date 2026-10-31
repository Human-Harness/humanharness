import type { TFunction } from "i18next";
import type { SearchHitView } from "../client";

export const MAX_HINTS = 3;

/**
 * The composer's text for ⌘Enter (§5.4): the query, and a hint block the person sees and may delete before sending.
 * Paths and titles only, never a file's text; a reference file by its name; rows without a hint are skipped.
 */
export function questionText(query: string, hits: readonly SearchHitView[], t: TFunction): string | null {
  const q = query.trim();
  if (!q) return null;
  const named = hits
    .flatMap((h) => (h.hint ? [h.hint] : []))
    .slice(0, MAX_HINTS)
    .map((h) => (h.kind === "path" || h.kind === "name" ? `\`${h.text}\`` : t(h.kind === "note" ? "search.ask.note" : "search.ask.task", { title: h.text })));
  return named.length > 0 ? `${q}\n\n${t("search.ask.related", { list: named.join(", ") })}` : q;
}
