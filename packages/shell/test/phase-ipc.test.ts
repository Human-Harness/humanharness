import { describe, expect, it } from "vitest";
import type { PhaseResult } from "@humanharness/ui/client";
import { setPhaseHandler } from "../src/main/phase-ipc";

function setup(opts: { quitting?: boolean; blocked?: string | null; result?: PhaseResult; doneError?: Error } = {}) {
  const calls: { to: string; task: string }[] = [];
  const handler = setPhaseHandler({
    quitting: () => opts.quitting ?? false,
    blocked: () => opts.blocked ?? null,
    setPhase: (to, task) => {
      calls.push({ to, task });
      return { accepted: Promise.resolve(opts.result ?? { ok: true, changed: "turn" }), done: opts.doneError ? Promise.reject(opts.doneError) : Promise.resolve() };
    },
  });
  return { handler, calls };
}

describe("hh:setPhase", () => {
  it("answers the acceptance as data, for the task the window saw", async () => {
    const t = setup({ result: { ok: false, reason: "unknown" } });
    expect(await t.handler("t1", "main")).toEqual({ ok: false, reason: "unknown" });
    expect(t.calls).toEqual([{ to: "main", task: "t1" }]);
  });

  it("only logs a failed change turn", async () => {
    const t = setup({ doneError: new Error("boom") });
    expect(await t.handler("t1", "main")).toEqual({ ok: true, changed: "turn" });
  });

  it("refuses while quitting or blocked, and anything malformed, before asking the task manager", async () => {
    await expect(setup({ quitting: true }).handler("t1", "main")).rejects.toThrow("The app is closing");
    await expect(setup({ blocked: "Finish setting up first" }).handler("t1", "main")).rejects.toThrow("Finish setting up first");
    const t = setup();
    for (const [task, phase] of [["", "main"], ["t1", "Main"], ["t1", 3], [{}, "main"], ["x".repeat(101), "main"]] as const) {
      await expect(t.handler(task, phase)).rejects.toThrow("Invalid phase");
    }
    expect(t.calls).toEqual([]);
  });
});
