import { describe, expect, it, vi } from "vitest";
import { SIDEKICK_CALLS, sidekickApi } from "../src/ui/api";

/** A window's `mods` part that records the calls and keeps the listeners. */
function mods() {
  const listeners: { id: string; name: string; fn: (v: unknown) => void }[] = [];
  const call = vi.fn(async (id: string, name: string, args?: unknown) => ({ id, name, args }));
  const on = vi.fn((id: string, name: string, fn: (v: unknown) => void) => {
    const l = { id, name, fn };
    listeners.push(l);
    return () => void listeners.splice(listeners.indexOf(l), 1);
  });
  return { client: { mods: { call, on } } as never, call, listeners };
}

describe("Sidekick's ui talks to its main on the mod's own channels", () => {
  it("calls mods.sidekick.<name> with its arguments as an array, for each of the 26", async () => {
    const m = mods();
    const api = sidekickApi(m.client);
    expect(await api.resolve("c-1", "used")).toEqual({ id: "sidekick", name: "resolve", args: ["c-1", "used"] });
    // An array argument stays one argument.
    await api.reorder(["a", "b"]);
    expect(m.call).toHaveBeenLastCalledWith("sidekick", "reorder", [["a", "b"]]);
    await api.get();
    expect(m.call).toHaveBeenLastCalledWith("sidekick", "get", []);
    for (const name of SIDEKICK_CALLS) expect(typeof api[name]).toBe("function");
    expect(SIDEKICK_CALLS).toHaveLength(26);
  });

  it("hears its state on mods.sidekick.state, and stops", () => {
    const m = mods();
    const seen: unknown[] = [];
    const off = sidekickApi(m.client).onChange((s) => seen.push(s));
    expect(m.listeners.map(({ id, name }) => `${id}.${name}`)).toEqual(["sidekick.state"]);
    m.listeners[0].fn({ status: "watching" });
    expect(seen).toEqual([{ status: "watching" }]);
    off();
    expect(m.listeners).toEqual([]);
  });
});
