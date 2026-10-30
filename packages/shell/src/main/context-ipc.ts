import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { ContextService } from "./context";

export const CONTEXT_CHANNELS = ["hh:contextGet", "hh:contextAdd", "hh:contextPick", "hh:contextPin", "hh:contextUnpin", "hh:contextExclude", "hh:contextInclude"] as const satisfies readonly InvokeChannel[];
export type ContextChannel = (typeof CONTEXT_CHANNELS)[number];

const failed = { ok: false as const, reason: "failed" as const };

/** The `hh:context*` handlers (context-panel spec §5.2). Every answer is data; a throw is a bug, logged, answered `failed`. */
export function contextHandlers(svc: ContextService): Record<ContextChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A context panel call failed", err);
        return failed;
      });
  return {
    "hh:contextGet": (task) => call(() => svc.get(task)),
    "hh:contextAdd": (task, file) => call(() => svc.add(task, file)),
    "hh:contextPick": () => call(() => svc.pick()),
    "hh:contextPin": (scope, file) => call(() => svc.pin(scope, file)),
    "hh:contextUnpin": (scope, file) => call(() => svc.unpin(scope, file)),
    "hh:contextExclude": (scope, note) => call(() => svc.exclude(scope, note)),
    "hh:contextInclude": (scope, note) => call(() => svc.include(scope, note)),
  };
}
