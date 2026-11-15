import { RESTORE_POINT, RESTORE_TASK } from "@humanharness/protocol";
import type { History } from "@humanharness/workspace";
import type { WebContents } from "electron";
import type { FileTimelineService } from "./file-timeline";
import { CANCELLED, type GoBackAsk, goBackHandlers } from "./go-back";
import { historyView } from "./history-view";
import type { HomeHistory } from "./mods/home-history";
import { type LinkedHistoryRef, linkedOnlyRows, mergeTaskGroups, restoreLinkedTask, restoreTaskWithLinked } from "./linked-restore";
import type { RestoreGuard } from "./restore-guard";
import { restoreTaskByPaths } from "./restore-paths";
import { restoreTaskArgs, undoRefusalOf } from "./tasks-ipc";

export interface HistoryIpcDeps {
  quitting(): boolean;
  /** A task operation or a turn is under way. */
  tasksBusy(): boolean;
  /** Why a restore can't run now, or null. */
  restoreHeld(): string | null;
  /** The home folder's history, or null. */
  homeHistory(): HomeHistory | null;
  /** The linked folders' parts (only checked for being set), or null without them. */
  linked_(): unknown;
  currentHistory(): Promise<History | null>;
  linkedHistoriesOf(scopeId: string | undefined): Promise<LinkedHistoryRef[]>;
  confirmGoBack(sender: WebContents, ask: GoBackAsk): Promise<boolean>;
  restoreWith(run: (history: History) => Promise<unknown>): Promise<void>;
  afterRestore(): void;
  restores: Pick<RestoreGuard, "run">;
  /** How "Undo this task" undoes by paths (board and `single` mode), or null: the whole folder (plain mode). */
  undoByPaths(): {
    running: () => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
    linkedRunning: (realPath: string) => Promise<{ task: string; paths: ReadonlySet<string> }[]>;
    busy: (id: string) => boolean;
  } | null;
  fileTimelines: FileTimelineService;
}

/** The History panel's go-backs and rows, and the home folder's history (0b2). */
export function historyIpc(d: HistoryIpcDeps) {
  const { linked_, currentHistory, linkedHistoriesOf, confirmGoBack, restoreWith, afterRestore, restores, undoByPaths, fileTimelines } = d;
  const historyGroups = async () => {
    const history = await currentHistory();
    return history ? historyView(await history.tasks()) : [];
  };
  /**
   * The groups "Undo this task" acts on: the panel's, and with tracked linked folders theirs too (a task or a later
   * task that changed only a linked folder, hatches spec §3.4). Without linked folders, exactly the panel's (D0).
   */
  const undoGroups = async (taskId: string) => {
    const main = await historyGroups();
    if (!linked_()) return main;
    const refs = await linkedHistoriesOf(main.find((g) => g.taskId === taskId)?.scopeId);
    if (refs.length === 0) return main;
    return mergeTaskGroups(main, await Promise.all(refs.map(async (r) => ({ key: r.key, groups: historyView(await r.history.tasks()) }))));
  };
  // Every go-back (one file, the whole folder, one task) asks first with main's native dialog (go-back.ts).
  // Restore commits carry no task: going back may undo several tasks, so it belongs to none of them.
  // A restore changes tracked files with no data event: the settings may have changed.
  const goBacks = goBackHandlers<WebContents>({
    confirm: confirmGoBack,
    blocked: () => d.quitting() || d.tasksBusy() || d.restoreHeld() !== null,
    groups: historyGroups,
    restorePoint: (sha) => restoreWith((history) => history.restore(sha, RESTORE_POINT)).then(afterRestore),
    taskGroups: undoGroups,
    restoreTask: (taskId) => {
      // Something was restored: the settings may have changed, even when a linked folder then failed.
      let touched = false;
      return restoreWith(async (history) => {
        const group = (await history.tasks()).find((g) => g.taskId === taskId);
        // Its tracked linked folders too (hatches spec §3.4); none without linked folders (D0).
        const linkedRefs = await linkedHistoriesOf(group?.scopeId);
        if (!group?.start && linkedRefs.length === 0) throw new Error("Nothing to go back to");
        if (group?.start) {
          await history.restore(group.start, RESTORE_TASK);
          touched = true;
        }
        if (linkedRefs.length === 0) return;
        touched = true;
        let restored: number;
        try {
          restored = await restoreLinkedTask(linkedRefs, taskId, RESTORE_TASK);
        } catch (err) {
          // A failure there is logged and fails the undo (the window's generic failure).
          console.error("Undo covered the work folder but not its linked folders", err);
          throw err;
        }
        if (!group?.start && restored === 0) throw new Error("Nothing to go back to");
      }).then(afterRestore, (err: unknown) => {
        if (touched) afterRestore();
        throw err;
      });
    },
    file: fileTimelines,
  });
  return {
    // Every go-back but "Undo this task" as master registers it; that one also undoes by paths below.
    "hh:restore": goBacks["hh:restore"],
    "hh:fileRestore": goBacks["hh:fileRestore"],
    // The panel's rows; with tracked linked folders, a task that changed only one of them too (hatches spec §3.4), so it
    // can be undone. Without linked folders, exactly the work folder's (D0); a linked folder that can't be read adds none.
    "hh:historyTasks": async () => {
      const main = await historyGroups();
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
    "hh:restoreTask": async (sender: WebContents, taskId: unknown, includeShared?: unknown) => {
      // Board mode (Decision 12): only the task's own paths (its shared ones after the person's confirm), refused while
      // its own lane runs, or a running turn touched one of them (P2). Other lanes go on meanwhile.
      // `single` mode the same (part 3 Decision 12): a job's commits sit between the task's, and a job run is undone alone.
      const byPaths = undoByPaths();
      // Plain mode: the whole folder back to the task's start, after main's native confirmation (go-back.ts).
      if (!byPaths) return goBacks["hh:restoreTask"](sender, taskId);
      const { id, includeShared: withShared } = restoreTaskArgs(taskId, includeShared);
      const task = (await undoGroups(id)).find((g) => g.taskId === id);
      if (!task) return { refused: { reason: "nothing" as const } };
      if (d.quitting() || d.restoreHeld() !== null) throw new Error("Going back can't run now");
      // Main's native dialog too; by paths no later task is undone, so none is listed.
      if (!(await confirmGoBack(sender, { kind: "task", task, later: [] }))) return CANCELLED;
      let result: Awaited<ReturnType<typeof restoreTaskWithLinked>> | null = null;
      await restores.run(
        currentHistory,
        async (history: History) => {
          // With tracked linked folders, each of them by paths too (hatches spec §3.4); without, today's (D0).
          const linkedRefs = await linkedHistoriesOf(task.scopeId);
          result =
            linkedRefs.length > 0
              ? await restoreTaskWithLinked(history, linkedRefs, id, { running: byPaths.running, linkedRunning: byPaths.linkedRunning, includeShared: withShared })
              : await restoreTaskByPaths(history, id, { running: byPaths.running, includeShared: withShared });
        },
        { busy: () => byPaths.busy(id) },
      );
      const r = result!;
      // A refusal is an answer, not an error: the window says why, naming the file (spec §5.3). A partial undo (linked
      // folders) restored some folders: the settings may have changed.
      if (!r.ok) {
        if (r.reason === "partial") afterRestore();
        return { refused: undoRefusalOf(r) };
      }
      afterRestore();
      return { ok: true };
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
