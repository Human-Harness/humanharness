import { describe, expect, it } from "vitest";
import { BROKER_LIMITS, Malformed, Slots, checkBudget, checkJson, dataKey, fetchRequest, query } from "../../src/main/broker/broker-checks";

describe("broker checks (tools spec §4.2: the core broker's argument rules)", () => {
  it("a call over the value budget is Malformed, counting a shared reference each time", () => {
    const shared = Array.from({ length: 1000 }, () => 0);
    const big = Array.from({ length: 300 }, () => shared);
    expect(() => checkBudget([big])).toThrow(Malformed);
    expect(() => checkBudget([{ a: 1 }])).not.toThrow();
  });
  it("plain JSON only: no __proto__ key, no non-finite number, bounded depth", () => {
    expect(() => checkJson(JSON.parse('{"__proto__":1}'), "A record")).toThrow("A record has a key that is not allowed");
    expect(() => checkJson({ n: Infinity }, "A record")).toThrow("A record holds a number that is not finite");
    let deep: unknown = 1;
    for (let i = 0; i < BROKER_LIMITS.depth + 1; i++) deep = [deep];
    expect(() => checkJson(deep, "A record")).toThrow("A record is nested too deep");
  });
  it("keys, queries and fetch options keep their shapes", () => {
    expect(dataKey(3)).toBe(3);
    expect(() => dataKey({})).toThrow("A key is text or a number");
    expect(query({ limit: 5000 })).toEqual({ limit: BROKER_LIMITS.queryLimit });
    expect(() => fetchRequest("https://x", { mode: "cors" })).toThrow("fetch's options has an unknown field");
  });
  it("Slots lets n holders in and the rest wait in order", async () => {
    const s = new Slots(1);
    const a = await s.acquire();
    let second = false;
    const b = s.acquire().then((r) => ((second = true), r));
    await Promise.resolve();
    expect(second).toBe(false);
    a();
    (await b)();
    expect(second).toBe(true);
  });
});
