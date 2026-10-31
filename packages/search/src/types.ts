// The global search's documents and hits (search spec §3, §9). Pure: no Node, no Electron.

/** Plan 1's kinds, and plan 2's opt-in data records (D4). Settings and commands never enter the index (§4.2). */
export type Kind = "task" | "note" | "file" | "data";
/** Plan 1's file-backed kinds (the worker's). */
export const KINDS: readonly Kind[] = ["task", "note", "file"];
/** Every kind the index answers, in the palette's order (§3). */
export const INDEX_KINDS: readonly Kind[] = ["task", "note", "file", "data"];

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
  /** A record of a searchable collection: where it is and what opens it. */
  data?: DataRef;
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

/**
 * A searchable collection's records in one place (D4): a harness collection in one scope folder, or a running
 * plugin's collection. Built by main; the service reads it again only when `stamp` changes.
 */
export interface DataSource {
  /** `harness:<folder>/<collection>` or `plugin:<plugin>/<collection>`. */
  id: string;
  owner: "harness" | "plugin";
  plugin?: string;
  /** The plugin's name, for the row's tag. */
  pluginName?: string;
  /** The panel a plugin record opens in; absent: none opens. */
  panel?: string;
  collection: string;
  /** The scope folder the store reads (`_app`, a scope id, or `main`). */
  folder: string;
  /** The collection file's size and mtime (and the panel): unchanged, its records aren't read again. */
  stamp: string;
}

/** One record as search sees it: its key (null for a `single` collection), title, text and last change. */
export interface DataRow {
  key: string | number | null;
  title: string;
  text: string;
  at: number;
}

/** What a data document stores to open its record (never the text). */
export type DataRef = Omit<DataSource, "id" | "stamp"> & { source: string; key: string | number | null };

/** A source's state in `files.json`: the stamp it was read at and its documents. */
export interface DataMeta {
  stamp: string;
  ids: string[];
}
