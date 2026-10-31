import { describe, expect, it, vi } from "vitest";
import { searchClient } from "../src/preload/search";

describe("client.search (preload)", () => {
  it("passes filters (always an object) and checks answers", async () => {
    const invoke = vi.fn(async (channel: string) => (channel === "hh:search" ? { ok: true, groups: [] } : "junk"));
    const c = searchClient(invoke, () => () => {});
    expect(await c.query("x")).toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledWith("hh:search", "x", {});
    expect(await c.opened({ id: "a" } as never)).toEqual({ ok: false });
  });

  it("a rejected or shapeless answer is failed", async () => {
    const c = searchClient(vi.fn(async () => Promise.reject(new Error("x"))), () => () => {});
    expect(await c.query("x")).toEqual({ ok: false, reason: "failed" });
  });

  it("status pushes are shape-checked; open reaches every listener", () => {
    let push: (v: unknown) => void = () => {};
    const c = searchClient(vi.fn(), (_channel, l) => ((push = l), () => {}));
    const heard: unknown[] = [];
    c.onStatus((s) => heard.push(s));
    push({ state: "ready", done: 1, total: 1 });
    push("junk");
    expect(heard).toEqual([{ state: "ready", done: 1, total: 1 }]);
    const opened: (string | undefined)[] = [];
    const off = c.onOpen((q) => opened.push(q));
    c.open("guide");
    c.open();
    off();
    c.open("later");
    expect(opened).toEqual(["guide", undefined]);
  });
});
