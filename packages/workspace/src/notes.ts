import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SavedNote } from "@humanharness/harness-sdk";
import { NOTES_PREFIX, isScopeDir } from "./layout";

/** What the app adds to a note the agent saved. */
export interface NoteMeta {
  /** The manifest action of the task; absent for a free question. */
  action?: string;
  date: string;
  engine: string;
  /** The modes the task used, in first-use order (task-modes spec §6). Absent without modes (D0). */
  modes?: string[];
}

export interface Note extends SavedNote, NoteMeta {
  /** File name without `.md`. */
  slug: string;
  /** Path relative to the folder: `.harness/notes/<slug>.md`. */
  path: string;
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** `.harness/notes/` or `.harness/notes/<scope>/`: anything else could write outside the notes. */
function checkPrefix(prefix: string): string {
  if (prefix === NOTES_PREFIX) return prefix;
  const scope = prefix.startsWith(NOTES_PREFIX) && prefix.endsWith("/") ? prefix.slice(NOTES_PREFIX.length, -1) : "";
  if (!isScopeDir(scope)) throw new Error(`Invalid notes folder: "${prefix}"`);
  return prefix;
}

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
    ...(meta.modes && meta.modes.length > 0 ? [`modes: ${JSON.stringify(meta.modes)}`] : []),
    `files: ${JSON.stringify(note.files)}`,
    "---",
    ...section("Summary", note.summary),
    ...(note.decisions.length ? ["", ...section("Decisions", note.decisions)] : []),
    ...(note.open.length ? ["", ...section("Open questions", note.open)] : []),
    "",
  ].join("\n");
}

/** A path inside `folder`, made relative to it (forward slashes); anything else stays as given. */
export function folderRelative(folder: string, file: string): string {
  if (!path.isAbsolute(file)) return file;
  const rel = path.relative(folder, file);
  // Only `..` as a whole segment leaves the folder: `..notes.md` is a file inside it.
  const outside = rel === ".." || rel.startsWith(`..${path.sep}`);
  return rel && !outside && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file;
}

/** Writes `<prefix><slug>.md` atomically (temp file + rename). Returns its path relative to the folder. */
export async function writeNote(folder: string, slug: string, note: SavedNote, meta: NoteMeta, prefix: string = NOTES_PREFIX): Promise<string> {
  if (!SLUG.test(slug)) throw new Error(`Invalid note slug: "${slug}"`);
  const dir = path.join(folder, checkPrefix(prefix));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    // A note outlives the folder's place (it can move): paths inside the folder are kept relative.
    await fs.writeFile(tmp, renderNote({ ...note, files: note.files.map((f) => folderRelative(folder, f)) }, meta));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return `${prefix}${slug}.md`;
}

/**
 * After the folder moved from `oldFolder`: `files:` entries in the notes' front matter that name the old
 * place become relative, in `.harness/notes/` and in each scope's folder under it. Nothing else in a note
 * changes (BOM and line ends included). A note that can't be read or rewritten is skipped and logged: it only
 * keeps naming the old place, which must not undo a move. Returns how many notes were rewritten.
 */
export async function relativizeNoteFiles(folder: string, oldFolder: string): Promise<number> {
  const root = path.join(folder, NOTES_PREFIX);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = [root, ...entries.filter((e) => e.isDirectory() && isScopeDir(e.name)).map((e) => path.join(root, e.name))];
  let rewritten = 0;
  for (const dir of dirs) rewritten += await relativizeIn(dir, oldFolder);
  return rewritten;
}

async function relativizeIn(dir: string, oldFolder: string): Promise<number> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md"));
  let rewritten = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      console.error(`Could not read the note ${name}`, err);
      continue;
    }
    // The closing fence is a line of its own: `----x` inside the front matter is not it.
    const front = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text);
    if (!front) continue;
    let changed = false;
    const head = front[0].replace(/^files: (.*)$/m, (line, raw: string) => {
      let files: unknown;
      try {
        files = JSON.parse(raw);
      } catch {
        return line;
      }
      if (!Array.isArray(files)) return line;
      const list: unknown[] = files;
      const next = list.map((f) => (typeof f === "string" ? folderRelative(oldFolder, f) : f));
      if (next.every((f, i) => f === list[i])) return line;
      changed = true;
      return `files: ${JSON.stringify(next)}`;
    });
    if (!changed) continue;
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, head + text.slice(front[0].length));
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      console.error(`Could not rewrite the note ${name}`, err);
      continue;
    }
    rewritten++;
  }
  return rewritten;
}

const unquote = (s: string): string => {
  const t = s.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t;
};

/** A front matter value: JSON as the app writes it, or what a person typed by hand (`[a, 'b']`, `'x'`, `x`). */
function frontValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      return inner ? inner.split(",").map(unquote).filter(Boolean) : [];
    }
    return unquote(raw);
  }
}

/** Reads a note file; null when it has no front matter or no title (e.g. the person broke it by hand). */
export function parseNote(slug: string, text: string, prefix: string = NOTES_PREFIX): Note | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));
  if (!m) return null;
  const front: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    front[key] = frontValue(raw);
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
    path: `${prefix}${slug}.md`,
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

/** Every readable note in `prefix` (the flat notes folder by default), newest first. Sub-folders are not read. */
export async function readNotes(folder: string, prefix: string = NOTES_PREFIX): Promise<Note[]> {
  const dir = path.join(folder, checkPrefix(prefix));
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
    const note = parseNote(slug, await fs.readFile(path.join(dir, file), "utf8").catch(() => ""), prefix);
    if (note) notes.push(note);
  }
  return notes.sort((a, b) => b.date.localeCompare(a.date));
}
