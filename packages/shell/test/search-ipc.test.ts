import { describe, expect, it, vi } from "vitest";
import { searchHandlers } from "../src/main/search/ipc";
import type { SearchService } from "../src/main/search/service";

const svc = (o: Partial<SearchService> = {}) => ({ query: vi.fn(async () => ({ ok: true })), opened: vi.fn(async () => ({ ok: true })), ...o }) as unknown as SearchService;

describe("search handlers (§9)", () => {
  it("cleans the window's input before it reaches the service", async () => {
    const s = svc();
    const h = searchHandlers(s);
    await h["hh:search"](42, { kind: "bogus", allScopes: "yes", references: false, extra: 1 });
    expect(s.query).toHaveBeenCalledWith("", { references: false });
    await h["hh:search"]("x".repeat(500), { kind: "note", allScopes: true });
    expect(s.query).toHaveBeenLastCalledWith("x".repeat(200), { kind: "note", allScopes: true });
  });

  it("answers a failure as data", async () => {
    const h = searchHandlers(svc({ query: vi.fn(async () => Promise.reject(new Error("boom"))), opened: vi.fn(async () => Promise.reject(new Error("boom"))) } as never));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await h["hh:search"]("x", {})).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:searchOpen"]({ id: "a" })).toEqual({ ok: false });
    log.mockRestore();
  });
});
