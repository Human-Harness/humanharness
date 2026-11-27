import { describe, expect, it, vi } from "vitest";
import { searchApi } from "../src/api";

describe("the search mod's ui calls (over its own ipc)", () => {
  it("passes filters (always an object) as an array and checks answers", async () => {
    const call = vi.fn(async (name: string) => (name === "query" ? { ok: true, groups: [] } : "junk"));
    const api = searchApi({ call, on: () => () => {} });
    expect(await api.query("x")).toMatchObject({ ok: true });
    expect(call).toHaveBeenCalledWith("query", ["x", {}]);
    expect(await api.opened({ id: "a" } as never)).toEqual({ ok: false });
  });

  it("a rejected call, or no call at all, answers failed as data", async () => {
    const api = searchApi({ call: vi.fn(async () => Promise.reject(new Error("x"))), on: () => () => {} });
    expect(await api.query("x")).toEqual({ ok: false, reason: "failed" });
    expect(await api.opened({ id: "a" } as never)).toEqual({ ok: false });
    expect(await searchApi({}).query("x")).toEqual({ ok: false, reason: "failed" });
  });

  it("status pushes are shape-checked", () => {
    let push: (v: unknown) => void = () => {};
    const api = searchApi({ on: (name, l) => (name === "status" ? ((push = l), () => {}) : () => {}) });
    const heard: unknown[] = [];
    api.onStatus((s) => heard.push(s));
    push({ state: "ready", done: 1, total: 1 });
    push("junk");
    expect(heard).toEqual([{ state: "ready", done: 1, total: 1 }]);
  });
});
