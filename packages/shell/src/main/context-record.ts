import path from "node:path";
import type { Event } from "@humanharness/runtime";
import type { ContextItem, ContextRead } from "@humanharness/ui/client";

/** How many start items tasks.json keeps for a task: a bound on a hand-edited file. */
export const START_ITEMS_MAX = 100;
/** How many reads and tools tasks.json keeps for a task (context-panel spec §3.2). */
export const READS_MAX = 500;
/** How many paths of one activity are recorded. */
export const PATHS_PER_EVENT = 20;
/** How many notes a notes-index item lists. */
export const INDEX_NOTES_MAX = 50;

/** The panel's estimate (§3.1, "aprox."): characters / 4, rounded to 100; at least 100 for any text, 0 for none. */
export function approxTokens(chars: number): number {
  if (!(chars > 0)) return 0;
  return Math.max(100, Math.round(chars / 4 / 100) * 100);
}

/** `p` relative to `base`, forward slashes; a relative `p` is taken from `base`. Null for `base` itself and anything outside. */
export function folderPath(base: string, p: string): string | null {
  const rel = path.relative(base, path.resolve(base, p));
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** One read or tool a turn showed, before it is merged into the task's list. */
export type SeenRead = { kind: "read" | "tool"; label: string; path?: string };

type Activity = Extract<Event, { type: "activity" }>;

/** Longest label kept for a read or tool. */
export const LABEL_MAX = 200;

/** The label a search gets: where it looked, never with a `path` (it is usually a folder: no Pin, no open). */
const searchLabel = (where: string): string => `Search · ${where}`.slice(0, LABEL_MAX);

/**
 * What an activity's start says the agent read (Read, Grep, Glob; Codex read and search) or which MCP tool it used.
 * Only a read (Claude's `Read`, Codex's `read`) keeps a `path`; a search (Grep, Glob, Codex's `search`) names a folder
 * or a pattern's root, so it is a label only: "Search · src", "Search · whole folder".
 * `base` may be several spellings of the folder (as given and its real path): an engine reports paths under the real
 * one when the folder sits behind a link (macOS's /var → /private/var); the first that holds the path wins.
 */
export function readsOf(e: Activity, base: string | readonly string[] | null): SeenRead[] {
  if (e.state !== "start") return [];
  if (e.tool) return e.tool.server ? [{ kind: "tool", label: (e.tool.name ? `${e.tool.server} · ${e.tool.name}` : e.tool.server).slice(0, LABEL_MAX) }] : [];
  if ((e.kind !== "read" && e.kind !== "search") || !e.paths) return [];
  const bases = base === null ? [] : typeof base === "string" ? [base] : base;
  return e.paths.slice(0, PATHS_PER_EVENT).map((p): SeenRead => {
    let rel: string | null = null;
    for (const b of bases) if (rel === null) rel = folderPath(b, p);
    if (e.kind === "search") {
      const isFolder = bases.some((b) => path.resolve(b, p) === path.resolve(b));
      return { kind: "read", label: searchLabel(rel ?? (isFolder ? "whole folder" : path.basename(p) || p)) };
    }
    return rel ? { kind: "read", label: rel.slice(0, LABEL_MAX), path: rel } : { kind: "read", label: (path.basename(p) || p).slice(0, LABEL_MAX) };
  });
}

const keyOf = (r: { kind: string; label: string; path?: string }): string => (r.path !== undefined ? `path:${r.path}` : `${r.kind}:${r.label}`);

/** The task's reads with `seen` (one turn's) merged in at `at`: counts grow, a read again is no longer compacted. */
export function mergeReads(reads: readonly ContextRead[], seen: readonly SeenRead[], at: string): ContextRead[] {
  const out = reads.map((r) => ({ ...r }));
  const index = new Map(out.map((r, i) => [keyOf(r), i]));
  for (const s of seen) {
    const i = index.get(keyOf(s));
    if (i !== undefined) {
      const { compacted: _c, ...rest } = out[i];
      out[i] = { ...rest, count: rest.count + 1 };
    } else if (out.length < READS_MAX) {
      index.set(keyOf(s), out.length);
      out.push({ kind: s.kind, label: s.label, ...(s.path !== undefined ? { path: s.path } : {}), firstAt: at, count: 1 });
    }
  }
  return out;
}

/** Everything recorded so far, marked as possibly summarized (§3.2 "Compaction"). */
export function markCompacted<T extends ContextItem | ContextRead>(items: readonly T[]): T[] {
  return items.map((i) => ({ ...i, compacted: true as const }));
}
