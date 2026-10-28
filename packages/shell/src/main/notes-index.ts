import { APP_SCOPE, type Note, buildNotesIndex } from "@humanharness/workspace";

/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"). */
export const APP_INDEX_TOKENS = 500;

/**
 * The notes part of a new session's first message (spec §3.3): the scope's notes index; in a scope, the app-wide one,
 * trimmed, after it. Without scopes, the index of the flat notes folder (D2). Shared by a task's and a job run's first
 * message (its own module, so the jobs code never imports task-manager.ts).
 */
export async function notesIndexFor(notes: (scope?: string) => Promise<Note[]>, scoped: boolean, scope: string): Promise<string> {
  const own = buildNotesIndex(await notes(scoped ? scope : undefined).catch(() => [] as Note[]));
  if (!scoped || scope === APP_SCOPE) return own;
  const app = await notes(APP_SCOPE).catch(() => [] as Note[]);
  // The own index ends with the "open a note" line; the app-wide one says it only when it stands alone.
  const appIndex = buildNotesIndex(app, {
    budgetTokens: APP_INDEX_TOKENS,
    heading: "## App-wide notes",
    decisionsHeading: "## App-wide decisions",
    ...(own ? { footer: null } : {}),
  });
  return [own, appIndex].filter(Boolean).join("\n\n");
}
