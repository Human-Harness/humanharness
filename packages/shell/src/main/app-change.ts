import { type CommitTrailer, MATERIAL_DIR, notesPrefix } from "@humanharness/workspace";

/** The history calls a change of the app's own files needs. */
export interface AppChangeHistory {
  save(message: string, trailer?: CommitTrailer): Promise<unknown>;
  commitPaths?(paths: readonly string[], message: string, trailer?: CommitTrailer): Promise<unknown>;
  changedSince?(start: null): Promise<string[]>;
}

/** The paths a change wrote, or a test for them among the folder's changed paths. */
export type OwnPaths = readonly string[] | ((file: string) => boolean);

/**
 * Records a change of the app's own files (a note, a data collection, the material's files) in the history. Plain mode
 * commits the whole folder, as always (D0). Board mode commits only `own`: another task's turn may be writing the
 * folder right now, and its work must never be filed under this trailer, or undoing this task would undo it too
 * (parallel spec §5.3).
 */
export async function saveAppChange(history: AppChangeHistory | null, board: boolean, own: OwnPaths, message: string, trailer?: CommitTrailer): Promise<void> {
  if (!history) return;
  if (!board) {
    await history.save(message, trailer);
    return;
  }
  if (!history.commitPaths || (typeof own === "function" && !history.changedSince)) throw new Error("This history can't commit single paths");
  const paths = typeof own === "function" ? (await history.changedSince!(null)).filter(own) : [...own];
  if (paths.length > 0) await history.commitPaths(paths, message, trailer);
}

/** A note's file, folder-relative, as `writeNote` writes it. */
export function notePath(scoped: boolean, scope: string | undefined, slug: string): string {
  return `${notesPrefix(scoped, scope)}${slug}.md`;
}

/** The material of `scope`: its originals and the records the history keeps of them. */
export function materialOwn(scope: string): (file: string) => boolean {
  const originals = `${MATERIAL_DIR}/${scope}/`;
  const records = `.harness/material/${scope}/`;
  return (file) => file.startsWith(originals) || file.startsWith(records);
}
