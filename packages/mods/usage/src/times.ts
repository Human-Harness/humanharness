// Settings › Usage's own number rules: how many times a topic fits in the plan, and how it compares with the average.

/** Past this many times, Settings › Uso says "more than 50": a rough guide shouldn't sound precise. */
export const MANY_TIMES = 50;

/** How many whole tasks fit in a whole window (round(1 / estimate)); null past MANY_TIMES. */
export function timesFit(estimate: number): number | null {
  const n = estimate > 0 ? Math.round(1 / estimate) : Infinity;
  return n > MANY_TIMES ? null : Math.max(1, n);
}

/** How many more whole tasks fit in what is left of the window (floor); null past MANY_TIMES. */
export function timesLeft(remaining: number, estimate: number): number | null {
  // The epsilon keeps 0.3 / 0.1 (2.999…) at 3.
  const n = estimate > 0 ? Math.floor(Math.max(0, remaining) / estimate + 1e-9) : Infinity;
  return n > MANY_TIMES ? null : n;
}

export type TokenComparison = { kind: "average" | "half" | "less" | "more" } | { kind: "times"; times: number };

/** An action's typical tokens next to the average of all measured actions (engines that report no limits). */
export function compareTokens(tokens: number, average: number): TokenComparison {
  const ratio = average > 0 ? tokens / average : 1;
  if (ratio <= 0.6) return { kind: "half" };
  if (ratio >= 0.75 && ratio <= 1.33) return { kind: "average" };
  if (ratio >= 1.34) return { kind: "times", times: ratio };
  return { kind: ratio < 1 ? "less" : "more" };
}
