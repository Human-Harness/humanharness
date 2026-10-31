// The global search's documents and hits (search spec §3, §9). Pure: no Node, no Electron.

/** Plan 1's kinds; plan 2 adds settings, commands and data. */
export type Kind = "task" | "note" | "file";
export const KINDS: readonly Kind[] = ["task", "note", "file"];

/** What a task-like row says besides its title (the window localizes it). */
export interface DocMeta {
  status?: "not-started" | "done" | "unsaved" | "unfinished" | "open" | "past";
  tier?: string;
  role?: "user" | "assistant";
}

/** Where a chat entry's line is: its file (relative to the base), byte offset and length. */
export interface ChatRef {
  file: string;
  offset: number;
  length: number;
  entry: string;
  task?: string;
}

/** One searchable thing. `text` is indexed and never stored (§4.1). */
export interface SearchDoc {
  id: string;
  kind: Kind;
  /** A scope id, `_app`, or `main` (§7). */
  scope: string;
  title: string;
  /** Relative to its root (files and notes); "" otherwise. */
  path: string;
  text?: string;
  /** Last change, ms since the epoch (0: unknown); the recency boost reads it. */
  at: number;
  /** `folder`, or `ref:<id>` for a reference folder. */
  root?: string;
  chat?: ChatRef;
  action?: string;
  task?: string;
  meta?: DocMeta;
}

export type StoredDoc = Omit<SearchDoc, "text">;

/** A query's match: the stored fields, its score and the index terms it matched (already folded). */
export interface SearchHit extends StoredDoc {
  score: number;
  terms: string[];
}

/** Staged readiness (D8): memory → names → text. */
export interface IndexState {
  state: "empty" | "names" | "building" | "ready";
  done: number;
  total: number;
  truncated?: true;
}

/** How a file was indexed (`files.json`, §4.1). */
export interface FileMeta {
  size: number;
  mtimeMs: number;
  how: "text" | "name-only" | `skipped:${string}`;
}

/** A chat file read up to `size` bytes, and the ids of its entries in the index. */
export interface ChatMeta {
  size: number;
  ids: string[];
  /**
   * The file read (`dev:ino:birthtimeMs`): an archived conversation is renamed away and a new one starts at the same
   * path, so another file there means starting over. Missing (an older snapshot): unknown, read again from the start.
   */
  identity?: string;
}
