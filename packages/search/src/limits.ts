// The caps of search spec §4.5.

/** Text is indexed up to this size per file; a bigger file is indexed by name only. */
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Files across the folder and the reference folders; past it the rest are left out (folder first). */
export const MAX_FILES = 50_000;
/** Indexed text in all; past it, files go name-only, the largest first. */
export const MAX_TOTAL_TEXT_BYTES = 200 * 1024 * 1024;

/** The keys to index by name only so the total fits `cap`: the largest go first. */
export function overTextBudget(sizes: readonly { key: string; size: number }[], cap: number = MAX_TOTAL_TEXT_BYTES): Set<string> {
  let total = sizes.reduce((sum, f) => sum + f.size, 0);
  const out = new Set<string>();
  for (const f of [...sizes].sort((a, b) => b.size - a.size)) {
    if (total <= cap) break;
    out.add(f.key);
    total -= f.size;
  }
  return out;
}
