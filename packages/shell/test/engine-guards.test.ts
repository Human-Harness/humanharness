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
      guards.beginSetup({ engineId: "claude", step, current: true }, () => false);
      expect(guards.turnBlocked()).toBeNull();
      expect(() => guards.beginSetup({ engineId: "claude", step: "login", current: true }, () => false)).toThrow(/already running/);
      guards.endSetup();
    }
    for (const step of ["logout", "update"] as const) {
      expect(() => guards.beginSetup({ engineId: "claude", step, current: true }, () => true)).toThrow(/turn is running/);
      guards.beginSetup({ engineId: "claude", step, current: true }, () => false);
      expect(guards.setup).toEqual({ engineId: "claude", step });
      expect(guards.turnBlocked()).not.toBeNull();
      guards.endSetup();
      expect(guards.turnBlocked()).toBeNull();
      expect(guards.setup).toBeNull();
    }
  });

  it("lets turns run while another engine (not the one in use) updates or signs out", () => {
    const guards = new EngineGuards();
    guards.beginSetup({ engineId: "codex", step: "logout", current: false }, () => true);
    expect(guards.turnBlocked()).toBeNull();
    guards.endSetup();
  });

  it("refuses to change engine while an engine updates or signs out", async () => {
    const guards = new EngineGuards();
    guards.beginSetup({ engineId: "codex", step: "update", current: false }, () => false);
    await expect(guards.switchEngine(switchDeps(guards).deps)).rejects.toThrow(/updated or signed out/);
    guards.endSetup();
    guards.beginSetup({ engineId: "codex", step: "login", current: false }, () => false);
    const { deps, release } = switchDeps(guards);
    const switching = guards.switchEngine(deps);
    release();
    await switching;
  });

  it("refuses an engine change, and an update or sign-out of the engine in use, while the folder changes", async () => {
    const guards = new EngineGuards();
    guards.beginFolderChange(() => false);
    const { deps, calls } = switchDeps(guards);
    await expect(guards.switchEngine(deps)).rejects.toThrow(/folder is being changed/);
    expect(calls).toEqual([]);
    for (const step of ["logout", "update"] as const) {
      expect(() => guards.beginSetup({ engineId: "claude", step, current: true }, () => false)).toThrow(/folder is being changed/);
      expect(guards.setup).toBeNull();
    }
    // Steps that leave the runtime alone still run.
    guards.beginSetup({ engineId: "claude", step: "login", current: true }, () => false);
    guards.endSetup();
    guards.beginSetup({ engineId: "codex", step: "update", current: false }, () => false);
    guards.endSetup();
    guards.endFolderChange();
    const after = switchDeps(guards);
    after.release();
    await guards.switchEngine(after.deps);
  });

  it("shares a running test prompt with a second request for the same engine", async () => {
    const guards = new EngineGuards();
    let finish!: (v: string) => void;
    let runs = 0;
    const run = () => {
      runs++;
      return new Promise<string>((r) => (finish = r));
    };
    const first = guards.runTest("claude", run);
    const second = guards.runTest("claude", run);
    await Promise.resolve();
    expect(runs).toBe(1);
    finish("ok");
    expect(await first).toBe("ok");
    expect(await second).toBe("ok");
  });

  it("runs another engine's test prompt after the running one ends", async () => {
    const guards = new EngineGuards();
    const order: string[] = [];
    let finish!: () => void;
    const first = guards.runTest("claude", async () => {
      order.push("claude start");
      await new Promise<void>((r) => (finish = r));
      order.push("claude end");
    });
    const second = guards.runTest("codex", async () => void order.push("codex"));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["claude start"]);
    finish();
    await Promise.all([first, second]);
    expect(order).toEqual(["claude start", "claude end", "codex"]);
  });

  it("aborting the test prompt resolves once it has cleaned up, and a failed one frees the slot", async () => {
    const guards = new EngineGuards();
    let signal!: AbortSignal;
    let finish!: () => void;
    const running = guards.runTest("claude", (s) => {
      signal = s;
      return new Promise<void>((r) => (finish = r));
    });
    await Promise.resolve();
    let stopped = false;
    const stopping = guards.abortTest().then(() => (stopped = true));
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await running;
    await stopping;
    await expect(guards.runTest("claude", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await guards.runTest("claude", async () => "again")).toBe("again");
    await guards.abortTest();
  });

  it("on quit, stops the running test and never starts one that was waiting", async () => {
    const guards = new EngineGuards();
    let finish!: () => void;
    const running = guards.runTest("claude", (signal) => {
      signal.addEventListener("abort", () => finish());
      return new Promise<void>((r) => (finish = r));
    });
    let waiterRan = false;
    const waiting = guards.runTest("codex", async () => {
      waiterRan = true;
    });
    await Promise.resolve();
    await guards.close();
    await running;
    await expect(waiting).rejects.toThrow(/closing/);
    expect(waiterRan).toBe(false);
    await expect(guards.runTest("claude", async () => "late")).rejects.toThrow(/closing/);
  });

  it("keeps the new engine when closing the old runtime or archiving the chat fails after the save", async () => {
    const guards = new EngineGuards();
    const { deps, calls, release } = switchDeps(guards);
    release();
    const errors: unknown[] = [];
    const from = await guards.switchEngine(
      {
        ...deps,
        dropRuntime: async () => Promise.reject(new Error("close failed")),
        archiveChat: async () => Promise.reject(new Error("archive failed")),
      },
      (err) => errors.push(err),
    );
    expect(from).toBeNull();
    expect(calls).toEqual(["save (blocked: true)"]);
    expect(errors.map((e) => (e as Error).message)).toEqual(["close failed", "archive failed"]);
    expect(guards.turnBlocked()).toBeNull();
  });

  it("remembers a cancel asked for before the step's process starts", () => {
    const guards = new EngineGuards();
    expect(guards.cancelSetup()).toBe(false);
    guards.beginSetup({ engineId: "claude", step: "install", current: false }, () => false);
    expect(guards.setupCancelled()).toBe(false);
    expect(guards.cancelSetup()).toBe(true);
    expect(guards.setupCancelled()).toBe(true);
    guards.endSetup();
    guards.beginSetup({ engineId: "claude", step: "install", current: false }, () => false);
    expect(guards.setupCancelled()).toBe(false);
    guards.endSetup();
  });
});
