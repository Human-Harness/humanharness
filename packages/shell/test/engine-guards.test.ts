import { describe, expect, it } from "vitest";
import { EngineGuards } from "../src/main/engine-guards";

/** Switch deps that record the order of calls; `busy` says whether a turn is running. */
function switchDeps(guards: EngineGuards, busy = { now: false }) {
  const calls: string[] = [];
  let release!: () => void;
  const saved = new Promise<void>((r) => (release = r));
  return {
    calls,
    release,
    deps: {
      isBusy: () => busy.now,
      idle: async () => {
        calls.push("idle");
        busy.now = false;
      },
      save: async () => {
        calls.push(`save (blocked: ${guards.turnBlocked() !== null})`);
        await saved;
      },
      dropRuntime: async () => void calls.push("drop"),
      archiveChat: async () => {
        calls.push("archive");
        return "claude";
      },
    },
  };
}

describe("EngineGuards", () => {
  it("blocks turns from the start of an engine change until the chat is archived", async () => {
    const guards = new EngineGuards();
    const { deps, calls, release } = switchDeps(guards);
    const switching = guards.switchEngine(deps);
    // Set synchronously: a send arriving while the config is being saved is refused.
    expect(guards.turnBlocked()).not.toBeNull();
    release();
    expect(await switching).toBe("claude");
    expect(calls).toEqual(["save (blocked: true)", "drop", "archive"]);
    expect(guards.turnBlocked()).toBeNull();
    expect(guards.takeSwitchedFrom()).toBe("claude");
    expect(guards.takeSwitchedFrom()).toBeNull();
  });

  it("refuses to change engine during a turn or during another change", async () => {
    const guards = new EngineGuards();
    await expect(guards.switchEngine(switchDeps(guards, { now: true }).deps)).rejects.toThrow(/turn is running/);
    const slow = switchDeps(guards);
    const first = guards.switchEngine(slow.deps);
    await expect(guards.switchEngine(switchDeps(guards).deps)).rejects.toThrow(/already/);
    slow.release();
    await first;
  });

  it("lifts the block when saving fails, and drops nothing", async () => {
    const guards = new EngineGuards();
    const { deps, calls } = switchDeps(guards);
    await expect(guards.switchEngine({ ...deps, save: async () => Promise.reject(new Error("disk")) })).rejects.toThrow("disk");
    expect(calls).toEqual([]);
    expect(guards.turnBlocked()).toBeNull();
  });

  it("waits for a turn found running after the save before dropping the runtime", async () => {
    const guards = new EngineGuards();
    const busy = { now: false };
    const { deps, calls } = switchDeps(guards, busy);
    await guards.switchEngine({
      ...deps,
      save: async () => {
        busy.now = true;
      },
    });
    expect(calls).toEqual(["idle", "drop", "archive"]);
  });

  it("runs one setup step at a time and blocks turns during logout and update only", () => {
    const guards = new EngineGuards();
    for (const step of ["install", "login"] as const) {
      guards.beginSetup(step, () => false);
      expect(guards.turnBlocked()).toBeNull();
      expect(() => guards.beginSetup("login", () => false)).toThrow(/already running/);
      guards.endSetup();
    }
    for (const step of ["logout", "update"] as const) {
      expect(() => guards.beginSetup(step, () => true)).toThrow(/turn is running/);
      guards.beginSetup(step, () => false);
      expect(guards.setupStep).toBe(step);
      expect(guards.turnBlocked()).not.toBeNull();
      guards.endSetup();
      expect(guards.turnBlocked()).toBeNull();
    }
  });

  it("runs one test prompt at a time and can abort it", () => {
    const guards = new EngineGuards();
    const signal = guards.beginTest();
    expect(() => guards.beginTest()).toThrow(/already running/);
    guards.abortTest();
    expect(signal.aborted).toBe(true);
    guards.endTest();
    expect(guards.beginTest().aborted).toBe(false);
  });
});
