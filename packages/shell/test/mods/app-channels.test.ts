import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { MOD_APP_CHANNELS, registerModAppChannels } from "../../src/main/mods/app-channels";
import { ModHost } from "../../src/main/mods/host";

async function host() {
  const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn() });
  await h.start([]);
  return h;
}

// The context panel's seven and search's two left the app channels for their mods' own ipc (context-cleanup, search-cleanup).
describe("app channels a core mod answers", () => {
  it("lists no channel: nothing registers", async () => {
    const h = await host();
    const handle = vi.fn();
    expect(MOD_APP_CHANNELS).toEqual([]);
    registerModAppChannels(handle, () => h);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a channel that is not listed, so the former search channels are not reachable through `handle`", async () => {
    const h = await host();
    let thrown: unknown;
    h.registerForTest("a", "A", (c) => {
      try {
        (c as CoreMainCtx<unknown>).handle("hh:search", () => 1);
      } catch (err) {
        thrown = err;
      }
    }, { core: true });
    expect(String(thrown)).toMatch(/Not an app channel a core mod answers/);
    expect(h.handles("hh:search")).toBe(false);
  });
});
