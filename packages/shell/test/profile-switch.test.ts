import { describe, expect, it, vi } from "vitest";
import { ProfileSwitch, type ProfileSwitchDeps } from "../src/main/profile-switch";

function deps(over: Partial<ProfileSwitchDeps> = {}) {
  const calls: string[] = [];
  const d: ProfileSwitchDeps = {
    quitting: () => false,
    busy: () => false,
    turnBlocked: () => null,
    closeTask: async () => {
      calls.push("closeTask");
      return true;
    },
    closeRuntime: async () => void calls.push("closeRuntime"),
    saveActive: async (id) => void calls.push(`save:${id}`),
    arrived: async (id) => void calls.push(`arrived:${id}`),
    ...over,
  };
  return { d, calls };
}

describe("ProfileSwitch (profiles spec §5)", () => {
  it("closes the task, makes the target, closes the runtime, saves the profile, then arrives", async () => {
    const { d, calls } = deps();
    const s = new ProfileSwitch(d);
    const target = vi.fn(async () => {
      calls.push("target");
      return "tomas";
    });
    expect(await s.run(target)).toEqual({ ok: true, id: "tomas" });
    expect(calls).toEqual(["closeTask", "target", "closeRuntime", "save:tomas", "arrived:tomas"]);
  });

  it("is refused while quitting, busy, or turns are held, touching nothing", async () => {
    for (const over of [{ quitting: () => true }, { busy: () => true }, { turnBlocked: () => "Going back to an earlier point" }]) {
      const { d, calls } = deps(over);
      expect(await new ProfileSwitch(d).run(async () => "x")).toEqual({ ok: false, reason: "busy" });
      expect(calls).toEqual([]);
    }
  });

  it("a closing turn the person stopped keeps the task open and the profile as it was", async () => {
    const { d, calls } = deps({ closeTask: async () => false });
    expect(await new ProfileSwitch(d).run(async () => "x")).toEqual({ ok: false, reason: "open" });
    expect(calls).toEqual([]);
  });

  it("holds turns, restores and moves off while it runs, and refuses a second switch", async () => {
    let release!: () => void;
    const { d } = deps({ closeTask: () => new Promise<boolean>((r) => (release = () => r(true))) });
    const s = new ProfileSwitch(d);
    expect(s.turnBlocked()).toBeNull();
    const first = s.run(async () => "tomas");
    expect(s.turnBlocked()).toBe("Switching profiles");
    expect(await s.run(async () => "sofi")).toEqual({ ok: false, reason: "busy" });
    release();
    expect(await first).toEqual({ ok: true, id: "tomas" });
    expect(s.turnBlocked()).toBeNull();
  });

  it("a failure on the way is `failed`, and the hold ends", async () => {
    const { d, calls } = deps();
    const s = new ProfileSwitch(d);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.run(async () => Promise.reject(new Error("disk full")))).toEqual({ ok: false, reason: "failed" });
    expect(calls).toEqual(["closeTask"]);
    expect(s.turnBlocked()).toBeNull();
  });

  it("a failed arrival is logged; the switch went through", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d } = deps({ arrived: async () => Promise.reject(new Error("scopes")) });
    expect(await new ProfileSwitch(d).run(async () => "tomas")).toEqual({ ok: true, id: "tomas" });
    expect(error).toHaveBeenCalled();
  });
});
