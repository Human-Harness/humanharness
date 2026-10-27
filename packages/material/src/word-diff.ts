/** A table's separator row (`|---|:--:|`): structure only. */
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * The words of a fragment, without its Markdown structure: separator rows, a list item's leading `- `, `* ` or `+ `,
 * and the marks `#`, `*`, `_`, `` ` ``, `>`, `|`, brackets and parentheses. A `-` or `~` inside the text stays: `-3/4`
 * and `3/4` are different words.
 */
const words = (md: string): string[] =>
  md
    .split("\n")
    .filter((line) => !SEPARATOR.test(line))
    .map((line) => line.replace(/^(\s*)[-*+](\s)/, "$1$2"))
    .join("\n")
    .replace(/[#*_`>|[\]()]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * The share of words a repair changed (§6.2): the larger of words added and words removed, over the longer text's
 * words, so a replaced word counts once and a pure deletion counts in full. Markdown structure and spacing don't
 * count, so a table rebuilt from loose lines counts 0.
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
  return Math.max(added, removed) / Math.max(a.length, b.length, 1);
}
