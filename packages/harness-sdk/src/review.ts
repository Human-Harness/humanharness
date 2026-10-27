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

/** `text` roughly as the reader shows it, and where each of its characters came from. */
export interface Projection {
  plain: string;
  /** `map[i]`: the offset in the source of plain character `i`. */
  map: number[];
}

const isBlank = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "|";

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
        if (text[i + 1] === "(") {
          const close = text.indexOf(")", i + 2);
          if (close >= 0 && close < l.end) i = close;
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
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " ") gap = out.length > 0;
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
  for (let at = p.plain.indexOf(want); at >= 0; at = p.plain.indexOf(want, at + 1)) {
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
