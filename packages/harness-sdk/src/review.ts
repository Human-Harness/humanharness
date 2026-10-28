// No Node imports and no zod here: the screens import this file (`@humanharness/harness-sdk/review`).
// No regex scans document text: every scan is a loop or indexOf, and regexes only test single characters (timing tests hold this).
import { createSlugger, refusedShape, splitFrontMatter } from "./documents";

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
  // The first `)` at or after the last search; -1 once there is none left (each `](` would search again: quadratic).
  let close = -2;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      out += s[++i];
      continue;
    }
    if (c === "*" || c === "`" || c === "~" || c === "[") continue;
    if (c === "_" && !(isWordChar(s[i - 1]) && isWordChar(s[i + 1]))) continue;
    if (c === "]") {
      if (s[i + 1] === "(" && close !== -1) {
        if (close < i + 2) close = s.indexOf(")", i + 2);
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

/** A setext underline (`===` or `---`, up to three spaces in, trailing blanks allowed): its level; 0 otherwise. */
function setextLevel(line: string): number {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const c = line[i];
  if (c !== "=" && c !== "-") return 0;
  while (line[i] === c) i++;
  while (line[i] === " " || line[i] === "\t") i++;
  return i === line.length ? (c === "=" ? 1 : 2) : 0;
}

/** A thematic break of `*` or `_` (three or more, spaces between allowed). */
function isBreak(line: string): boolean {
  let n = 0;
  let mark = "";
  for (const c of line) {
    if (c === " " || c === "\t") continue;
    if ((c !== "*" && c !== "_") || (mark && c !== mark)) return false;
    mark = c;
    n++;
  }
  return n >= 3;
}

/** A line that opens a block other than a paragraph (a list item, a quote, a table, HTML, indented code). */
function opensOtherBlock(line: string): boolean {
  if (line.startsWith("    ") || line[0] === "\t") return true;
  const t = line.trimStart();
  const c = t[0];
  if (c === ">" || c === "|" || c === "<") return true;
  if ((c === "-" || c === "*" || c === "+") && (t.length === 1 || t[1] === " " || t[1] === "\t")) return true;
  let i = 0;
  while (i < 9 && t[i] >= "0" && t[i] <= "9") i++;
  return i > 0 && (t[i] === "." || t[i] === ")") && (t.length === i + 1 || t[i + 1] === " " || t[i + 1] === "\t");
}

/**
 * The document's sections, in order. The first is the part before any heading (maybe empty). Top-level ATX
 * (`#`–`####`) and setext (`===` or `---` under a paragraph) headings count. Limit: a heading inside a blockquote or a
 * list item gets an id in the reader but starts no section here, so the reader's `-1` numbering of later equal slugs
 * may differ; an anchor whose heading isn't found falls back to a search of the whole text.
 */
export function sections(text: string): Section[] {
  const slugger = createSlugger();
  const out: Section[] = [{ slug: null, title: "", level: 0, start: 0, end: text.length }];
  const push = (raw: string, level: number, start: number) => {
    out[out.length - 1].end = start;
    const title = plainInline(raw).trim();
    out.push({ slug: slugger(title), title, level, start, end: text.length });
  };
  let fence: { char: string; length: number } | null = null;
  // The open paragraph a setext underline would turn into a heading: its first line's start and its lines.
  let para: { start: number; lines: string[] } | null = null;
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
      para = null;
      continue;
    }
    const h = atxHeading(line);
    if (h) {
      push(h.text, h.level, l.start);
      para = null;
      continue;
    }
    const setext = setextLevel(line);
    if (setext && para) {
      push(para.lines.join(" "), setext, para.start);
      para = null;
      continue;
    }
    if (setext === 2 || line.trim() === "" || isBreak(line) || (!para && opensOtherBlock(line))) {
      para = null;
      continue;
    }
    if (para) para.lines.push(line.trim());
    else para = { start: l.start, lines: [line.trim()] };
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

/** `text` roughly as the reader shows it, and where each of its characters came from. */
export interface Projection {
  plain: string;
  /** `map[i]`: the offset in the source of plain character `i`. */
  map: number[];
}

// NBSP is blank here and in `collapse`: a selection's text and the source may each carry it.
const isBlank = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\u00a0" || c === "|";

/** The offset after a line's block markers: `#`s, `>`, list bullets and numbers, a task box. One pass, no regex. */
function afterMarkers(text: string, i: number, end: number): number {
  for (;;) {
    while (i < end && (text[i] === " " || text[i] === "\t")) i++;
    const c = text[i];
    if (c === ">") {
      i++;
      continue;
    }
    if ((c === "-" || c === "*" || c === "+") && (text[i + 1] === " " || text[i + 1] === "\t")) {
      i += 2;
      if (text[i] === "[" && (text[i + 1] === " " || text[i + 1] === "x" || text[i + 1] === "X") && text[i + 2] === "]") i += 3;
      continue;
    }
    if (c === "#") {
      let j = i;
      while (j < end && text[j] === "#" && j - i < 6) j++;
      if (j === end || text[j] === " " || text[j] === "\t") {
        i = j;
        continue;
      }
      return i;
    }
    if (c !== undefined && c >= "0" && c <= "9") {
      let j = i;
      while (j < end && j - i < 9 && text[j] >= "0" && text[j] <= "9") j++;
      if ((text[j] === "." || text[j] === ")") && (text[j + 1] === " " || text[j + 1] === "\t")) {
        i = j + 2;
        continue;
      }
    }
    return i;
  }
}

/**
 * The text as the reader shows it, roughly (Decisions "Anchors"): front-matter, fence lines, block markers and inline
 * markup left out; code inside fences kept as written; every run of whitespace (and table pipes) one space.
 */
export function project(text: string, opts: { frontMatter?: boolean } = {}): Projection {
  const plain: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1;
  const emit = (c: string, at: number) => {
    if (pendingSpace >= 0 && plain.length > 0) {
      plain.push(" ");
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    plain.push(c);
    map.push(at);
  };
  const space = (at: number) => {
    if (pendingSpace < 0) pendingSpace = at;
  };
  let fence: { char: string; length: number } | null = null;
  for (const l of lines(text, opts.frontMatter === false ? 0 : bodyStart(text))) {
    const f = fenceOf(text.slice(l.start, l.end));
    if (fence) {
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") fence = null;
      else
        for (let i = l.start; i < l.end; i++) {
          const c = text[i];
          if (c === " " || c === "\t" || c === "\r") space(i);
          else emit(c, i);
        }
      space(l.end);
      continue;
    }
    if (f) {
      fence = f;
      space(l.end);
      continue;
    }
    // The `)` that closes a link destination on this line (-1: none found yet), and where a failed search ends.
    let close = -1;
    let openFrom = 0;
    for (let i = afterMarkers(text, l.start, l.end); i < l.end; i++) {
      const c = text[i];
      if (isBlank(c)) {
        space(i);
        continue;
      }
      if (c === "\\" && i + 1 < l.end) {
        emit(text[i + 1], i + 1);
        i++;
        continue;
      }
      if (c === "*" || c === "`" || c === "~" || c === "[") continue;
      if (c === "_" && !(isWordChar(text[i - 1]) && isWordChar(text[i + 1]))) continue;
      if (c === "]") {
        if (text[i + 1] === "(" && i + 2 >= openFrom) {
          // Only this line is searched, and no part twice: a `)` found is kept, a failed search marks the rest.
          if (close < i + 2) {
            close = -1;
            for (let k = i + 2; k < l.end; k++)
              if (text[k] === ")") {
                close = k;
                break;
              }
            if (close < 0) openFrom = l.end;
          }
          if (close >= 0) i = close;
        }
        continue;
      }
      emit(c, i);
    }
    space(l.end);
  }
  return { plain: plain.join(""), map };
}

/** Whitespace runs as one space, trimmed (a DOM selection's text). */
function collapse(s: string): string {
  let out = "";
  let gap = false;
  for (const c of s) {
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\u00a0") gap = out.length > 0;
    else {
      if (gap) out += " ";
      gap = false;
      out += c;
    }
  }
  return out;
}

/** The first index `i` with `map[i] >= at` (map is increasing). */
function plainIndexAt(map: number[], at: number): number {
  let lo = 0;
  let hi = map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The anchor of a passage the person selected in the reader (§5.2): the selection is found in the projected text,
 * preferring the section of `heading` (the heading above the selection), and mapped back to an exact source passage.
 */
export function anchorForSelection(source: string, selected: string, heading: string | null): ReviewAnchor | null {
  const want = collapse(selected);
  if (!want) return null;
  const p = project(source);
  const secs = sections(source);
  const region = heading === null ? null : (secs.find((s) => s.slug === heading) ?? null);
  let first = -1;
  let inside = -1;
  for (let at = p.plain.indexOf(want); at >= 0; at = p.plain.indexOf(want, at + want.length)) {
    if (first < 0) first = at;
    const start = p.map[at];
    if (!region || (start >= region.start && start < region.end)) {
      inside = at;
      break;
    }
  }
  const at = inside >= 0 ? inside : first;
  if (at < 0) return null;
  const start = p.map[at];
  const end = p.map[at + want.length - 1] + 1;
  return anchorOf(source, start, source.slice(start, end), secs);
}

/** Which rendered match of the passage's projected text the anchored passage is (the window's mark, §6.1). */
export function markOccurrence(source: string, anchor: ReviewAnchor): { want: string; nth: number } | null {
  const where = locate(source, anchor);
  if (!where) return null;
  const want = project(anchor.quote, { frontMatter: false }).plain;
  if (!want) return null;
  const p = project(source);
  const k = plainIndexAt(p.map, where.start);
  let nth = 0;
  for (let at = p.plain.indexOf(want); at >= 0 && at < k; at = p.plain.indexOf(want, at + want.length)) nth++;
  return { want, nth };
}

/** The heading title of the diagram that holds offset `at` (§11.1), or null when `at` is not inside a mermaid fence. */
export function diagramOf(text: string, at: number): string | null {
  let fence: { char: string; length: number; mermaid: boolean; start: number } | null = null;
  for (const l of lines(text, bodyStart(text))) {
    if (l.start > at && !fence) return null;
    const f = fenceOf(text.slice(l.start, l.end));
    if (fence) {
      if (f && f.char === fence.char && f.length >= fence.length && f.info === "") {
        if (fence.mermaid && at > fence.start && at < l.start) return sectionAt(sections(text), fence.start).title;
        fence = null;
      }
      continue;
    }
    if (f) fence = { char: f.char, length: f.length, mermaid: f.info.split(" ")[0].toLowerCase() === "mermaid", start: l.next - 1 };
  }
  return null;
}

/** What the person picks on a question card: an option, "no answer" (null), or "Other" (§5.1). */
export type AnswerPick = number | null | { other: string };

export type AnswerResult =
  | { ok: true; text: string | null; comment: ReviewComment }
  | { ok: false; reason: "not-a-question" | "bad-option" | "resolved" };

/** Longest "Other" answer. */
export const MAX_OTHER = 2000;

/** The comment without the fields an answer replaces. */
function bare(c: ReviewComment): ReviewComment {
  const { answer: _a, unapplied: _u, ...rest } = c;
  return rest;
}

/**
 * An answer to a question (§5.1). An option swaps the anchored passage for its text (the first answer keeps the
 * original); "no answer" puts the original back; "Other" keeps the passage. The swap guard: when the passage is no
 * longer where the anchor says (strictly inside its section), nothing is swapped and the answer is `unapplied`, so it
 * travels in the next batch. `text` is the document's new text, or null when it doesn't change.
 */
export function answerQuestion(text: string, c: ReviewComment, pick: AnswerPick): AnswerResult {
  if (c.kind !== "question" || !c.options) return { ok: false, reason: "not-a-question" };
  if (c.state === "resolved") return { ok: false, reason: "resolved" };
  if (typeof pick === "number" && (!Number.isInteger(pick) || pick < 0 || pick >= c.options.length)) return { ok: false, reason: "bad-option" };
  if (pick !== null && typeof pick === "object") {
    const other = typeof pick.other === "string" ? pick.other.trim() : "";
    if (!other || other.length > MAX_OTHER) return { ok: false, reason: "bad-option" };
    return { ok: true, text: null, comment: { ...bare(c), answer: { other }, state: "answered" } };
  }
  const secs = sections(text);
  // "No answer" to a question never answered changes nothing (and must not become an unapplied answer).
  if (pick === null && c.answer === undefined && !c.unapplied) return { ok: true, text: null, comment: c };
  const where = c.unapplied ? null : locate(text, c.anchor, { strict: true, secs });
  if (!where) {
    const answer = pick === null ? {} : { answer: { option: pick } };
    return { ok: true, text: null, comment: { ...bare(c), ...answer, unapplied: true, state: pick === null ? "open" : "answered" } };
  }
  const passage = text.slice(where.start, where.end);
  const original = c.original ?? passage;
  const target = pick === null ? original : c.options[pick].text;
  const next = text.slice(0, where.start) + target + text.slice(where.end);
  const anchor = anchorOf(next, where.start, target);
  if (pick === null) {
    const { original: _o, ...rest } = bare(c);
    return { ok: true, text: next, comment: { ...rest, anchor, state: "open" } };
  }
  return { ok: true, text: next, comment: { ...bare(c), anchor, answer: { option: pick }, original, state: "answered" } };
}

/** Goes in the next batch (§5.3): a draft, an "Other" answer, or an answer the app could not swap in. */
export const isUnsent = (c: ReviewComment): boolean =>
  c.state === "draft" || (c.kind === "question" && (c.state === "answered" || c.state === "open") && (c.unapplied === true || (c.answer !== undefined && "other" in c.answer)));

export type ReviewStatus = "none" | "draft" | "approved" | "stale";

/** Approved: the current blob is the last approval's. Stale: approved before, changed since (§3). */
export function reviewStatus(review: Review | null, blob: string | null): ReviewStatus {
  if (!review) return "none";
  const last = review.approvals.at(-1);
  if (!last) return "draft";
  return blob !== null && last.blob === blob ? "approved" : "stale";
}

/** What a chip, the footer bar, a harness view and `humanharness run` show (§5.6). */
export interface ReviewSummary {
  status: ReviewStatus;
  /** Questions without an answer. */
  questions: number;
  /** Of those, the blocking ones. */
  blocking: number;
  /** Items the next batch would carry. */
  unsent: number;
  /** Comments and questions not resolved. */
  comments: number;
  /** The last approval's time, when there is one. */
  approvedAt?: string;
}

export function summarizeReview(review: Review | null, blob: string | null): ReviewSummary {
  const status = reviewStatus(review, blob);
  const all = review?.comments ?? [];
  const live = all.filter((c) => c.state !== "resolved");
  const unanswered = live.filter((c) => c.kind === "question" && c.state === "open" && c.answer === undefined);
  const last = review?.approvals.at(-1);
  return {
    status,
    questions: unanswered.length,
    blocking: unanswered.filter((c) => c.blocking === true).length,
    unsent: all.filter(isUnsent).length,
    comments: live.length,
    ...(last ? { approvedAt: last.at } : {}),
  };
}

/** `c<n+1>` for the highest `c<n>` in the record. */
export function nextCommentId(review: Review): string {
  let max = 0;
  for (const c of review.comments) {
    const n = Number(c.id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `c${max + 1}`;
}

/** `s` cut to `max` characters, with "…". */
export function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const quoted = (s: string, max: number) => JSON.stringify(cut(collapse(s), max));

function answerLine(c: ReviewComment): string {
  if (c.answer && "other" in c.answer) return JSON.stringify(c.answer.other);
  if (c.answer && "option" in c.answer) {
    const o = c.options?.[c.answer.option];
    // An option index the record doesn't hold (a hand edit): say so rather than throw.
    if (!o) return "picked an option the review no longer has: check the passage";
    return `picked ${JSON.stringify(o.label)}, but the passage changed: write it as ${quoted(o.text, 400)}`;
  }
  return "took the answer back, but the passage changed: check it";
}

/**
 * The review round's message (§5.3), or null when nothing is unsent. `text` is the document now (for the headings'
 * titles); null when it can't be read. `ids` are the items it carries, which become `sent`.
 */
export function batchMessage(path: string, review: Review, text: string | null): { message: string; ids: string[] } | null {
  const secs = text === null ? [] : sections(text);
  const headingOf = (slug: string | null): string => {
    const s = slug === null ? undefined : secs.find((x) => x.slug === slug);
    return s ? ` (${"#".repeat(s.level)} ${s.title})` : "";
  };
  const comments = review.comments.filter((c) => c.kind === "comment" && c.state === "draft");
  const answers = review.comments.filter((c) => c.kind === "question" && isUnsent(c));
  if (comments.length === 0 && answers.length === 0) return null;
  const lines = [`Review round for ${path}.`];
  if (comments.length > 0) {
    lines.push("Comments:");
    for (const c of comments) lines.push(`- ${c.id} on ${quoted(c.anchor.quote, 40)}${headingOf(c.anchor.heading)}: ${JSON.stringify(c.text)}`);
  }
  if (answers.length > 0) {
    lines.push("Custom answers:");
    for (const c of answers) lines.push(`- ${c.id} ${quoted(c.text, 80)}: ${answerLine(c)}`);
  }
  lines.push("Edit the document, then answer each one with reply_to_comment.");
  return { message: lines.join("\n"), ids: [...comments, ...answers].map((c) => c.id) };
}

/** The batch's items become `sent`. */
export function markSent(review: Review, ids: readonly string[]): Review {
  const sent = new Set(ids);
  return { ...review, comments: review.comments.map((c) => (sent.has(c.id) ? { ...c, state: "sent" as const } : c)) };
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Over this many lines on either side, "See what changed" says it is too long to compare here. */
export const MAX_DIFF_LINES = 2000;
/** Over this many characters on either side, the same: checked before the text is split. */
export const MAX_DIFF_CHARS = 1_000_000;

/** A text's lines: a final newline ends the last line and adds no empty one ("" has none). */
function diffLines(text: string): string[] {
  const out = text.split("\n");
  if (out.at(-1) === "") out.pop();
  return out;
}

/**
 * A line diff (longest common subsequence) between the approved text and the current one; null when too long.
 * The work is bounded: at most MAX_DIFF_CHARS to split and number, then at most MAX_DIFF_LINES² cells of the
 * table, each one an integer comparison (lines are numbered first, so a long line is never compared twice).
 */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  if (before.length > MAX_DIFF_CHARS || after.length > MAX_DIFF_CHARS) return null;
  const a = diffLines(before);
  const b = diffLines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) ids.set(line, (id = ids.size));
    return id;
  };
  const ai = a.map(idOf);
  const bi = b.map(idOf);
  let head = 0;
  while (head < ai.length && head < bi.length && ai[head] === bi[head]) head++;
  let tail = 0;
  while (tail < ai.length - head && tail < bi.length - head && ai[ai.length - 1 - tail] === bi[bi.length - 1 - tail]) tail++;
  const x = ai.slice(head, ai.length - tail);
  const y = bi.slice(head, bi.length - tail);
  const w = y.length + 1;
  // lcs[i * w + j]: the longest common subsequence of x[i:] and y[j:] (at most MAX_DIFF_LINES, fits 16 bits).
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same" as const, text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ kind: "same", text: a[head + i++] });
      j++;
    } else if (j < y.length && (i === x.length || lcs[i * w + j + 1] > lcs[(i + 1) * w + j])) {
      out.push({ kind: "added", text: b[head + j++] });
    } else out.push({ kind: "removed", text: a[head + i++] });
  }
  for (const text of a.slice(a.length - tail)) out.push({ kind: "same", text });
  return out;
}

/**
 * One path part against one pattern part: `*` any run, `?` one character.
 * Greedy with a single backtrack point (the last `*`), so it is O(pattern × part), never exponential.
 */
function matchPart(p: string, s: string): boolean {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && p[i] !== "*" && (p[i] === "?" || p[i] === s[j])) {
      i++;
      j++;
    } else if (i < p.length && p[i] === "*") {
      star = i++;
      mark = j;
    } else if (star >= 0) {
      i = star + 1;
      j = ++mark;
    } else return false;
  }
  while (i < p.length && p[i] === "*") i++;
  return i === p.length;
}

