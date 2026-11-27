import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { MOD_APP_CHANNELS, registerModAppChannels } from "../../src/main/mods/app-channels";
import { ModHost } from "../../src/main/mods/host";

async function host() {
  const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn() });
  await h.start([]);
  return h;
}

// The reader's five, reviews' nine and the file timeline's three are the documents mod's. The context panel's seven and search's two left the app
// channels for their mods' own ipc (context-cleanup, search-cleanup).
const READER = ["hh:readDocument", "hh:readImage", "hh:documentsExist", "hh:watchDocument", "hh:unwatchDocument"];
const WRITES = ["Answer", "Comment", "EditDraft", "Reopen", "Send", "Approve", "ApprovedText"].map((n) => `hh:review${n}`);
const FILES = ["hh:fileTimeline", "hh:fileDiff", "hh:fileRestore"];
const ALL = [...READER, "hh:reviewView", "hh:reviewSummaries", ...WRITES, ...FILES];

function wired(h: ModHost) {
  const ipc = new Map<string, (sender: { id: number }, ...args: unknown[]) => unknown>();
  registerModAppChannels((channel, fn) => void ipc.set(channel, fn), () => h);
  return (channel: string, ...args: unknown[]) => ipc.get(channel)!({ id: 1 }, ...args);
}

describe("app channels a core mod answers", () => {
  it("lists the reader's, reviews' and the file timeline's channels, and registers each", async () => {
    const h = await host();
    const handle = vi.fn();
    expect(MOD_APP_CHANNELS).toEqual(ALL);
    registerModAppChannels(handle, () => h);
    expect(handle.mock.calls.map(([channel]) => channel)).toEqual(ALL);
  });

  it("with the mod off, answers each in the shape its caller handles", async () => {
    const call = wired(await host());
    expect(await call("hh:readDocument", "a.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await call("hh:readImage", "a.png")).toBeNull();
    expect(await call("hh:documentsExist", ["a.md", "b.md"])).toEqual([false, false]);
    expect(await call("hh:documentsExist", "a.md")).toEqual([]);
    expect(await call("hh:watchDocument", "a.md")).toBeNull();
    expect(await call("hh:unwatchDocument", 1)).toBeUndefined();
    for (const channel of ["hh:reviewView", ...WRITES]) expect(await call(channel, "a.md"), channel).toEqual({ ok: false, reason: "not-ready" });
    expect(await call("hh:reviewSummaries", ["a.md", "b.md"])).toEqual([null, null]);
    expect(await call("hh:reviewSummaries", "a.md")).toEqual([]);
    for (const channel of FILES) expect(await call(channel, "a.md"), channel).toEqual({ ok: false, reason: "not-ready" });
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
