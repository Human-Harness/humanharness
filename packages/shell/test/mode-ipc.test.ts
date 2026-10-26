import { describe, expect, it, vi } from "vitest";
import type { ModeChoice, ModeResult } from "@humanharness/ui/client";
import { chooseModeHandler } from "../src/main/mode-ipc";

function setup(opts: { quitting?: boolean; blocked?: string | null; result?: ModeResult; doneError?: Error } = {}) {
  const calls: { mode: string; choice: ModeChoice }[] = [];
  const handler = chooseModeHandler({
    quitting: () => opts.quitting ?? false,
    blocked: () => opts.blocked ?? null,
    choose: (mode, choice) => {
      calls.push({ mode, choice });
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
      { mode: "worked", choice: {} },
      { mode: "worked", choice: { belowTier: "new-task" } },
    ]);
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
