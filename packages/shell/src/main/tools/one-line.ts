import { HIDDEN_CHARS } from "@humanharness/harness-sdk";

const BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");

/**
 * `text` on one plain line, part 3's rule for a job's summary (job-runner.ts, frozen, keeps its own copy): controls and
 * separators a space, hidden characters gone, runs of white space one space, trimmed; then at most `max` code points
 * (a cut never splits a surrogate pair); no cut without `max`.
 */
export function plainLine(text: string, max = Number.POSITIVE_INFINITY): string {
  const line = text.replace(BREAKS, " ").replace(HIDDEN, "").replace(/\s+/g, " ").trim();
  return line.length <= max ? line : Array.from(line).slice(0, max).join("").trim();
}
