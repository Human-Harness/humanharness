import { describe, expect, it } from "vitest";
import { guarded } from "../../src/main/mods/guard";

describe("guarded", () => {
  it("returns the value", async () => {
    expect(await guarded(() => 2, 100)).toEqual({ ok: true, value: 2 });
  });
  it("turns a throw and a rejection into a failure, never a throw", async () => {
    expect(await guarded(() => { throw new Error("boom"); }, 100)).toEqual({ ok: false, reason: "boom" });
    expect(await guarded(() => Promise.reject(new Error("no")), 100)).toEqual({ ok: false, reason: "no" });
  });
  it("times out", async () => {
    expect(await guarded(() => new Promise(() => {}), 20)).toEqual({ ok: false, reason: "timed out after 20 ms" });
  });
});
