import type { ConnectionResult } from "@humanharness/ui/client";
import type { ConnectionsController } from "./connections";

/** Settings › Connections (tools spec §9). The push, hh:connectionsChange, goes out from index.ts. */
export const CONNECTIONS_IPC_CHANNELS = ["hh:connectionsGet", "hh:connectionsSet", "hh:connectionsDelete"] as const;

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;

/** A declared key's id (the manifest's pattern); the controller checks it is declared. */
const ID = /^[a-z][a-z0-9_-]{0,39}$/;
/** Generous: the store trims and caps at SECRET_MAX; this only keeps a huge string out of main's work. */
const VALUE_MAX = 8192 * 4;
const INVALID: ConnectionResult = { ok: false, message: "Invalid request" };
const WRONG: ConnectionResult = { ok: false, message: "Something went wrong" };

/**
 * Registered only when the harness declares secrets (D0), through index.ts's handle(), which answers only the app's
 * page. Malformed requests are refused before the controller; a failure answers a fixed refusal, never its error.
 */
export function registerConnectionsIpc(handle: Handle, ctl: Pick<ConnectionsController, "view" | "set" | "delete">): void {
  handle("hh:connectionsGet", () => ctl.view().catch(() => null));
  handle("hh:connectionsSet", (id: unknown, value: unknown) =>
    typeof id !== "string" || !ID.test(id) || typeof value !== "string" || value.length > VALUE_MAX ? INVALID : ctl.set(id, value).catch(() => WRONG),
  );
  handle("hh:connectionsDelete", (id: unknown) => (typeof id !== "string" || !ID.test(id) ? INVALID : ctl.delete(id).catch(() => WRONG)));
}
