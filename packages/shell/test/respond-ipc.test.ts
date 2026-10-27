import { describe, expect, it, vi } from "vitest";
import type { RespondResult } from "@humanharness/harness-sdk";
import { type RespondDeps, respondHandler } from "../src/main/respond-ipc";

function deps(over: Partial<RespondDeps> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const d: RespondDeps = {
    quitting: () => false,
    blocked: () => null,
    respond: (blockId, value) => {
      calls.push([blockId, value]);
      const r: RespondResult = { ok: true, display: "d", value, answeredAt: "a" };
      return { accepted: Promise.resolve(r), done: Promise.resolve() };
    },
    ...over,
  };
  return { d, calls };
}

describe("hh:respond", () => {
  it("passes a well-formed answer on and returns its acceptance", async () => {
    const { d, calls } = deps();
    expect(await respondHandler(d)("t1:0:0", { why: "x" })).toEqual({ ok: true, display: "d", value: { why: "x" }, answeredAt: "a" });
    expect(calls).toEqual([["t1:0:0", { why: "x" }]]);
  });

  it("refuses while quitting or while turns are blocked, and a bad id or value, before the task manager", async () => {
    const quitting = deps({ quitting: () => true });
    await expect(respondHandler(quitting.d)("t1:0:0", {})).rejects.toThrow("The app is closing");
    const blocked = deps({ blocked: () => "The folder is moving" });
    await expect(respondHandler(blocked.d)("t1:0:0", {})).rejects.toThrow("The folder is moving");
    const { d, calls } = deps();
    for (const [id, value] of [["../x", {}], [42, {}], ["t1:0:0", null], ["t1:0:0", ["a"]], ["t1:0:0", "x"]] as [unknown, unknown][]) {
      await expect(respondHandler(d)(id, value)).rejects.toThrow("Invalid answer");
    }
    expect(calls).toEqual([]);
  });

  it("a failed turn after the answer is only logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r: RespondResult = { ok: true, display: "d", value: {}, answeredAt: "a" };
    const { d } = deps({ respond: () => ({ accepted: Promise.resolve(r), done: Promise.reject(new Error("boom")) }) });
    expect(await respondHandler(d)("t1:0:0", {})).toEqual(r);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("The answer's turn failed", expect.any(Error)));
    log.mockRestore();
  });
});
