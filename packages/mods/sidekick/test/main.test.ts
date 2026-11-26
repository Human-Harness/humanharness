import { describe, expect, it } from "vitest";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import mod from "../src/main";
import { SIDEKICK_CHANNELS } from "../src/ipc";
import { SIDEKICK_CALLS } from "../src/ui/api";

/** Sidekick's 26 own channels (`mods.sidekick.<name>`), the names its ui calls. */
const CHANNELS = [
  "get",
  "set",
  "review",
  "cancelReview",
  "resolve",
  "mute",
  "unmute",
  "saveDecision",
  "learned",
  "forget",
  "forgetAll",
  "editLearned",
  "beforeApprove",
  "cancelApprove",
  "ask",
  "presets",
  "adoptPreset",
  "pickFiles",
  "importDraft",
  "checkOriginal",
  "saveSidekick",
  "list",
  "remove",
  "reorder",
  "scope",
  "setScope",
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

  it("registers its 26 own channels (never an app channel), and its hooks", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    expect([...f.channels.keys()].sort()).toEqual([...CHANNELS].sort());
    expect([...f.channels.keys()].filter((n) => n.startsWith("hh:"))).toEqual([]);
    // Main's names and the ui's calls are the same 26.
    expect([...SIDEKICK_CHANNELS].sort()).toEqual([...CHANNELS].sort());
    expect([...SIDEKICK_CALLS].sort()).toEqual([...CHANNELS].sort());
    expect([...f.hooks.keys()].sort()).toEqual(["beforeSend", "betweenTasks", "close", "daily", "phaseMoved", "refresh", "taskClose", "taskOpen", "turnEnd", "turnStart"]);
  });

  it("answers mods.sidekick.<name> with the ui's arguments array, and sends its state on mods.sidekick.state", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    expect(await f.channels.get("set")!(["not an object"])).toEqual({ ok: false, message: "A Sidekick change must be an object" });
    // Anything but an array is a call with no arguments.
    expect(await f.channels.get("set")!("not an array")).toEqual({ ok: false, message: "A Sidekick change must be an object" });
    await f.hooks.get("taskOpen")!({ id: "t1", scope: "main" });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.pushes.map((p) => p.channel)).toContain("state");
    await f.hooks.get("close")!();
  });

  it("refreshes and pushes its state when the app says the base or its data changed (a profile switch, an undo)", async () => {
    const f = fakeCtx({});
    await mod.main!(f.ctx as never);
    await f.hooks.get("refresh")!();
    await new Promise((r) => setTimeout(r, 50));
    expect(f.pushes.map((p) => p.channel)).toContain("state");
    await f.hooks.get("close")!();
  });
});
