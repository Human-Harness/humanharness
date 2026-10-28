import { refusedShape } from "@humanharness/harness-sdk/documents";
import type { DocumentCard } from "./client";

/** A turn makes at most this many cards (the runtime's cap); a chat file asking for more is cut. */
const MAX_DOCUMENT_CARDS = 20;

/**
 * The well-formed cards of a chat entry (document-reader spec §5.1). The chat log is read from disk unchecked, so a
 * card is kept only with a plain relative string path, a string title, a string kind when present, a known change and
 * a finite word count, and only the first card of a path; it is rebuilt from those fields alone.
 */
export function cleanDocumentCards(value: unknown): DocumentCard[] {
  if (!Array.isArray(value)) return [];
  const out: DocumentCard[] = [];
  // One card per path: a chat file repeating one draws it once.
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= MAX_DOCUMENT_CARDS) break;
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.path !== "string" || refusedShape(c.path) || typeof c.title !== "string") continue;
    if (c.change !== "new" && c.change !== "updated") continue;
    if (typeof c.words !== "number" || !Number.isFinite(c.words) || c.words < 0) continue;
    if (c.kind !== undefined && typeof c.kind !== "string") continue;
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push({ path: c.path, title: c.title, ...(typeof c.kind === "string" ? { kind: c.kind } : {}), change: c.change, words: c.words });
  }
  return out;
}
