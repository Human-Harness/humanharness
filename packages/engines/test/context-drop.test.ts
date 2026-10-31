import { describe, expect, it } from "vitest";
import { COMPACTED_DROP, ContextDrop } from "../src/context-drop";

describe("ContextDrop (replaceable parts §7.2)", () => {
  it("fires when a reading falls below half of the previous one", () => {
    expect(COMPACTED_DROP).toBe(0.5);
    const d = new ContextDrop();
    expect(d.next(100_000)).toBe(false);
    expect(d.next(60_000)).toBe(false);
    expect(d.next(29_000)).toBe(true);
    expect(d.next(40_000)).toBe(false);
    expect(d.next(20_000)).toBe(false);
  });

  it("compares the first reading with the seed", () => {
    expect(new ContextDrop(100_000).next(40_000)).toBe(true);
    expect(new ContextDrop(100_000).next(60_000)).toBe(false);
  });

  it("reset forgets the last reading, the seed included", () => {
    const d = new ContextDrop(100_000);
    d.reset();
    expect(d.next(40_000)).toBe(false);
    d.reset();
    expect(d.next(10)).toBe(false);
  });
});
