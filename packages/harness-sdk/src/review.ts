// No Node imports and no zod here: the screens import this file (`@humanharness/harness-sdk/review`).
// No regex runs on document text: every scan is a loop or indexOf (a timing test holds this).
import { createSlugger, splitFrontMatter } from "./documents";

/** The agent's review tools (spec §4): reserved names, like the core blocks. */
export const REVIEW_TOOLS = ["ask_in_document", "reply_to_comment", "read_review"] as const;

export type ReviewAuthor = "agent" | "person";
export type CommentState = "draft" | "open" | "answered" | "sent" | "resolved" | "lost";

/** Where a comment sits (§3): the passage's exact text, the slug of the heading above it, which match under it. */
export interface ReviewAnchor {
  quote: string;
  heading: string | null;
  occurrence: number;
}
export interface ReviewOption {
  label: string;
  /** The text that replaces the passage when this option is picked (D1). */
  text: string;
}
export interface ReviewReply {
  author: ReviewAuthor;
  text: string;
  at: string;
}
export type ReviewAnswer = { option: number } | { other: string };
export interface ReviewComment {
  id: string;
  author: ReviewAuthor;
  kind: "question" | "comment";
  anchor: ReviewAnchor;
  text: string;
  options?: ReviewOption[];
  blocking?: boolean;
  answer?: ReviewAnswer;
  /** The passage before the first answer, so "no answer" can put it back. */
  original?: string;
  /** The answer could not be swapped in (the passage changed): it travels in the next batch (plan addition). */
  unapplied?: true;
  state: CommentState;
  replies: ReviewReply[];
  at: string;
}
export interface ReviewApproval {
  /** git's blob id of the approved text. */
  blob: string;
  at: string;
  reason?: string;
}
export interface Review {
  path: string;
  /** The task open when the record was made; null when none was. */
  task: string | null;
  /** That task's scope (plan addition): where a new review task runs. */
  scope?: string;
  comments: ReviewComment[];
  approvals: ReviewApproval[];
}

/** A part of a document under one id-bearing heading (`heading: null` before the first one). */
export interface Section {
  slug: string | null;
  title: string;
  /** 1–4; 0 for the part before the first heading. */
  level: number;
  start: number;
  end: number;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /^[\p{L}\p{N}]$/u.test(c);

/** A heading's or a passage's inline text as the reader shows it: emphasis, code and link syntax left out. */
export function plainInline(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      out += s[++i];
      continue;
    }
    if (c === "*" || c === "`" || c === "~" || c === "[") continue;
    if (c === "_" && !(isWordChar(s[i - 1]) && isWordChar(s[i + 1]))) continue;
    if (c === "]") {
      if (s[i + 1] === "(") {
        const close = s.indexOf(")", i + 2);
        if (close >= 0) i = close;
      }
      continue;
    }
    out += c;
  }
  return out;
}

/** A fence line (```` ``` ```` or `~~~`, up to three spaces in): its character, length and info string. */
function fenceOf(line: string): { char: string; length: number; info: string } | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const char = line[i];
  if (char !== "`" && char !== "~") return null;
  let n = 0;
  while (line[i + n] === char) n++;
  if (n < 3) return null;
  return { char, length: n, info: line.slice(i + n).trim() };
}

/** An id-bearing heading line (`#`–`####`, up to three spaces in): its level and raw text; null otherwise. */
function atxHeading(line: string): { level: number; text: string } | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  let level = 0;
  while (line[i + level] === "#") level++;
  if (level < 1 || level > 4) return null;
  const after = line[i + level];
  if (after !== undefined && after !== " " && after !== "\t") return null;
  let text = line.slice(i + level).trim();
  let j = text.length;
  while (j > 0 && text[j - 1] === "#") j--;
  if (j < text.length && (j === 0 || text[j - 1] === " " || text[j - 1] === "\t")) text = text.slice(0, j).trimEnd();
  return { level, text };
}

