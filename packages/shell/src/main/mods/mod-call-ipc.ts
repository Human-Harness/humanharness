import { MOD_ID } from "@humanharness/mod-sdk";
import type { InvokeChannel } from "@humanharness/protocol/channels";

type Handle = (channel: InvokeChannel, fn: (...args: never[]) => unknown) => void;

/** A mod's own channel name: never an app channel (`hh:…`), which has its own handler. */
const validName = (name: unknown): name is string => typeof name === "string" && name.length > 0 && name.length <= 128 && !name.startsWith("hh:");

/**
 * A mod's ui calling its own main by name (`mods.call`, mods-1b): not a Settings › Mods channel, so it lives apart from
 * them. `call` is `ModHost.call`; absent (no host runs), every mod is off.
 */
export function registerModCall(handle: Handle, call: ((id: string, name: string, payload: unknown) => Promise<unknown>) | undefined): void {
  handle("hh:modCall", async (id: unknown, name: unknown, payload: unknown) => {
    if (typeof id !== "string" || !MOD_ID.test(id) || !validName(name)) throw new Error("Invalid mod call");
    if (!call) throw new Error(`Mod "${id}" is off`);
    return call(id, name, payload);
  });
}
