import { LABEL_TOKENS, LINK_TOKENS, REVIEW_TOKENS, SAMPLE_SHARE, SHEET_TOKENS, TARGET } from "./constants";

/** Per-fragment token costs measured in the base's usage.jsonl (Task 25); a stage without measures uses the constant. */
export interface MeasuredCosts {
  label?: number;
  review?: number;
  link?: number;
  /** Per run, not per fragment. */
  sheet?: number;
}

/**
 * The AI stages' cost in tokens (§7): fragments × (label + review × share) + the sheet + links when the harness has
 * items. `fragments` defaults to tokens ÷ TARGET. `reviewShare`: the share of fragments the review reads (flagged +
 * sample); before conversion, SAMPLE_SHARE.
 */
export function estimateCost(o: { tokens: number; items: boolean; reviewShare?: number; fragments?: number; measured?: MeasuredCosts }): number {
  const n = o.fragments ?? Math.max(1, Math.ceil(o.tokens / TARGET));
  const m = o.measured ?? {};
  const per = (m.label ?? LABEL_TOKENS) + (m.review ?? REVIEW_TOKENS) * (o.reviewShare ?? SAMPLE_SHARE) + (o.items ? (m.link ?? LINK_TOKENS) : 0);
  return Math.round(n * per + (m.sheet ?? SHEET_TOKENS));
}
