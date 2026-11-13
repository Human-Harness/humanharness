// The UI/core contract lives in @humanharness/protocol (replaceable parts §5). The views import it from here,
// together with the helpers only views use.
import type { AnswerPart, ChatEntry, EngineStatus, HarnessClient, LayoutView } from "@humanharness/protocol";

export * from "@humanharness/protocol";

/** The entry's answer in order; an entry saved before `parts` existed shows its text, then its blocks. */
export function partsOf(entry: Pick<ChatEntry, "text" | "blocks" | "parts">): AnswerPart[] {
  if (entry.parts) return entry.parts;
  return [...(entry.text ? [{ text: entry.text }] : []), ...entry.blocks.map((_, block) => ({ block }))];
}

export type EngineProblem = "notice" | "not-installed" | "outdated" | "logged-out" | "untested";

/** The first thing left to do before the engine can run turns, or null when it is ready. */
export function engineProblem(s: EngineStatus): EngineProblem | null {
  if (!s.noticeAccepted) return "notice";
  if (!s.installed) return "not-installed";
  if (s.outdated) return "outdated";
  if (s.loggedIn === false) return "logged-out";
  if (!s.verified) return "untested";
  return null;
}

/** A layout file's tree (minimal-core spec §5.2). */
export type Layout = LayoutView["layout"];

/** The core's own layout, as the shell ships it: Home, and the work screen holding the task. */
export const CORE_LAYOUT: Layout = {
  type: "stack",
  children: [
    { type: "block", id: "home", content: { mod: "home", block: "home" } },
    { type: "block", id: "work", content: { core: "task" } },
  ],
};

/** The layout the screen shows: main's, or the core's when main has none to give or the call fails. */
export async function loadLayout(client: Pick<HarnessClient, "layout">): Promise<Layout> {
  if (!client.layout) return CORE_LAYOUT;
  try {
    return (await client.layout()).layout;
  } catch {
    return CORE_LAYOUT;
  }
}

/**
 * The layout the screen shows, live (0b2): one read, then every `hh:layoutChanged` (a change before the read wins).
 * Returns the unsubscribe.
 */
export function followLayout(client: Pick<HarnessClient, "layout" | "onLayoutChanged">, show: (layout: Layout) => void): () => void {
  let live = true;
  let changed = false;
  const off = client.onLayoutChanged?.((v) => {
    changed = true;
    if (live) show(v.layout);
  });
  void loadLayout(client).then((l) => {
    if (live && !changed) show(l);
  });
  return () => {
    live = false;
    off?.();
  };
}
