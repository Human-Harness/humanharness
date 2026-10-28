import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { refusedShape } from "@humanharness/harness-sdk/documents";
import { NOTES_PREFIX, contextFile } from "./layout";

/** Most pins and exclusions one scope keeps (a bound on a hand-edited file; `full` past it). */
export const PINS_MAX = 50;
export const EXCLUDED_MAX = 200;
/** Over this a pinned file never enters whole (spec §6). */
export const PIN_INLINE_MAX_BYTES = 1024 * 1024;
/** The budget when neither the person nor the manifest set one (spec §4.2). */
export const DEFAULT_PINNED_TOKENS = 3000;
/** How far into a file its title is looked for. */
const TITLE_SCAN = 2048;
const TITLE_MAX = 120;

export interface Pin {
  path: string;
  at: string;
}
export interface Exclusion {
  note: string;
  at: string;
}
/** `.harness/context/<scope>.json`. */
export interface ContextFile {
  version: 1;
  pinned: Pin[];
  excluded: Exclusion[];
}

export const emptyContext = (): ContextFile => ({ version: 1, pinned: [], excluded: [] });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** Built field by field: a path of the wrong shape, a bad time or a duplicate is dropped; the lists are bounded. */
export function cleanContext(raw: unknown): ContextFile {
  if (!isObject(raw) || raw.version !== 1) return emptyContext();
  const pinned: Pin[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw.pinned) ? raw.pinned : []) {
    if (!isObject(p) || refusedShape(p.path) || !isTime(p.at) || seen.has(p.path as string)) continue;
    seen.add(p.path as string);
    pinned.push({ path: p.path as string, at: p.at });
    if (pinned.length === PINS_MAX) break;
  }
  const excluded: Exclusion[] = [];
  const notes = new Set<string>();
  for (const e of Array.isArray(raw.excluded) ? raw.excluded : []) {
    // Only a note can be excluded: a path outside the notes folder is dropped.
    if (!isObject(e) || refusedShape(e.note) || !(e.note as string).startsWith(NOTES_PREFIX) || !isTime(e.at) || notes.has(e.note as string)) continue;
    notes.add(e.note as string);
    excluded.push({ note: e.note as string, at: e.at });
    if (excluded.length === EXCLUDED_MAX) break;
  }
  return { version: 1, pinned, excluded };
}

/**
 * A scope's pins and exclusions; a missing, unreadable or broken file reads as empty (the next write replaces it). A
 * bad scope throws, as `saveContext` does: it never reads as an empty file.
 */
export async function loadContext(base: string, scope: string): Promise<ContextFile> {
  const file = contextFile(base, scope);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return emptyContext();
  }
  try {
    return cleanContext(JSON.parse(text));
  } catch {
    return emptyContext();
  }
}

/** Atomic: temp file + rename. A file with nothing in it is removed, so a scope back to none leaves no file (D0). */
export async function saveContext(base: string, scope: string, file: ContextFile): Promise<void> {
  const target = contextFile(base, scope);
  const clean = cleanContext(file);
  if (clean.pinned.length === 0 && clean.excluded.length === 0) {
    await fs.rm(target, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2));
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** What is known of a pinned file before the budget is applied. `size` null: missing (or no longer safe to read). */
export interface PinFacts {
  scope: string;
  path: string;
  at: string;
  size: number | null;
  binary: boolean;
}

/** A pin's state for the next task (spec §4.2, §6), in the order given (the scope's pins, then the app's). */
export interface PinLayout {
  scope: string;
  path: string;
  at: string;
  state: "full" | "title" | "missing" | "binary";
  /** bytes / 4: the same number for the panel and the message. */
  tokens: number;
}

/**
 * Pins enter whole in order while they fit `budget`; the first that doesn't fit and every pin after it enter as title
 * only. A file over 1 MB is always title only and spends nothing. Missing and binary pins are skipped.
 */
export function pinsLayout(pins: readonly PinFacts[], budget: number): PinLayout[] {
  let used = 0;
  let spent = false;
  return pins.map((p): PinLayout => {
    const base = { scope: p.scope, path: p.path, at: p.at };
    if (p.size === null) return { ...base, state: "missing", tokens: 0 };
    if (p.binary) return { ...base, state: "binary", tokens: 0 };
    const tokens = Math.ceil(p.size / 4);
    if (p.size > PIN_INLINE_MAX_BYTES) return { ...base, state: "title", tokens };
    if (!spent && used + tokens <= budget) {
      used += tokens;
      return { ...base, state: "full", tokens };
    }
    spent = true;
    return { ...base, state: "title", tokens };
  });
}

/** A fence one backtick longer than the longest backtick run in `text` (at least three). A loop, never a regex. */
export function fenceFor(text: string): string {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 96) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** The first `# ` heading in the first 2 KB, else the file's name (spec §4.2 "title and path"). */
export function titleOf(text: string, file: string): string {
  const head = text.slice(0, TITLE_SCAN);
  let start = 0;
  while (start <= head.length) {
    const end = head.indexOf("\n", start);
    // A line cut by the 2 KB edge is not trusted as a title.
    if (end === -1 && text.length > TITLE_SCAN) break;
    const line = head.slice(start, end === -1 ? head.length : end);
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      if (title) return title.slice(0, TITLE_MAX);
    }
    if (end === -1) break;
    start = end + 1;
  }
  return file.slice(file.lastIndexOf("/") + 1);
}

/** One whole pin: its path as a heading and its text in a fence. */
export function pinBlock(file: string, text: string): string {
  const fence = fenceFor(text);
  return [`### ${file}`, "", fence, text.endsWith("\n") ? text.slice(0, -1) : text, fence].join("\n");
}

/** One title-only pin. */
export const pinTitleLine = (title: string, file: string): string => `- ${title} → ${file}`;

/** The section after the data tables (spec §4.2); "" without pins (D0). */
export function pinnedSection(blocks: readonly string[], titles: readonly string[]): string {
  if (blocks.length === 0 && titles.length === 0) return "";
  const parts = ["## Pinned by the person"];
  for (const b of blocks) parts.push("", b);
  if (titles.length > 0) parts.push("", "### Also pinned", ...titles, "", "Open these with your read tool when you need them.");
  return parts.join("\n");
}
