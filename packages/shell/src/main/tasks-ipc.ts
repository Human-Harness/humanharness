import type { TasksState, UndoRefusal } from "@humanharness/ui/client";
import type { PartialRestore } from "./linked-restore";
import type { RestoreByPaths } from "./restore-paths";

/** A task id from the window: a string of 1..200 characters (the board then looks it up among its lanes, P1). */
export function validTaskId(v: unknown): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) throw new Error("Invalid task");
  return v;
}

/** `hh:restoreTask`'s arguments in board mode: a task id, and whether its shared paths go too (default: no). */
export function restoreTaskArgs(taskId: unknown, includeShared: unknown): { id: string; includeShared: boolean } {
  const id = validTaskId(taskId);
  if (includeShared !== undefined && typeof includeShared !== "boolean") throw new Error("Invalid choice");
  return { id, includeShared: includeShared === true };
}

/** What the window is told of a refused undo by paths: the reason and the file, never the other tasks' ids. */
export function undoRefusalOf(r: Exclude<RestoreByPaths, { ok: true }> | PartialRestore): UndoRefusal {
  if (r.reason === "partial") return { reason: "partial", workFolder: r.workFolder, restored: r.restored, notRestored: r.notRestored, cause: refusalOf(r.refusal) };
  return refusalOf(r);
}

function refusalOf(r: Exclude<RestoreByPaths, { ok: true }>): Exclude<UndoRefusal, { reason: "partial" }> {
  switch (r.reason) {
    case "running":
    case "uncommitted":
      return { reason: r.reason, path: r.path };
    case "later":
      return { reason: "later", path: r.path, by: r.tasks.length > 0 ? "task" : "outside" };
    default:
      return { reason: r.reason };
  }
}

/** What the inbox channels need of the board host. */
export interface TasksIpcHost {
  tasksState(): Promise<TasksState>;
  board: { focus(id: string | null): Promise<void> };
  gate: { drop(id: string): string | null; paused(): { reason: string } | null; resume(): void };
}

/**
 * Board mode's task inbox channels (parallel spec §9.1). Every one refuses without the board (plain mode, D7); ids
 * are checked here and looked up in the board's lanes (P1).
 */
export function tasksIpc(host: () => TasksIpcHost | null) {
  const board = (): TasksIpcHost => {
    const h = host();
    if (!h) throw new Error("No parallel tasks");
    return h;
  };
  return {
    list: () => board().tasksState(),
    focus: (id: unknown) => board().board.focus(id === null ? null : validTaskId(id)),
    cancelQueued: (id: unknown) => board().gate.drop(validTaskId(id)),
    /** Lifts only an out-of-quota pause: a folder move's lasts until the move ends. */
    resume: () => {
      const gate = board().gate;
      if (gate.paused()?.reason === "out-of-quota") gate.resume();
    },
  };
}
