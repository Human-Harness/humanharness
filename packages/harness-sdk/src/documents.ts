// No Node imports here: the screens import this file (`@humanharness/harness-sdk/documents`).

/** A document kind's id (document-reader spec §4.2). */
export const DOCUMENT_KIND_ID = /^[a-z][a-z0-9-]*$/;

/** The callouts the renderer draws (§3.2): GitHub's three, then the core's three. The set is fixed. */
export const CALLOUTS = ["note", "tip", "warning", "summary", "decision", "question"] as const;
export type Callout = (typeof CALLOUTS)[number];

/** A kind a harness declares (manifest `documents.kinds`). */
export interface DocumentKind {
  /** One sentence: when to use it. */
  when: string;
  /** Its `##` sections, in order. */
  sections: string[];
  /** The values its front-matter `status` may take. */
  status?: string[];
}

export interface FrontMatter {
  /** Top-level `key: value` pairs, quotes removed. Empty when there is none or it is broken. */
  data: Record<string, string>;
  /** The text after the block (all of it when there is no block). */
  body: string;
  /** There was a closed block, but a line in it was not `key: value` (§6: ignored). */
  broken: boolean;
  /** How many lines the block took, delimiters included (0 without one). */
  lines: number;
}

// No lazy group before trailing whitespace: that backtracks quadratically on long runs of spaces.
const KEY_VALUE = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/;

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(v);
      return typeof parsed === "string" ? parsed : v;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

/** The front-matter block at the very top (`---` … `---` or `...`): a small YAML subset, never more. */
export function splitFrontMatter(text: string): FrontMatter {
  const src = text.replace(/^﻿/, "");
  const lines = src.split(/\r?\n/);
  if (lines[0] !== "---") return { data: {}, body: text, broken: false, lines: 0 };
  const end = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."));
  if (end < 0) return { data: {}, body: text, broken: false, lines: 0 };
  const data: Record<string, string> = {};
  let broken = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const m = KEY_VALUE.exec(line);
    if (!m) {
      broken = true;
      continue;
    }
    data[m[1]] = unquote((m[2] ?? "").trimEnd());
  }
  // The body keeps its own line endings: only the block's lines are cut (line endings may be mixed).
  const body = stripLines(src, end + 1);
  return { data: broken ? {} : data, body, broken, lines: end + 1 };
}

/** `text` without its first `count` lines (any line ending). */
function stripLines(text: string, count: number): string {
  let i = 0;
  for (let n = 0; n < count; n++) {
    const next = text.indexOf("\n", i);
    if (next < 0) return "";
    i = next + 1;
  }
  return text.slice(i);
}

/** A heading's anchor id, GitHub style: lowercase, punctuation dropped, spaces to dashes. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Slugs deduplicated in the order asked: "a", "a-1", "a-2". An empty slug is "section". */
export function createSlugger(): (text: string) => string {
  const seen = new Set<string>();
  // The next number to try per base: every lower one was taken when last asked, and `seen` only grows (linear).
  const next = new Map<string, number>();
  return (text) => {
    const base = slug(text) || "section";
    let id = base;
    if (seen.has(id)) {
      let n = next.get(base) ?? 1;
      while (seen.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
      next.set(base, n + 1);
    }
    seen.add(id);
    return id;
  };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// The heading's text is cut by hand below: a regex with optional trailing parts backtracks quadratically.
const H1 = /^ {0,3}#[ \t]+(.*)$/;

/** An `# H1` line's text: trailing spaces and a closing `#` run (after whitespace) removed. */
function headingText(raw: string): string {
  let t = raw.trimEnd();
  let i = t.length;
  while (i > 0 && t[i - 1] === "#") i--;
  if (i < t.length && (i === 0 || t[i - 1] === " " || t[i - 1] === "\t")) t = t.slice(0, i).trimEnd();
  return t.trim();
}

/** The title from an already split document. */
function titleOf(path: string, fm: FrontMatter): string {
  const fromFm = fm.data.title?.trim();
  if (fromFm) return fromFm;
  let fence: { char: string; length: number } | null = null;
  for (const line of fm.body.split(/\r?\n/)) {
    if (fence) {
      const c = CLOSING_FENCE.exec(line);
      if (c && c[1][0] === fence.char && c[1].length >= fence.length) fence = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = { char: f[1][0], length: f[1].length };
      continue;
    }
    const h = H1.exec(line);
    const title = h ? headingText(h[1]) : "";
    if (title) return title;
  }
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/** A card's title (§5.1): front-matter `title`, else the first `#` heading outside code, else the file name. */
export function documentTitle(path: string, text: string): string {
  return titleOf(path, splitFrontMatter(text));
}

/** What `\s` matches in a JavaScript regex. */
function isSpace(c: number): boolean {
  return (
    (c >= 9 && c <= 13) || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

/** Runs of non-space characters, counted in one pass (no arrays: a long document costs no extra memory). */
function wordsIn(body: string): number {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < body.length; i++) {
    const space = isSpace(body.charCodeAt(i));
    if (!space && !inWord) words++;
    inWord = !space;
  }
  return words;
}

/** Words in the body (front-matter left out). */
export function wordCount(text: string): number {
  return wordsIn(splitFrontMatter(text).body);
}

/** Reading time at 230 words a minute (§5.1), at least one minute. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / 230));
}

/**
 * Whether `rel` is not a plain relative path, so the reader always refuses it (checked before any file system call):
 * not a string, empty, too long, a NUL, a backslash (also every UNC path), absolute (also `//host`), a drive letter, or
 * leaving upward from the start (`..`, `../x`, `./../x`, `a/../../x`). A `..` further in that stays inside is left to
 * the shell's containment check.
 */
export function refusedShape(rel: unknown): boolean {
  if (typeof rel !== "string" || !rel || rel.length > 1000) return true;
  if (rel.includes("\0") || rel.includes("\\")) return true;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return true;
  // Like path.posix.normalize(rel) starting with "..": some ".." climbs above the start.
  let depth = 0;
  for (const part of rel.split("/")) {
    if (part === "..") {
      if (depth === 0) return true;
      depth--;
    } else if (part !== "" && part !== ".") depth++;
  }
  return false;
}

/** A Markdown document the reader opens and cards are made for: `.md`, any case. */
export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** What a card shows of a document. `kind` only when the front-matter has one. */
export function summarizeDocument(path: string, text: string): { title: string; kind?: string; words: number } {
  const fm = splitFrontMatter(text);
  const kind = fm.data.kind?.trim();
  return { title: titleOf(path, fm), ...(kind ? { kind } : {}), words: wordsIn(fm.body) };
}

export interface TemplateResult {
  kind: string;
  /** The harness does not declare this kind. */
  unknownKind?: true;
  /** Required sections not found, in the template's order. */
  missing: string[];
  /** The front-matter status is not in the kind's list. */
  badStatus?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The template check (§4.3). Null: nothing to check (no `kind`, or the harness declares no kinds). Never blocks. */
export function checkTemplate(
  kinds: Record<string, DocumentKind> | undefined,
  front: Record<string, string>,
  sections: string[],
): TemplateResult | null {
  const kind = front.kind?.trim();
  if (!kind || !kinds || Object.keys(kinds).length === 0) return null;
  if (!Object.hasOwn(kinds, kind)) return { kind, unknownKind: true, missing: [] };
  const def = kinds[kind];
  const have = new Set(sections.map(norm));
  const missing = def.sections.filter((s) => !have.has(norm(s)));
  const status = front.status?.trim();
  return { kind, missing, ...(status && def.status && !def.status.includes(status) ? { badStatus: status } : {}) };
}
