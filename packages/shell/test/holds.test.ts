import { describe, expect, it } from "vitest";
import { EngineGuards } from "../src/main/engine-guards";
import { type HoldSources, holds } from "../src/main/holds";
import { ProfileSwitch } from "../src/main/profile-switch";
import { RestoreGuard } from "../src/main/restore-guard";

const idle: HoldSources = {
  quitting: () => false,
  tasksBusy: () => false,
  moving: () => false,
  engine: () => null,
  restore: () => null,
  profileSwitch: () => null,
  profileChange: () => false,
};

/** Every source on its own, as an override. */
const each: Record<string, Partial<HoldSources>> = {
  quitting: { quitting: () => true },
  tasksBusy: { tasksBusy: () => true },
  moving: { moving: () => true },
  engine: { engine: () => "The engine is being changed" },
  restore: { restore: () => "Going back to an earlier point" },
  profileSwitch: { profileSwitch: () => "Switching profiles" },
  profileChange: { profileChange: () => true },
};

/** Which sources hold each operation off. */
function heldBy(pick: (h: ReturnType<typeof holds>) => unknown): string[] {
  return Object.entries(each)
    .filter(([, over]) => {
      const v = pick(holds({ ...idle, ...over }));
      return v !== null && v !== false;
    })
    .map(([name]) => name);
}

describe("holds (profiles spec §5)", () => {
  it("nothing is held while nothing runs", () => {
    const h = holds(idle);
    expect([h.turnBlocked(), h.restoreHeld(), h.switchHeld()]).toEqual([null, null, null]);
    expect([h.switchBusy(), h.engineBusy(), h.folderBusy(), h.profileChangeBlocked()]).toEqual([false, false, false, false]);
  });

  it("new turns wait for an engine change, a restore and a profile switch", () => {
    expect(heldBy((h) => h.turnBlocked())).toEqual(["engine", "restore", "profileSwitch"]);
  });

  it("restores wait for an engine change and a profile switch (their own hold is the guard's)", () => {
    expect(heldBy((h) => h.restoreHeld())).toEqual(["engine", "profileSwitch"]);
  });

  it("a switch waits for turns, a move, an archive or a delete, an engine change and a restore (never itself)", () => {
    expect(heldBy((h) => h.switchBusy())).toEqual(["tasksBusy", "moving", "profileChange"]);
    expect(heldBy((h) => h.switchHeld())).toEqual(["engine", "restore"]);
  });

  it("an engine change, update or sign-out waits for turns, a profile switch, an archive or a delete", () => {
    expect(heldBy((h) => h.engineBusy())).toEqual(["tasksBusy", "profileSwitch", "profileChange"]);
  });

  it("a folder change or move waits for turns, a restore, a profile switch, an archive or a delete", () => {
    expect(heldBy((h) => h.folderBusy())).toEqual(["tasksBusy", "restore", "profileSwitch", "profileChange"]);
  });

  it("archiving and deleting wait for everything else", () => {
    expect(heldBy((h) => h.profileChangeBlocked())).toEqual(["quitting", "tasksBusy", "moving", "engine", "restore", "profileSwitch"]);
  });

  it("an engine change can't start between a switch's closing turn and its save", async () => {
    const guards = new EngineGuards();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let switches!: ProfileSwitch;
    let restores!: RestoreGuard;
    const h = holds({
      ...idle,
      engine: () => guards.turnBlocked(),
      restore: () => restores.turnBlocked(),
      profileSwitch: () => switches.turnBlocked(),
    });
    restores = new RestoreGuard({ quitting: () => false, busy: () => false, turnBlocked: h.restoreHeld });
    switches = new ProfileSwitch({
      quitting: () => false,
      busy: h.switchBusy,
      turnBlocked: h.switchHeld,
      closeTask: async () => true,
      closeRuntime: async () => {},
      saveActive: async () => {},
      arrived: async () => {},
    });
    // The task closed (nothing busy any more); the switch waits in target, before the runtime closes.
    const run = switches.run(async () => {
      await gate;
      return "tomas";
    });
    const change = guards.switchEngine({
      isBusy: h.engineBusy,
      idle: async () => {},
      save: async () => {},
      dropRuntime: async () => {},
      archiveChat: async () => null,
    });
    await expect(change).rejects.toThrow("A turn is running");
    expect(() => guards.beginSetup({ engineId: "claude", step: "logout", current: true }, h.engineBusy)).toThrow("A turn is running");
    await expect(restores.run(async () => ({}), async () => {})).rejects.toThrow("A turn is running");
    expect(h.turnBlocked()).toBe("Switching profiles");
    release();
    expect(await run).toEqual({ ok: true, id: "tomas" });
    expect(h.turnBlocked()).toBeNull();
    expect(h.engineBusy()).toBe(false);
  });
});