/** Each line of `text` from `from`: its start, its end (before `\r\n` or `\n`) and the next line's start. */
function* lines(text: string, from: number): Generator<{ start: number; end: number; next: number }> {
  let at = from;
  while (at <= text.length) {
    const nl = text.indexOf("\n", at);
    const stop = nl < 0 ? text.length : nl;
    const end = stop > at && text[stop - 1] === "\r" ? stop - 1 : stop;
    yield { start: at, end, next: stop + 1 };
    if (nl < 0) return;
    at = nl + 1;
  }
}

/** Where the body starts (after the front-matter block). */
export const bodyStart = (text: string): number => text.length - splitFrontMatter(text).body.length;

/** The document's sections, in order. The first is the part before any heading (maybe empty). */
export function sections(text: string): Section[] {
  const slugger = createSlugger();
  const out: Section[] = [{ slug: null, title: "", level: 0, start: 0, end: text.length }];
  let fence: { char: string; length: number } | null = null;
  for (const l of lines(text, bodyStart(text))) {
    const line = text.slice(l.start, l.end);
    if (fence) {
      const f = fenceOf(line);
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") fence = null;
      continue;
    }
    const f = fenceOf(line);
    if (f) {
      fence = f;
      continue;
    }
    const h = atxHeading(line);
    if (!h) continue;
    out[out.length - 1].end = l.start;
    const title = plainInline(h.text).trim();
    out.push({ slug: slugger(title), title, level: h.level, start: l.start, end: text.length });
  }
  return out;
}

/** The section that holds offset `at`. */
export function sectionAt(secs: Section[], at: number): Section {
  for (let i = secs.length - 1; i >= 0; i--) if (secs[i].start <= at) return secs[i];
  return secs[0];
}

/** Starts of `quote` in `text[from, to)`, without overlap, stopping after `max`. */
function matches(text: string, quote: string, from: number, to: number, max = Infinity): number[] {
  const out: number[] = [];
  if (!quote) return out;
  for (let at = text.indexOf(quote, from); at >= 0 && at + quote.length <= to && out.length < max; at = text.indexOf(quote, at + quote.length)) out.push(at);
  return out;
}

/** The anchor of the passage `quote` starting at `start`: its section's slug and its rank among the matches there. */
export function anchorOf(text: string, start: number, quote: string, secs: Section[] = sections(text)): ReviewAnchor {
  const sec = sectionAt(secs, start);
  const before = matches(text, quote, sec.start, start + quote.length).filter((m) => m < start).length;
  return { quote, heading: sec.slug, occurrence: before };
}

/**
 * Where an anchor is now (§7): the `occurrence`-th match in its section, else the last match there, else (not strict)
 * the first match anywhere. Null: lost.
 */
export function locate(
  text: string,
  anchor: ReviewAnchor,
  opts: { strict?: boolean; secs?: Section[] } = {},
): { start: number; end: number } | null {
  const { quote } = anchor;
  if (!quote) return null;
  const secs = opts.secs ?? sections(text);
  const region = anchor.heading === null ? secs[0] : secs.find((s) => s.slug === anchor.heading);
  if (region) {
    const found = matches(text, quote, region.start, region.end, anchor.occurrence + 1);
    const at = found[anchor.occurrence] ?? found.at(-1);
    if (at !== undefined) return { start: at, end: at + quote.length };
    if (opts.strict) return null;
  } else if (opts.strict) return null;
  const anywhere = text.indexOf(quote);
  return anywhere >= 0 ? { start: anywhere, end: anywhere + quote.length } : null;
}

export type AnchorAt = { ok: true; anchor: ReviewAnchor; start: number } | { ok: false; reason: "not-found" | "no-heading" };

/** A new anchor for `ask_in_document` (§4): the first match, or the first under `heading` when given. */
export function anchorAt(text: string, quote: string, heading?: string): AnchorAt {
  const secs = sections(text);
  let from = 0;
  let to = text.length;
  if (heading !== undefined) {
    const s = secs.find((x) => x.slug === heading);
    if (!s) return { ok: false, reason: "no-heading" };
    from = s.start;
    to = s.end;
  }
  const [at] = matches(text, quote, from, to, 1);
  if (at === undefined) return { ok: false, reason: "not-found" };
  return { ok: true, anchor: anchorOf(text, at, quote, secs), start: at };
}
