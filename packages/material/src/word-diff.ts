const words = (md: string): string[] =>
  md
    .replace(/[#*_`>|~\-[\]()]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * The share of words a repair changed (§6.2): words added plus words removed, over the longer text's words, halved so
 * a replaced word counts once. Markdown marks and spacing don't count, so a table rebuilt from loose lines counts 0.
 */
export function wordDiff(before: string, after: string): number {
  const a = words(before);
  const b = words(after);
  const count = new Map<string, number>();
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
  let added = 0;
  for (const w of b) {
    const n = count.get(w) ?? 0;
    if (n > 0) count.set(w, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return (added + removed) / Math.max(a.length, b.length, 1) / 2;
}
