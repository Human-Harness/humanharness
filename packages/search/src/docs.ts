// The documents per kind (search spec §3, §9).
import { splitFrontMatter } from "@humanharness/harness-sdk/documents";
import { withoutSecretLines } from "./secrets";
import type { SearchDoc } from "./types";

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
