import { createContext } from "react";

/** How the chat draws `[[frag:<id>]]` (material spec §9): the label "<source>, <location>" and opening the original. */
export interface CitationResolver {
  /** Null: no such fragment (the text stays as it is). */
  label(id: string): Promise<string | null>;
  open(id: string): void;
  /** A label already looked up, for text read aloud (`markdownToPlain`); undefined while it isn't known. */
  known?(id: string): string | undefined;
}

/** Null outside a harness with material: citations stay text (D0). */
export const CitationContext = createContext<CitationResolver | null>(null);

/** A citation: the fragment id pattern of `@humanharness/material` (`<source id>-<nnn>`). */
const CITATION = /\[\[frag:([a-z0-9][a-z0-9-]{0,63}-\d{3,4})\]\]/g;

/**
 * Text read aloud: each citation (and the space before it) becomes " (<label>)" when `label` knows it, else nothing,
 * so a screen reader never spells out the marker.
 */
export function plainCitations(text: string, label?: (id: string) => string | undefined): string {
  return text.replace(/\s*\[\[frag:([a-z0-9][a-z0-9-]{0,63}-\d{3,4})\]\]/g, (_m, id: string) => {
    const l = label?.(id);
    return l ? ` (${l})` : "";
  });
}

/** Text into plain runs and citation ids. */
export function splitCitations(text: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
