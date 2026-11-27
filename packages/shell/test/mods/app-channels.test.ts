import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { MOD_APP_CHANNELS, registerModAppChannels } from "../../src/main/mods/app-channels";
import { ModHost } from "../../src/main/mods/host";

async function host() {
  const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn() });
  await h.start([]);
  return h;
}

describe("app channels a core mod answers", () => {
  it("reaches the mod's handler with the call's arguments", async () => {
    const h = await host();
    h.registerForTest("a", "A", (c) => (c as CoreMainCtx<unknown>).handle("hh:contextGet", (...args) => ({ got: args })), { core: true });
    expect(h.handles("hh:contextGet")).toBe(true);
    expect(await h.channel("hh:contextGet", ["t1"])).toEqual({ got: ["t1"] });
  });

  it("answers a refusal as data while no mod is on, and a mod's own ipc never reaches an app channel", async () => {
    const h = await host();
    const handle = vi.fn();
    registerModAppChannels(handle, () => h);
    expect(handle).toHaveBeenCalledTimes(MOD_APP_CHANNELS.length);
    const fn = handle.mock.calls[0]![1] as (...a: unknown[]) => unknown;
    expect(fn("t1")).toEqual({ ok: false, reason: "not-ready" });
    h.registerForTest("a", "A", (c) => (c as CoreMainCtx<unknown>).handle("hh:contextGet", () => 1), { core: true });
    expect(await h.ipc("a", "hh:contextGet", null)).toEqual({ ok: false, reason: "no such channel" });
  });
});
