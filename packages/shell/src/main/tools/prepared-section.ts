import { HIDDEN_CHARS } from "@humanharness/harness-sdk";
import type { ContextItem } from "@humanharness/ui/client";
import { fenceFor } from "@humanharness/workspace";
import { approxTokens } from "../context-record";
import type { StepResult } from "./pre-steps";

const TITLE = "## Prepared data";
const LEAD =
  "Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.";
const HEAD = [TITLE, "", LEAD].join("\n");
const TOO_LARGE = "cut: too large";
/** A one-line text's length, in characters. */
const LINE_MAX = 200;
const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
/** The section's size: characters ÷ 4, rounded up (Decision 3). */
const tokensOf = (chars: number) => Math.ceil(chars / 4);
/** One line: controls and line separators become spaces, hidden characters go, at most 200 characters (P1). */
const line = (t: string) =>
  Array.from(t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(HIDDEN, "").replace(/\s+/g, " ").trim())
    .slice(0, LINE_MAX)
    .join("");

export interface PreparedPart {
  /** The section, or "" when there is nothing to say. */
  text: string;
  /** One `prepared` start item per block in the text (pre-step results, tools spec §6.4). */
  items: ContextItem[];
  /** Each cut, for the trace (Decision 3): `<as>: cut: 12 of 40 items`. */
  cuts: { as: string; tool: string; text: string }[];
  /** The section's size in tokens (characters ÷ 4, rounded up): the `pre` row's preparedTokens. */
  tokens: number;
}

/** A block as it will be written: its header, its one line, its JSON (none when failed or cut whole) and its cut note. */
type Shown = { key: string; tool: string; header: string; body: string; json?: string; cut?: string; dropped?: boolean };

function block(s: Shown): string {
  const lines = [s.header, ...(s.body ? [s.body] : [])];
  if (s.json !== undefined) {
    const fence = fenceFor(s.json);
    lines.push(`${fence}json`, s.json, fence);
  }
  if (s.cut) lines.push(`(${s.cut})`);
  return lines.join("\n");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** How many parts (items, keys or characters) `v` can be cut by; 0 for a value that can only be cut whole. */
const partsOf = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "string" ? Array.from(v).length : isObject(v) ? Object.keys(v).length : 0);

/** `value` cut to its first `n` parts, and the note saying so. */
function cutTo(value: unknown, n: number): { json: string; note: string } {
  if (Array.isArray(value)) return { json: JSON.stringify(value.slice(0, n)), note: `cut: ${n} of ${value.length} items` };
  if (typeof value === "string") {
    const chars = Array.from(value);
    return { json: JSON.stringify(chars.slice(0, n).join("")), note: `cut: ${n} of ${chars.length} characters` };
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return {
    json: JSON.stringify(Object.fromEntries(keys.slice(0, n).map((k) => [k, (value as Record<string, unknown>)[k]]))),
    note: `cut: ${n} of ${keys.length} keys`,
  };
}

/**
 * The first message's `## Prepared data` (tools spec §6.3): one block per pre-step result, the tool's description as
 * its line, compact JSON in a fence one longer than its longest backtick run (P1). The section never exceeds
 * `preTokens` (P2): the largest result is cut first, to the most items, keys or characters that still fit, or whole
 * (`(cut: too large)`) when even empty it doesn't (Decision 3). Should the headers and lines still not fit, the last
 * blocks lose their line, then the last blocks go, so the cap holds whatever the results.
 */
export function preparedSection(results: StepResult[], o: { descriptions: Record<string, string>; preTokens: number }): PreparedPart {
  if (results.length === 0) return { text: "", items: [], cuts: [], tokens: 0 };
  const shown: Shown[] = results.map((r) => {
    const key = line(r.as ?? r.tool);
    const tool = line(r.tool);
    const header = `### ${r.as !== undefined ? `${key} · ${tool}` : tool}`;
    if (!r.ok) return { key, tool, header, body: line(`${r.tool} failed: ${r.error ?? "unknown error"}`) };
    return { key, tool, header, body: line(o.descriptions[r.tool] ?? ""), json: JSON.stringify(r.value ?? null) };
  });
  const total = () => tokensOf([HEAD, ...shown.filter((s) => !s.dropped).map(block)].join("\n\n").length);
  const fits = () => total() <= o.preTokens;
  /** Cuts by block, in the order they were first made; a later cut of the same block replaces its text. */
  const cuts = new Map<number, string>();
  const tooLarge = (i: number) => {
    shown[i].json = undefined;
    shown[i].cut = TOO_LARGE;
    cuts.set(i, TOO_LARGE);
  };

  // 1. Cut results, largest first, each to the most parts that fit.
  const done = new Set<number>();
  while (!fits()) {
    let i = -1;
    for (let k = 0; k < shown.length; k++) {
      const j = shown[k].json;
      if (!done.has(k) && j !== undefined && (i < 0 || j.length > (shown[i].json as string).length)) i = k;
    }
    if (i < 0) break;
    done.add(i);
    const value = results[i].value;
    const size = partsOf(value);
    let best: { json: string; note: string } | null = null;
    // The largest n that fits, by halving: each try measures the whole section.
    let lo = 0;
    let hi = size - 1;
    while (size > 0 && lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const c = cutTo(value, mid);
      shown[i].json = c.json;
      shown[i].cut = c.note;
      if (fits()) {
        best = c;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best) {
      shown[i].json = best.json;
      shown[i].cut = best.note;
      cuts.set(i, best.note);
    } else tooLarge(i);
  }
  // 2. Still over (many failures or long lines): the last blocks keep only their header.
  for (let i = shown.length - 1; i >= 0 && !fits(); i--) {
    shown[i].body = "";
    tooLarge(i);
  }
  // 3. Still over (the headers alone): the last blocks go.
  for (let i = shown.length - 1; i >= 0 && !fits(); i--) {
    shown[i].dropped = true;
    cuts.set(i, TOO_LARGE);
  }

  const cutList = [...cuts].map(([i, note]) => ({ as: shown[i].key, tool: shown[i].tool, text: `${shown[i].key}: ${note}` }));
  const kept = shown.filter((s) => !s.dropped);
  if (kept.length === 0) return { text: "", items: [], cuts: cutList, tokens: 0 };
  const blocks = kept.map(block);
  const text = [HEAD, ...blocks].join("\n\n");
  return {
    text,
    items: kept.map((s, k) => ({ id: `prepared:${s.key}`, kind: "prepared" as const, label: `Prepared · ${s.key}`, tokens: approxTokens(blocks[k].length) })),
    cuts: cutList,
    tokens: tokensOf(text.length),
  };
}
