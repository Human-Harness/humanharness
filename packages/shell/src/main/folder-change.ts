export interface FolderChangeDeps {
  /** A task operation or a turn is under way. */
  isBusy(): boolean;
  /** Ends the open task of the configured (old) folder. */
  interrupt(): Promise<void>;
  /** Closes the runtime, which works on the old folder; the next turn starts one on the new folder. */
  dropRuntime(): Promise<void>;
}

/**
 * Saves a config patch that may change the working folder. Everything else reads the folder from the
 * saved config on each call, so a change while a turn runs would split one task across two folders:
 * it is refused. Otherwise the old folder's task ends first, then the save, then the runtime goes.
 */
export async function saveWithFolderChange(
  next: string | undefined,
  before: string | undefined,
  d: FolderChangeDeps,
  save: () => Promise<void>,
): Promise<void> {
  if (next === undefined || next === before) return save();
  if (d.isBusy()) throw new Error("A turn is running");
  await d.interrupt();
  await save();
  await d.dropRuntime();
}
