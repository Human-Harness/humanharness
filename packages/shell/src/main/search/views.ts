import type { SearchHitView, SearchMarked, SearchTarget } from "@humanharness/protocol";
import { type SearchHit, baseName, isMarkdown, isRefRoot, markFirst } from "@humanharness/search";

export interface ViewContext {
  /** `ref:<id>` → the reference folder's label. */
  refLabels: Map<string, string>;
  /** A scope's title when the row must say it (another scope); undefined otherwise. */
  scopeTitle: (scope: string) => string | undefined;
  snippet?: { marked: SearchMarked; anchor?: string };
}

/** What Enter does (§3). A reference folder's file that isn't `.md` is shown in Finder by main (`reveal`). */
export function targetOf(hit: SearchHit, anchor?: string): SearchTarget {
  if (hit.id.startsWith("action:") && hit.action) return { kind: "action", action: hit.action };
  if (hit.id.startsWith("open:") && hit.task) return { kind: "open-task", task: hit.task };
  if (hit.id.startsWith("past:") && hit.task) return { kind: "history", task: hit.task };
  if (hit.chat) return { kind: "chat", entry: hit.chat.entry, scope: hit.scope, ...(hit.chat.task ? { task: hit.chat.task } : {}) };
  // A reference folder's .md opens in the reader by its relative path (plan deviation 14).
  if (isMarkdown(hit.path)) return { kind: "document", path: hit.path, ...(anchor ? { anchor } : {}) };
  return isRefRoot(hit.root) ? { kind: "reveal" } : { kind: "timeline", path: hit.path };
}

/** What ⌘Enter may name (§5.4): never a reference file's full path, never a chat line. */
function hintOf(hit: SearchHit, ref: boolean): SearchHitView["hint"] {
  if (hit.kind === "file") return ref ? { kind: "name", text: baseName(hit.path) } : { kind: "path", text: hit.path };
  if (hit.kind === "note") return { kind: "note", text: hit.title };
  return hit.chat ? null : { kind: "task", text: hit.title };
}

export function hitView(hit: SearchHit, c: ViewContext): SearchHitView {
  const folder = isRefRoot(hit.root) ? c.refLabels.get(hit.root!) : undefined;
  const scope = c.scopeTitle(hit.scope);
  return {
    id: hit.id,
    kind: hit.kind,
    title: markFirst(hit.title, hit.terms),
    context: c.snippet?.marked ?? (hit.kind === "task" ? [] : [{ text: hit.path }]),
    ...(hit.meta ? { meta: hit.meta } : {}),
    ...(folder !== undefined ? { folder } : {}),
    ...(scope !== undefined ? { scope } : {}),
    hint: hintOf(hit, folder !== undefined),
    target: targetOf(hit, c.snippet?.anchor),
  };
}
