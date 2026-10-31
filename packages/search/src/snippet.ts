import { fold } from "./options";

/** A title or a line of context: plain runs, the first match `mark`ed. Never HTML. */
export type Marked = { text: string; mark?: true }[];

export const SNIPPET_CHARS = 120;

/** The folded text, and for each of its characters the index in the original where it came from (plus the end). */
function foldMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(text.length);
  return { folded, at };
}

/** Where the earliest of `terms` (folded, as the index matched them) is in `text`, in original indices. */
export function firstMatch(text: string, terms: readonly string[]): { start: number; end: number } | null {
  const { folded, at } = foldMap(text);
  let best: { i: number; len: number } | null = null;
  for (const term of terms) {
    if (!term) continue;
    const i = folded.indexOf(term);
    if (i >= 0 && (best === null || i < best.i)) best = { i, len: term.length };
  }
  return best ? { start: at[best.i], end: at[best.i + best.len] } : null;
}

const parts = (before: string, match: string, after: string): Marked =>
  [{ text: before }, { text: match, mark: true as const }, { text: after }].filter((p) => p.text !== "");

export function markFirst(text: string, terms: readonly string[]): Marked {
  const m = firstMatch(text, terms);
  return m ? parts(text.slice(0, m.start), text.slice(m.start, m.end), text.slice(m.end)) : [{ text }];
}

/** Moves `i` off the low half of a surrogate pair. */
const safe = (s: string, i: number) => (i > 0 && i < s.length && /[\uDC00-\uDFFF]/.test(s[i]) ? i - 1 : i);
const squash = (s: string) => s.replace(/\s+/g, " ");

/** About `width` characters around the first match, its line breaks squashed; `at`: the match's index in `text`. */
export function snippetAround(text: string, terms: readonly string[], width = SNIPPET_CHARS): { marked: Marked; at: number } | null {
  const m = firstMatch(text, terms);
  if (!m) return null;
  const room = Math.max(0, width - (m.end - m.start));
  const from = safe(text, Math.max(0, m.start - Math.floor(room / 3)));
  const to = safe(text, Math.min(text.length, m.end + room - (m.start - from)));
  const before = `${from > 0 ? "…" : ""}${squash(text.slice(from, m.start)).trimStart()}`;
  const after = `${squash(text.slice(m.end, to)).trimEnd()}${to < text.length ? "…" : ""}`;
  return { marked: parts(before, text.slice(m.start, m.end), after), at: m.start };
}
