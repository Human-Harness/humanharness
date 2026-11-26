import type { WebContents } from "electron";
import { historyView } from "./history-view";
import type { HistoryRestores } from "./history-restore";
import { type LinkedHistoryRef, linkedOnlyRows } from "./linked-restore";
import type { HomeHistory } from "./mods/home-history";

export interface HistoryIpcDeps {
  /** The go-backs (history-restore.ts): the wrappers below call them. */
  restores: HistoryRestores;
  /** The home folder's history, or null. */
  homeHistory(): HomeHistory | null;
  /** The linked folders' parts (only checked for being set), or null without them. */
  linked_(): unknown;
  linkedHistoriesOf(scopeId: string | undefined): Promise<LinkedHistoryRef[]>;
}

/** The History panel's rows, its go-back channels as one-line wrappers of the restore service, and the home folder's history (0b2). */
export function historyIpc(d: HistoryIpcDeps) {
  const { linked_, linkedHistoriesOf, restores } = d;
  return {
    // The whole-folder and task go-backs are the History mod's main (`ctx.app.history`); the file's asks on the window that asked.
    "hh:fileRestore": (sender: WebContents, file: unknown, commit: unknown) => restores.fileRestore(sender, file, commit),
    // The panel's rows; with tracked linked folders, a task that changed only one of them too (hatches spec §3.4), so it
    // can be undone. Without linked folders, exactly the work folder's (D0); a linked folder that can't be read adds none.
    "hh:historyTasks": async () => {
      const main = await restores.historyGroups();
      if (!linked_()) return main;
      try {
        const refs = await linkedHistoriesOf(undefined);
        if (refs.length === 0) return main;
        return linkedOnlyRows(main, await Promise.all(refs.map(async (r) => ({ key: r.key, groups: historyView(await r.history.tasks()) }))));
      } catch (err) {
        console.error("Could not read the linked folders' history", err);
        return main;
      }
    },
    // The home folder's history (0b2): its last change, and undo (the watchers reload what the undo changed).
    "hh:homeHistory": async () => (await d.homeHistory()?.last()) ?? null,
    "hh:homeUndo": async () => {
      const homeHistory = d.homeHistory();
      if (!homeHistory) return null;
      await homeHistory.undo();
      return homeHistory.last();
    },
  };
}
