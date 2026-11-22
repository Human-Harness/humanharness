import { describe, expect, it } from "vitest";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import mod from "../src/main";

/** Sidekick's 26 app channels (protocol/channels), under their old names. */
const CHANNELS = [
  "hh:sidekickGet",
  "hh:sidekickSet",
  "hh:sidekickReview",
  "hh:sidekickCancel",
  "hh:sidekickResolve",
  "hh:sidekickMute",
  "hh:sidekickUnmute",
  "hh:sidekickSaveDecision",
  "hh:sidekickLearned",
  "hh:sidekickForget",
  "hh:sidekickForgetAll",
  "hh:sidekickEditLearned",
  "hh:sidekickBeforeApprove",
  "hh:sidekickApproveCancel",
  "hh:sidekickAsk",
  "hh:sidekickPresets",
  "hh:sidekickAdoptPreset",
  "hh:sidekickPickFiles",
  "hh:sidekickImportDraft",
  "hh:sidekickCheckOriginal",
  "hh:sidekickSave",
  "hh:sidekickList",
  "hh:sidekickRemove",
  "hh:sidekickReorder",
  "hh:sidekickScope",
  "hh:sidekickSetScope",
];

/** A core mod's ctx that records what the mod registers and pushes; the app is not set up. */
function fakeCtx(sidekick: unknown) {
  const channels = new Map<string, (payload: unknown) => unknown>();
  const hooks = new Map<string, (...a: unknown[]) => unknown>();
  const pushes: { channel: string; value: unknown }[] = [];
  const on = new Proxy({}, { get: (_t, name: string) => (fn: (...a: unknown[]) => unknown) => (hooks.set(name, fn), () => undefined) });
  const ctx = {
    id: "sidekick",
    config: undefined,
    on,
    ipc: (name: string, handler: (payload: unknown) => unknown) => (channels.set(name, handler), () => undefined),
    push: (channel: string, value: unknown) => void pushes.splice(pushes.length, 0, { channel, value }),
    stores: { open: (name: string) => ({ name, readAll: async () => [], write: async () => undefined }) },
    usage: { record: async () => undefined, summary: async () => ({ week: 0 }) },
    notes: { titles: async () => [] },
    log: () => undefined,
    onRefresh: (fn: (...a: unknown[]) => unknown) => (hooks.set("refresh", fn), () => undefined),
    app: {
      harness: { name: "Notes", ...(sidekick === undefined ? {} : { sidekick }), phases: () => [], phaseBrief: async () => null, dataTables: () => [] },
      setup: async () => null,
      task: async () => null,
      sessions: {},
      uiLanguage: async () => "English",
      person: {},
    },
  } as unknown as CoreMainCtx;
  return { ctx, channels, hooks, pushes };
}

describe("the Sidekick core mod", () => {
  it("registers nothing for a harness without a sidekick key", async () => {
    const f = fakeCtx(undefined);
    await mod.main!(f.ctx as never);
    expect(f.channels.size).toBe(0);
    expect(f.hooks.size).toBe(0);
  });

  it("registers the 26 app channels under their old names, and its hooks", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    expect([...f.channels.keys()].sort()).toEqual([...CHANNELS].sort());
    expect([...f.hooks.keys()].sort()).toEqual(["beforeSend", "betweenTasks", "close", "daily", "phaseMoved", "refresh", "taskClose", "taskOpen", "turnEnd", "turnStart"]);
  });

  it("answers a channel with the window's arguments, and pushes its state on hh:sidekick", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    expect(await f.channels.get("hh:sidekickSet")!(["not an object"])).toEqual({ ok: false, message: "A Sidekick change must be an object" });
    await f.hooks.get("taskOpen")!({ id: "t1", scope: "main" });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.pushes.map((p) => p.channel)).toContain("hh:sidekick");
    await f.hooks.get("close")!();
  });

  it("refreshes and pushes its state when the app says the base or its data changed (a profile switch, an undo)", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    await f.hooks.get("refresh")!();
    await new Promise((r) => setTimeout(r, 50));
    expect(f.pushes.map((p) => p.channel)).toContain("hh:sidekick");
    await f.hooks.get("close")!();
  });
});
