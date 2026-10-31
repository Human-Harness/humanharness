// The documents per kind (search spec §3, §9).
import { splitFrontMatter } from "@humanharness/harness-sdk/documents";
import { MAX_TEXT_BYTES } from "./limits";
import { secretShaped, withoutSecretLines } from "./secrets";
import type { DataRow, DataSource, SearchDoc } from "./types";

export const APP_SCOPE = "_app";
export const MAIN_SCOPE = "main";
export const NOTES_DIR = ".harness/notes/";
export const CHATS_DIR = ".harness/chats/";
export const FOLDER_ROOT = "folder";
export const refRoot = (id: string): string => `ref:${id}`;
export const isRefRoot = (root: string | undefined): boolean => typeof root === "string" && root.startsWith("ref:");

/** A file's key in `files.json`: its root, a slash, its path (a root key never holds a slash). */
export const fileKey = (root: string, rel: string): string => `${root}/${rel}`;
export function splitKey(key: string): { root: string; rel: string } {
  const i = key.indexOf("/");
  return { root: key.slice(0, i), rel: key.slice(i + 1) };
}

export const isNotePath = (root: string, rel: string): boolean => root === FOLDER_ROOT && rel.startsWith(NOTES_DIR) && rel.endsWith(".md");
export const docIdFor = (root: string, rel: string): string => (isNotePath(root, rel) ? `note:${rel}` : `file:${fileKey(root, rel)}`);
export const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);
export const isMarkdown = (rel: string): boolean => /\.(md|markdown)$/i.test(rel);

const TITLE_CHARS = 80;
const cut = (s: string) => (s.length > TITLE_CHARS ? `${s.slice(0, TITLE_CHARS - 1)}…` : s);

/** `notes/<scope>/x.md` is that scope's; a note directly in `notes/` is `main` without scopes, `_app` with them. */
export function noteScope(rel: string, scoped: boolean): string {
  if (!scoped) return MAIN_SCOPE;
  const rest = rel.slice(NOTES_DIR.length);
  const slash = rest.indexOf("/");
  return slash < 0 ? APP_SCOPE : rest.slice(0, slash);
}

/** The front matter's `title`, else the first `# ` heading, else the file's name. */
export function noteTitle(text: string | null, rel: string): string {
  if (text) {
    const { data, body } = splitFrontMatter(text);
    if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
    const h = /^#\s+(.+?)\s*$/m.exec(body);
    if (h) return h[1];
  }
  return baseName(rel).replace(/\.md$/i, "");
}

export interface FileInput {
  root: string;
  rel: string;
  mtimeMs: number;
  /** Null: indexed by name and path only. */
  text: string | null;
  scoped: boolean;
}

/** A file of the folder or a reference folder; a `.md` under `.harness/notes/` of the folder is a note. */
export function fileDoc(f: FileInput): SearchDoc {
  const note = isNotePath(f.root, f.rel);
  const text = f.text === null ? "" : note ? withoutSecretLines(f.text) : f.text;
  return {
    id: docIdFor(f.root, f.rel),
    kind: note ? "note" : "file",
    scope: note ? noteScope(f.rel, f.scoped) : f.scoped ? APP_SCOPE : MAIN_SCOPE,
    title: note ? noteTitle(text, f.rel) : baseName(f.rel),
    path: f.rel,
    text,
    at: Math.round(f.mtimeMs),
    root: f.root,
  };
}

/** A line of a chat file: its byte offset and length (without the newline) and its text. */
export interface ChatLine {
  offset: number;
  length: number;
  line: string;
}

/** `chats/<scope>.jsonl` or, in board mode, `chats/<scope>/<task>.jsonl`. */
export function chatScope(rel: string): string {
  const rest = rel.slice(CHATS_DIR.length);
  const slash = rest.indexOf("/");
  return slash >= 0 ? rest.slice(0, slash) : rest.replace(/\.jsonl$/, "");
}

export const chatDocId = (rel: string, entry: string): string => `chat:${rel}#${entry}`;

/** One document per chat entry with text (the person's messages and the agent's answers); app lines are left out. */
export function chatDocs(rel: string, lines: readonly ChatLine[]): SearchDoc[] {
  const scope = chatScope(rel);
  const out: SearchDoc[] = [];
  for (const l of lines) {
    let e: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(l.line);
      if (!parsed || typeof parsed !== "object") continue;
      e = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.id !== "string" || !e.id || typeof e.text !== "string") continue;
    if (e.notice !== undefined || e.mode !== undefined || e.phase !== undefined || e.timeUp !== undefined) continue;
    const text = withoutSecretLines(e.text).trim();
    if (!text) continue;
    const first = text.split("\n").find((s) => s.trim())?.trim() ?? "";
    const task = typeof e.task === "string" ? e.task : undefined;
    out.push({
      id: chatDocId(rel, e.id),
      kind: "task",
      scope,
      title: cut(first),
      path: "",
      text,
      at: Date.parse(String(e.at)) || 0,
      chat: { file: rel, offset: l.offset, length: l.length, entry: e.id, ...(task ? { task } : {}) },
      meta: { role: e.role === "assistant" ? "assistant" : "user" },
    });
  }
  return out;
}

