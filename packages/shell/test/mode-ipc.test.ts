import { describe, expect, it, vi } from "vitest";
import type { ModeChoice, ModeResult } from "@humanharness/protocol";
import { chooseModeHandler } from "../src/main/mode-ipc";

function setup(opts: { quitting?: boolean; blocked?: string | null; result?: ModeResult; doneError?: Error; task?: string | null } = {}) {
  const calls: { mode: string; choice: ModeChoice; task: string }[] = [];
  const handler = chooseModeHandler({
    quitting: () => opts.quitting ?? false,
    blocked: () => opts.blocked ?? null,
    openTask: async () => (opts.task === undefined ? "t1" : opts.task),
    choose: (mode, choice, task) => {
      calls.push({ mode, choice, task });
      return { accepted: Promise.resolve(opts.result ?? { ok: true, switched: "turn" }), done: opts.doneError ? Promise.reject(opts.doneError) : Promise.resolve() };
    },
  });
  return { handler, calls };
}

describe("hh:chooseMode", () => {
  it("answers the acceptance as data and passes the person's tier answer", async () => {
    const t = setup({ result: { ok: false, reason: "tier", required: "deep", current: "standard" } });
    expect(await t.handler("worked", {})).toEqual({ ok: false, reason: "tier", required: "deep", current: "standard" });
    await t.handler("worked", { belowTier: "new-task" });
    expect(t.calls).toEqual([
      { mode: "worked", choice: {}, task: "t1" },
      { mode: "worked", choice: { belowTier: "new-task" }, task: "t1" },
    ]);
  });

  it("passes the task open when the pick arrives; with none open it refuses with no-task", async () => {
    const t = setup({ task: "t7" });
    await t.handler("feynman", {});
    expect(t.calls).toEqual([{ mode: "feynman", choice: {}, task: "t7" }]);
    const none = setup({ task: null });
    expect(await none.handler("feynman", {})).toEqual({ ok: false, reason: "no-task" });
    expect(none.calls).toHaveLength(0);
  });

  it("refuses while quitting or blocked, and anything malformed, before asking the task manager", async () => {
    await expect(setup({ quitting: true }).handler("worked", {})).rejects.toThrow("The app is closing");
    await expect(setup({ blocked: "A restore is running" }).handler("worked", {})).rejects.toThrow("A restore is running");
    const t = setup();
    for (const [mode, choice] of [[3, {}], ["Bad Mode", {}], ["../x", {}], ["worked", { belowTier: "later" }]] as const) {
      await expect(t.handler(mode, choice)).rejects.toThrow("Invalid mode");
    }
    expect(t.calls).toHaveLength(0);
  });

  it("logs a failed turn instead of leaving an unhandled rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup({ doneError: new Error("boom") });
    expect(await t.handler("feynman", undefined)).toEqual({ ok: true, switched: "turn" });
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith("The mode switch's turn failed", expect.any(Error));
    error.mockRestore();
  });
});
