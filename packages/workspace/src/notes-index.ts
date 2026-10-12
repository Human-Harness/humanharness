import type { Note } from "./notes";

/** About how many tokens the index may take in a session's first message (spec §5.2). */
export const INDEX_BUDGET_TOKENS = 1500;

/** Rough token count: characters / 4. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Shape {
  /** The newest notes that keep their summary. */
  summaries: number;
  /** The newest notes whose decisions are listed. */
  decisions: number;
  /** The newest notes listed at all. */
  shown: number;
  /** Cut the newest note's title to this many characters. */
  titleMax?: number;
}

function renderIndex(sorted: Note[], shape: Shape): string {
  const covered = sorted.slice(0, shape.shown).map((n, i) => {
    const title =
      i === 0 && shape.titleMax !== undefined && n.title.length > shape.titleMax ? `${n.title.slice(0, shape.titleMax)}…` : n.title;
    const head = `- ${title}${n.action ? ` (${n.action})` : ""}`;
    return i < shape.summaries && n.summary.length > 0 ? `${head}: ${n.summary.join("; ")} → ${n.path}` : `${head} → ${n.path}`;
  });
  if (shape.shown < sorted.length) covered.push(`- … ${sorted.length - shape.shown} older notes in .harness/notes/`);
  const decisions = sorted
    .slice(0, Math.min(shape.decisions, shape.shown))
    .flatMap((n) => n.decisions)
    .map((d) => `- ${d}`);
  return [
    "## What we already covered",
    ...covered,
    ...(decisions.length ? ["", "## Decisions so far", ...decisions] : []),
    "",
    "Open a note with your read tool when you need its details.",
  ].join("\n");
}

/**
 * The notes index for a new session's first message: what was covered and the decisions so far,
 * newest first, within about `budgetTokens`. Past the budget the oldest notes lose their summary first,
 * then their decisions; if that is still too long the oldest are left out, and as a last resort the
 * newest note's title is cut. Empty when there are no notes.
 */
export function buildNotesIndex(notes: Note[], opts: { budgetTokens?: number } = {}): string {
  if (notes.length === 0) return "";
  const budget = opts.budgetTokens ?? INDEX_BUDGET_TOKENS;
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  const n = sorted.length;
  const fits = (text: string) => estimateTokens(text) <= budget;
  for (let summaries = n; summaries >= 0; summaries--) {
    const text = renderIndex(sorted, { summaries, decisions: n, shown: n });
    if (fits(text)) return text;
  }
  for (let decisions = n - 1; decisions >= 0; decisions--) {
    const text = renderIndex(sorted, { summaries: 0, decisions, shown: n });
    if (fits(text)) return text;
  }
  for (let shown = n - 1; shown >= 1; shown--) {
    const text = renderIndex(sorted, { summaries: 0, decisions: 0, shown });
    if (fits(text)) return text;
  }
  // Last resort: one note, its title cut so the whole index still fits (the "…" takes one character).
  const full = renderIndex(sorted, { summaries: 0, decisions: 0, shown: 1 });
  const titleMax = Math.max(0, sorted[0].title.length - (full.length - budget * 4) - 1);
  return renderIndex(sorted, { summaries: 0, decisions: 0, shown: 1, titleMax });
}