/** The ids of what is rebuilt in memory on each open (§4.2): actions, the open task, past tasks. */
export const MEMORY_PREFIXES = ["action:", "open:", "past:"] as const;

export interface ActionInput {
  id: string;
  label: string;
  description?: string;
  tier?: string;
  status?: "done" | "unsaved" | "unfinished";
  scope: string;
}

export function actionDocs(list: readonly ActionInput[]): SearchDoc[] {
  return list.map((a) => ({
    id: `action:${a.id}`,
    kind: "task",
    scope: a.scope,
    title: a.label,
    path: "",
    text: a.description ?? "",
    at: 0,
    action: a.id,
    meta: { status: a.status ?? "not-started", ...(a.tier ? { tier: a.tier } : {}) },
  }));
}

export interface TaskInput {
  id: string;
  title: string;
  scope: string;
  at: number;
}

export const openTaskDoc = (t: TaskInput): SearchDoc => ({ id: `open:${t.id}`, kind: "task", scope: t.scope, title: t.title, path: "", text: "", at: t.at, task: t.id, meta: { status: "open" } });

export const pastTaskDocs = (list: readonly TaskInput[]): SearchDoc[] =>
  list.map((t) => ({ id: `past:${t.id}`, kind: "task", scope: t.scope, title: t.title, path: "", text: "", at: t.at, task: t.id, meta: { status: "past" } }));

/** A record's key as text: `""` for the one record of a `single` collection (data-meta's key for it). */
export const recordKeyText = (key: string | number | null): string => (key === null ? "" : String(key));
export const dataDocId = (source: string, key: string | number | null): string => `data:${source}#${recordKeyText(key)}`;
/** At most this many records across every searchable collection: main's memory stays bounded (plan deviation 5). */
export const MAX_DATA_DOCS = 20_000;

/** A field's value as searchable text: strings, numbers, booleans and lists of them; anything else is skipped. */
export function fieldText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" || typeof x === "number").join(", ");
  return "";
}

/** What `recordRows` needs of a collection: its key (or `single`) and its `search`. */
export interface RecordSearch {
  key?: string;
  single: boolean;
  search: { title: string; text?: string | readonly string[] };
}

/**
 * A short hash of what decides a collection's rows besides its records (its key, `single`, its `search`), for a
 * source's stamp: a declaration that changes reads the records again. FNV-1a, so it runs anywhere (main, the worker).
 */
export function declarationStamp(c: RecordSearch): string {
  const text = JSON.stringify([c.key ?? null, c.single, c.search]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The records of one collection as rows (D4): the declared title (else the key), the declared text fields joined by
 * lines without token-shaped ones (§8.2) and capped as a file's text is (§4.5), and when each changed (data-meta, by
 * key text). Skipped: a record with no usable key, a token-shaped key (it would be the id and maybe the title), and a
 * key whose text an earlier record already has (`1` and `"1"` are one document id: the first record wins). Whatever
 * finds a row again by its key (a snippet) matches on `recordKeyText` too.
 */
export function recordRows(records: readonly Record<string, unknown>[], c: RecordSearch, changedAt: Record<string, string> = {}): DataRow[] {
  const textFields = c.search.text === undefined ? [] : typeof c.search.text === "string" ? [c.search.text] : [...c.search.text];
  const out: DataRow[] = [];
  const seen = new Set<string>();
  for (const r of c.single ? records.slice(0, 1) : records) {
    const raw = c.single ? null : r[c.key ?? ""];
    const key = c.single ? null : typeof raw === "string" || typeof raw === "number" ? raw : undefined;
    if (key === undefined) continue;
    const keyText = recordKeyText(key);
    if (seen.has(keyText) || secretShaped(keyText)) continue;
    const named = fieldText(r[c.search.title]).trim();
    const title = named && !secretShaped(named) ? cut(named) : keyText;
    if (!title) continue;
    seen.add(keyText);
    const text = withoutSecretLines(textFields.map((f) => fieldText(r[f])).filter(Boolean).join("\n")).slice(0, MAX_TEXT_BYTES);
    out.push({ key, title, text, at: Date.parse(changedAt[keyText] ?? "") || 0 });
  }
  return out;
}

/** One `data` document per row. Its scope (§7): `main` without scopes; else a scoped harness folder, or `_app`. */
export function dataDocs(s: DataSource, rows: readonly DataRow[], scoped: boolean): SearchDoc[] {
  const scope = !scoped ? MAIN_SCOPE : s.owner === "harness" && s.folder !== APP_SCOPE ? s.folder : APP_SCOPE;
  return rows.map((r) => ({
    id: dataDocId(s.id, r.key),
    kind: "data",
    scope,
    title: r.title,
    path: "",
    text: r.text,
    at: r.at,
    data: {
      source: s.id,
      owner: s.owner,
      ...(s.plugin ? { plugin: s.plugin } : {}),
      ...(s.pluginName ? { pluginName: s.pluginName } : {}),
      ...(s.panel ? { panel: s.panel } : {}),
      collection: s.collection,
      folder: s.folder,
      key: r.key,
    },
  }));
}
