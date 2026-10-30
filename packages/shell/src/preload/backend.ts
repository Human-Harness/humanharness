import type { BackendClient, BackendState } from "@humanharness/protocol";
import type { InvokeArgs, InvokeChannel, InvokeResult } from "@humanharness/protocol/channels";
import type { invoke as ipcInvoke, subscribe as ipcSubscribe } from "./ipc";

const STATES: readonly unknown[] = ["stopped", "starting", "running", "failed"] satisfies BackendState[];

/**
 * A rejected invoke as the harness should see it (Decision 8): main's own message, without Electron's "Error invoking
 * remote method" wrapper; a channel main never registered (a harness without `backend`, D0) says so plainly.
 */
function plainError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/No handler registered for 'hh:backend/.test(message)) return new Error("This harness has no backend");
  return new Error(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""));
}

/** `client.backend` (hatches spec §4.2): main's channels, registered only for a harness with `backend`. */
export function backendClient(invoke: typeof ipcInvoke, subscribe: typeof ipcSubscribe): BackendClient {
  const ask = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> =>
    invoke(channel, ...args).catch((err: unknown) => {
      throw plainError(err);
    });
  return {
    call: (method, params) => ask("hh:backendCall", method, params),
    // One hh:backendEvent subscription per listener, filtered by its event name.
    on: (event, listener) =>
      subscribe("hh:backendEvent", (m) => {
        if (typeof m === "object" && m !== null && (m as { event?: unknown }).event === event) listener((m as { data?: unknown }).data);
      }),
    state: () => ask("hh:backendState"),
    onState: (listener) =>
      subscribe("hh:backendStateChange", (s) => {
        if (STATES.includes(s)) listener(s as BackendState);
      }),
    restart: () => ask("hh:backendRestart").then(() => undefined),
  };
}
