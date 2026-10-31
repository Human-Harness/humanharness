import { fold } from "./options";

/** A title or a line of context: plain runs, the first match `mark`ed. Never HTML. */
export type Marked = { text: string; mark?: true }[];

export const SNIPPET_CHARS = 120;

/**
 * The folded text, and `at`: for an index into it, the index in the original where that character came from (the
 * text's length at the end). Each code point is folded on its own, as before; an ASCII one folds to its lowercase, so
 * a run of them is folded in one go and maps one to one (a fold call per character took ~130 ms a megabyte).
 */
function foldMap(text: string): { folded: string; at: (i: number) => number } {
  const parts: string[] = [];
  // One segment per ASCII run (`linear`) or per non-ASCII code point whose fold isn't empty (all of it maps there).
  const fromF: number[] = [];
  const fromO: number[] = [];
  const linear: boolean[] = [];
  let f = 0;
  const segment = (folded: string, from: number, isRun: boolean) => {
    parts.push(folded);
    fromF.push(f);
    fromO.push(from);
    linear.push(isRun);
    f += folded.length;
  };
  let i = 0;
  const re = /[^\x00-\x7f]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // The low half of a pair already folded with its high half.
    if (m.index < i) continue;
    if (m.index > i) segment(text.slice(i, m.index).toLowerCase(), i, true);
    const ch = String.fromCodePoint(text.codePointAt(m.index)!);
    const folded = fold(ch);
    if (folded) segment(folded, m.index, false);
    i = m.index + ch.length;
  }
  if (i < text.length) segment(text.slice(i).toLowerCase(), i, true);
  const at = (fi: number) => {
    if (fi >= f) return text.length;
    let lo = 0;
    let hi = fromF.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fromF[mid] <= fi) lo = mid;
      else hi = mid - 1;
    }
    return linear[lo] ? fromO[lo] + (fi - fromF[lo]) : fromO[lo];
  };
  return { folded: parts.join(""), at };
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
  return best ? { start: at(best.i), end: at(best.i + best.len) } : null;
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
