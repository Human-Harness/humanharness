import type { ContextCall } from "./api";
import type { ContextService } from "./service";

const failed = { ok: false as const, reason: "failed" as const };

/** The seven ipc handlers, by call name (context-panel spec §5.2). Every answer is data; a throw is a bug, logged, answered `failed`. */
export function contextHandlers(svc: ContextService): Record<ContextCall, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A context panel call failed", err);
        return failed;
      });
  return {
    "get": (task) => call(() => svc.get(task)),
    "add": (task, file) => call(() => svc.add(task, file)),
    "pick": () => call(() => svc.pick()),
    "pin": (scope, file) => call(() => svc.pin(scope, file)),
    "unpin": (scope, file) => call(() => svc.unpin(scope, file)),
    "exclude": (scope, note) => call(() => svc.exclude(scope, note)),
    "include": (scope, note) => call(() => svc.include(scope, note)),
  };
}
