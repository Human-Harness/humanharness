import { APP_INDEX_TOKENS } from "@humanharness/policies";
import { APP_SCOPE, type Note, buildNotesIndex } from "@humanharness/workspace";

/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"); `DefaultContextPolicy`'s, kept here for importers. */
export { APP_INDEX_TOKENS };

/** One notes index and the notes it was built from (the context panel counts them). */
export interface NotesIndexPart {
  index: string;
  notes: Note[];
}

/**
 * The notes indexes of a new session's first message (spec §3.3): the scope's own; in a scope, the app-wide one,
 * trimmed, after it (null otherwise). Notes in `excluded` are left out of both (context-panel spec §4.3); none
 * excluded: the options as before (D0).
 */
export async function notesIndexParts(
  notes: (scope?: string) => Promise<Note[]>,
  scoped: boolean,
  scope: string,
  excluded?: ReadonlySet<string>,
): Promise<{ own: NotesIndexPart; app: NotesIndexPart | null }> {
  const exclude = excluded && excluded.size > 0 ? { exclude: excluded } : {};
  const ownNotes = await notes(scoped ? scope : undefined).catch(() => [] as Note[]);
  const own = { index: buildNotesIndex(ownNotes, exclude), notes: ownNotes };
  if (!scoped || scope === APP_SCOPE) return { own, app: null };
  const appNotes = await notes(APP_SCOPE).catch(() => [] as Note[]);
  // The own index ends with the "open a note" line; the app-wide one says it only when it stands alone.
  const index = buildNotesIndex(appNotes, {
    budgetTokens: APP_INDEX_TOKENS,
    heading: "## App-wide notes",
    decisionsHeading: "## App-wide decisions",
    ...(own.index ? { footer: null } : {}),
    ...exclude,
  });
  return { own, app: { index, notes: appNotes } };
}

/**
 * The notes part of a new session's first message (spec §3.3): the scope's notes index; in a scope, the app-wide one,
 * trimmed, after it. Without scopes, the index of the flat notes folder (D2). Shared by a task's and a job run's first
 * message (its own module, so the jobs code never imports task-manager.ts).
 */
export async function notesIndexFor(notes: (scope?: string) => Promise<Note[]>, scoped: boolean, scope: string): Promise<string> {
  const { own, app } = await notesIndexParts(notes, scoped, scope);
  return [own.index, app?.index ?? ""].filter(Boolean).join("\n\n");
}
