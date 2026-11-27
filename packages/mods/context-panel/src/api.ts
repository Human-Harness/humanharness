import type { UiCtx } from "@humanharness/mod-sdk";
import type { ContextApi, TaskContext } from "@humanharness/protocol";

/** The mod's own ipc names: the panel's seven calls (context-panel spec §5.2). */
export const CONTEXT_CALLS = ["get", "add", "pick", "pin", "unpin", "exclude", "include"] as const;
export type ContextCall = (typeof CONTEXT_CALLS)[number];

/** The push the panel hears: `{ task, context }` for a task whose record changed. */
export const CONTEXT_CHANGED = "changed";

/** The ui part's way to its own main (`UiCtx.call`), as the helpers their tests drive with a fake take it. */
export type Call = (name: string, payload?: unknown) => Promise<unknown>;

type Failed = { ok: false; reason: "failed" };

/** A context call: main's answer, or "failed" when the call rejects or answers no data (never a throw). */
export function askContext<R>(call: Call | undefined, name: ContextCall, ...args: unknown[]): Promise<R | Failed> {
  const failed: Failed = { ok: false, reason: "failed" };
  if (!call) return Promise.resolve(failed);
  return Promise.resolve()
    .then(() => call(name, args))
    .then(
      (v) => (typeof v === "object" && v !== null && "ok" in v ? (v as R) : failed),
      () => failed,
    );
}

/** A `changed` push's listener for one task: only that task's well-formed updates reach `listener`. */
export function contextListener(taskId: string, listener: (c: TaskContext) => void): (m: unknown) => void {
  return (m) => {
    if (typeof m !== "object" || m === null) return;
    const { task, context } = m as { task?: unknown; context?: unknown };
    if (task === taskId && typeof context === "object" && context !== null) listener(context as TaskContext);
  };
}

/** The panel's calls over the mod's own ipc: every answer is data, a rejected call included. */
export function contextApi(ui: Pick<UiCtx, "call" | "on">): ContextApi {
  const call = ui.call?.bind(ui);
  const ask = (name: ContextCall, ...args: unknown[]) => askContext(call, name, ...args) as never;
  return {
    get: (taskId) => ask("get", taskId),
    onChange: (taskId, listener) => ui.on?.(CONTEXT_CHANGED, contextListener(taskId, listener)) ?? (() => {}),
    add: (taskId, file) => ask("add", taskId, file),
    pick: () => ask("pick"),
    pin: (scope, file) => ask("pin", scope, file),
    unpin: (scope, file) => ask("unpin", scope, file),
    exclude: (scope, note) => ask("exclude", scope, note),
    include: (scope, note) => ask("include", scope, note),
  };
}
