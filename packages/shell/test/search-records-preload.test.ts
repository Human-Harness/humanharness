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

  it("when the newest listener goes, the one still mounted under it answers again", () => {
    const c = searchClient(vi.fn(), () => () => {});
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = c.onOpenRecord("people", first);
    const offSecond = c.onOpenRecord("people", second);
    offSecond();
    offSecond();
    expect(c.handlesRecord("people")).toBe(true);
    expect(c.openRecord("people", "a", "_app")).toBe(true);
    expect(first).toHaveBeenCalledWith("a", "_app");
    expect(second).not.toHaveBeenCalled();
    offFirst();
    expect(c.handlesRecord("people")).toBe(false);
  });

  it("the same listener mounted twice stays until both go", () => {
    const c = searchClient(vi.fn(), () => () => {});
    const l = vi.fn();
    const offA = c.onOpenRecord("people", l);
    const offB = c.onOpenRecord("people", l);
    offA();
    expect(c.openRecord("people", 1, "_app")).toBe(true);
    offB();
    expect(c.openRecord("people", 1, "_app")).toBe(false);
  });
});
