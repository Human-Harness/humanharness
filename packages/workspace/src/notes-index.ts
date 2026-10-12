import type { Note } from "./notes";

/** About how many tokens the index may take in a session's first message (spec §5.2). */
export const INDEX_BUDGET_TOKENS = 1500;

/** Rough token count: characters / 4. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The newest `full` notes keep their summary (and give their decisions); the rest of the first `shown` keep title and path. */
function renderIndex(sorted: Note[], full: number, shown: number): string {
  const covered = sorted.slice(0, shown).map((n, i) =>
    i < full && n.summary.length > 0
      ? `- ${n.title}${n.action ? ` (${n.action})` : ""}: ${n.summary.join("; ")} → ${n.path}`
      : `- ${n.title} → ${n.path}`,
  );
  if (shown < sorted.length) covered.push(`- … ${sorted.length - shown} older notes in .harness/notes/`);
  const decisions = sorted
    .slice(0, full)
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
 * newest first, within about `budgetTokens`. Past the budget the oldest notes keep only their title
 * and path; if that is still too long the oldest are left out. Empty when there are no notes.
 */
export function buildNotesIndex(notes: Note[], opts: { budgetTokens?: number } = {}): string {
  if (notes.length === 0) return "";
  const budget = opts.budgetTokens ?? INDEX_BUDGET_TOKENS;
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  for (let full = sorted.length; full >= 0; full--) {
    const text = renderIndex(sorted, full, sorted.length);
    if (estimateTokens(text) <= budget) return text;
  }
  for (let shown = sorted.length - 1; shown > 1; shown--) {
    const text = renderIndex(sorted, 0, shown);
    if (estimateTokens(text) <= budget) return text;
  }
  return renderIndex(sorted, 0, 1);
}
