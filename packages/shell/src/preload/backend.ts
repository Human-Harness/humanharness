import type { BackendClient, BackendState } from "@humanharness/ui/client";
import type { Invoke } from "./context";

type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

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
export function backendClient(invoke: Invoke, subscribe: Subscribe): BackendClient {
  const ask = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args).then(
      (v) => v as T,
      (err: unknown) => {
        throw plainError(err);
      },
    );
  return {
    call: (method, params) => ask<unknown>("hh:backendCall", method, params),
    // One hh:backendEvent subscription per listener, filtered by its event name.
    on: (event, listener) =>
      subscribe("hh:backendEvent", (m) => {
        if (typeof m === "object" && m !== null && (m as { event?: unknown }).event === event) listener((m as { data?: unknown }).data);
      }),
    state: () => ask<BackendState>("hh:backendState"),
    onState: (listener) =>
      subscribe("hh:backendStateChange", (s) => {
        if (STATES.includes(s)) listener(s as BackendState);
      }),
    restart: () => ask<void>("hh:backendRestart").then(() => undefined),
  };
}
