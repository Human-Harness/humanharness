import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SavedNote } from "@humanharness/harness-sdk";

/** Where notes live, relative to the folder (forward slashes, as the history and the index show it). */
export const NOTES_PREFIX = ".harness/notes/";

/** What the app adds to a note the agent saved. */
export interface NoteMeta {
  /** The manifest action of the task; absent for a free question. */
  action?: string;
  date: string;
  engine: string;
}

export interface Note extends SavedNote, NoteMeta {
  /** File name without `.md`. */
  slug: string;
  /** Path relative to the folder: `.harness/notes/<slug>.md`. */
  path: string;
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** A file-safe slug: lowercase ascii letters, digits and dashes, at most 60 characters; "note" when nothing is left. */
export function noteSlug(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "note";
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
const section = (title: string, items: string[]) => [`## ${title}`, ...items.map((i) => `- ${oneLine(i)}`)];

/** The note as Markdown: JSON-quoted front matter values (valid YAML), then Summary, Decisions and Open questions. */
export function renderNote(note: SavedNote, meta: NoteMeta): string {
  return [
    "---",
    `title: ${JSON.stringify(oneLine(note.title))}`,
    ...(meta.action ? [`action: ${JSON.stringify(meta.action)}`] : []),
    `date: ${JSON.stringify(meta.date)}`,
    `engine: ${JSON.stringify(meta.engine)}`,
    `files: ${JSON.stringify(note.files)}`,
    "---",
    ...section("Summary", note.summary),
    ...(note.decisions.length ? ["", ...section("Decisions", note.decisions)] : []),
    ...(note.open.length ? ["", ...section("Open questions", note.open)] : []),
    "",
  ].join("\n");
}

/** Writes `.harness/notes/<slug>.md` atomically (temp file + rename). Returns its path relative to the folder. */
export async function writeNote(folder: string, slug: string, note: SavedNote, meta: NoteMeta): Promise<string> {
  if (!SLUG.test(slug)) throw new Error(`Invalid note slug: "${slug}"`);
  const dir = path.join(folder, NOTES_PREFIX);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, renderNote(note, meta));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return `${NOTES_PREFIX}${slug}.md`;
}

/** Reads a note file; null when it has no front matter or no title (e.g. the person broke it by hand). */
export function parseNote(slug: string, text: string): Note | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const front: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      front[key] = JSON.parse(raw);
    } catch {
      front[key] = raw;
    }
  }
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of m[2].split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      sections[current] = [];
      continue;
    }
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (current && item) sections[current].push(item[1]);
  }
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const title = str(front.title);
  if (!title) return null;
  const action = str(front.action);
  return {
    slug,
    path: `${NOTES_PREFIX}${slug}.md`,
    title,
    ...(action ? { action } : {}),
    date: str(front.date) ?? "",
    engine: str(front.engine) ?? "",
    files: Array.isArray(front.files) ? front.files.filter((f): f is string => typeof f === "string") : [],
    summary: sections.summary ?? [],
    decisions: sections.decisions ?? [],
    open: sections["open questions"] ?? [],
  };
}

/** Every readable note in the folder, newest first. */
export async function readNotes(folder: string): Promise<Note[]> {
  const dir = path.join(folder, NOTES_PREFIX);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const notes: Note[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    if (!SLUG.test(slug)) continue;
    const note = parseNote(slug, await fs.readFile(path.join(dir, file), "utf8").catch(() => ""));
    if (note) notes.push(note);
  }
  return notes.sort((a, b) => b.date.localeCompare(a.date));
}
