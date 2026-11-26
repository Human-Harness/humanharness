// The History page's go-backs as the mod's main part (minimal-core step 2): "Go back here" and "Undo this task" reach the
// core's restore service through `ctx.app.history`, which asks with main's native dialog first. Core mods only.
import { defineMod } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";

/** A commit id, as the history is asked for one. */
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** `restoreTask`'s payload: the task's id, and whether its shared paths go too (default: no). */
function taskArgs(payload: unknown): { id: string; includeShared: boolean | undefined } {
  const { id, includeShared } = (typeof payload === "object" && payload !== null ? payload : {}) as { id?: unknown; includeShared?: unknown };
  if (typeof id !== "string" || id.length === 0 || id.length > 200) throw new Error("Invalid task");
  if (includeShared !== undefined && typeof includeShared !== "boolean") throw new Error("Invalid choice");
  return { id, includeShared };
}

export default defineMod({
  id: "history-view",
  main(base) {
    const { history } = (base as unknown as CoreMainCtx).app;
    base.ipc("restore", (sha) => {
      if (!isSha(sha)) throw new Error("Invalid commit");
      return history.restorePoint(sha);
    });
    base.ipc("restoreTask", (payload) => {
      const { id, includeShared } = taskArgs(payload);
      return history.restoreTask(id, includeShared);
    });
  },
});