/**
 * Whether `path` matches the phase's `approve` glob (§5.5): `*` and `?` within a part, `**` across parts.
 * Case is ignored, like the `.md` check in `validApproveGlob` (macOS disks are case-insensitive).
 * A table over (pattern part, path part), filled from the end without recursion: O(parts × parts) part matches.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const ps = pattern.toLowerCase().split("/");
  const xs = path.toLowerCase().split("/");
  const n = xs.length;
  // next[j]: whether ps[i + 1:] matches xs[j:].
  let next = new Uint8Array(n + 1);
  next[n] = 1;
  for (let i = ps.length - 1; i >= 0; i--) {
    const cur = new Uint8Array(n + 1);
    if (ps[i] === "**") {
      cur[n] = next[n];
      for (let j = n - 1; j >= 0; j--) cur[j] = next[j] || cur[j + 1];
    } else for (let j = n - 1; j >= 0; j--) cur[j] = next[j + 1] && matchPart(ps[i], xs[j]) ? 1 : 0;
    next = cur;
  }
  return next[0] === 1;
}

/** The manifest's check of an `approve` glob (Decisions "Phases"). */
export function validApproveGlob(p: unknown): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 200) return false;
  for (const c of "[]{}") if (p.includes(c)) return false;
  if (refusedShape(p.replaceAll("*", "x").replaceAll("?", "x"))) return false;
  const parts = p.split("/");
  // No empty, "." or ".." part: a path to match is always normalized, so such a glob would never match.
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  if (parts.some((part) => part.includes("**") && part !== "**")) return false;
  if (parts[0] === ".harness") return false;
  return p.toLowerCase().endsWith(".md");
}
