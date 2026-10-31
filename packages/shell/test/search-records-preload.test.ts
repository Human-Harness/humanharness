import { describe, expect, it, vi } from "vitest";
import { searchClient } from "../src/preload/search";

describe("client.search records (search spec §9, plan deviation 9)", () => {
  it("one listener per collection; the last one wins; unsubscribing only drops its own", () => {
    const c = searchClient(vi.fn(), () => () => {});
    expect(c.handlesRecord("people")).toBe(false);
    expect(c.openRecord("people", "a", "_app")).toBe(false);
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = c.onOpenRecord("people", first);
    const offSecond = c.onOpenRecord("people", second);
    offFirst();
    expect(c.handlesRecord("people")).toBe(true);
    expect(c.openRecord("people", "a", "_app")).toBe(true);
    expect(second).toHaveBeenCalledWith("a", "_app");
    expect(first).not.toHaveBeenCalled();
    offSecond();
    expect(c.openRecord("people", null, "_app")).toBe(false);
  });
});
