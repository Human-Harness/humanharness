import type { TaskContext } from "@humanharness/ui/client";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** A `client.context` call: main's answer, or "failed" when the invoke rejects or answers no data (never a throw). */
export function askContext<T>(invoke: Invoke, channel: string, ...args: unknown[]): Promise<T | { ok: false; reason: "failed" }> {
  const failed = { ok: false as const, reason: "failed" as const };
  return invoke(channel, ...args).then(
    (v) => (typeof v === "object" && v !== null && "ok" in v ? (v as T) : failed),
    () => failed,
  );
}

/** An `hh:context` message's listener for one task: only that task's well-formed updates reach `listener`. */
export function contextListener(taskId: string, listener: (c: TaskContext) => void): (m: unknown) => void {
  return (m) => {
    if (typeof m !== "object" || m === null) return;
    const { task, context } = m as { task?: unknown; context?: unknown };
    if (task === taskId && typeof context === "object" && context !== null) listener(context as TaskContext);
  };
}
