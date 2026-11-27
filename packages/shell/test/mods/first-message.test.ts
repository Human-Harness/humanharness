import type { TaskRef } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { type CoreAppParts, coreAppFor } from "../../src/main/mods/core-app";
import { type HostDeps, ModHost } from "../../src/main/mods/host";

async function host(over: Partial<HostDeps> = {}) {
  const h = new ModHost({
    config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    ...over,
  });
  await h.start([]);
  return h;
}

const task: TaskRef = { id: "t1", action: "quiz", scope: "main" };
const item = (id: string) => ({ id, kind: "pinned", label: id, tokens: 100 });

describe("on.firstMessage", () => {
  it("is only on a core mod's ctx", async () => {
    const h = await host();
    let core: unknown;
    let local: unknown;
    h.registerForTest(
      "a",
      "A",
      (c) => {
        core = (c as CoreMainCtx<unknown>).on;
        (c as CoreMainCtx<unknown>).on.firstMessage(() => null);
      },
      { core: true },
    );
    h.registerForTest("b", "B", (c) => void (local = c.on));
    expect(typeof (core as { firstMessage?: unknown }).firstMessage).toBe("function");
    expect((local as { firstMessage?: unknown }).firstMessage).toBeUndefined();
    expect(h.registered("firstMessage")).toBe(true);
  });

  it("joins the sections in order, cuts each to its budget and unions the exclusions", async () => {
    const h = await host();
    h.registerForTest("a", "A", (c) => (c as CoreMainCtx<unknown>).on.firstMessage(() => ({ text: "x".repeat(100), items: [item("one")], budgetTokens: 10, excludeNotes: ["n/a.md"] })), { core: true });
    h.registerForTest("b", "B", (c) => (c as CoreMainCtx<unknown>).on.firstMessage((t) => ({ text: `for ${t.id}`, items: [item("two")], budgetTokens: 50, excludeNotes: ["n/a.md", "n/b.md"] })), { core: true });
    const r = await h.firstMessage(task);
    expect(r?.text).toBe(`${"x".repeat(40)}\n\nfor t1`);
    expect(r?.items.map((i) => i.id)).toEqual(["one", "two"]);
    expect([...(r?.excluded ?? [])]).toEqual(["n/a.md", "n/b.md"]);
  });

  it("gives null for no mod, a null section, or a section without a usable budget", async () => {
    const h = await host();
    expect(await h.firstMessage(task)).toBeNull();
    h.registerForTest("a", "A", (c) => (c as CoreMainCtx<unknown>).on.firstMessage(() => null), { core: true });
    h.registerForTest("b", "B", (c) => (c as CoreMainCtx<unknown>).on.firstMessage(() => ({ text: "t", items: [], budgetTokens: 0 })), { core: true });
    expect(await h.firstMessage(task)).toBeNull();
  });

  it("a throwing hook counts a strike, adds nothing, and the others still add; three strikes turn it off", async () => {
    const notice = vi.fn();
    const h = await host({ notice });
    h.registerForTest("bad", "Bad", (c) => (c as CoreMainCtx<unknown>).on.firstMessage(() => Promise.reject(new Error("boom"))), { core: true });
    h.registerForTest("good", "Good", (c) => (c as CoreMainCtx<unknown>).on.firstMessage(() => ({ text: "ok", items: [], budgetTokens: 10 })), { core: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) expect((await h.firstMessage(task))?.text).toBe("ok");
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("Bad was turned off"));
  });
});

describe("ctx.app.tasks", () => {
  const parts = () => {
    const calls: unknown[][] = [];
    const p = {
      harness: { name: "Demo" },
      tasks: {
        contextRecord: async (id: string) => (calls.push(["record", id]), { id, scope: "main", start: [], reads: [] }),
        addContext: (id: string, file: string) => (calls.push(["add", id, file]), { accepted: Promise.resolve({ ok: true }), done: Promise.resolve() }),
      },
    } as unknown as CoreAppParts;
    return { p, calls };
  };

  it("gives the record and the Add now turn, and a push when the record changes", async () => {
    const { p, calls } = parts();
    const h = await host({ coreApp: (id) => coreAppFor(p, id) });
    const heard: string[] = [];
    let ctx!: CoreMainCtx<unknown>;
    h.registerForTest("ctx", "Ctx", (c) => {
      ctx = c as CoreMainCtx<unknown>;
      ctx.app.tasks.onContextChanged((id) => void heard.push(id));
    }, { core: true });
    expect(await ctx.app.tasks.contextRecord("t1")).toEqual({ id: "t1", scope: "main", start: [], reads: [] });
    await ctx.app.tasks.addContext("t1", "a.md").accepted;
    expect(calls).toEqual([["record", "t1"], ["add", "t1", "a.md"]]);
    await h.contextChanged("t1");
    expect(heard).toEqual(["t1"]);
  });

  it("stops hearing when the listener is disposed", async () => {
    const { p } = parts();
    const h = await host({ coreApp: (id) => coreAppFor(p, id) });
    const heard: string[] = [];
    h.registerForTest("ctx", "Ctx", (c) => {
      const off = (c as CoreMainCtx<unknown>).app.tasks.onContextChanged((id) => void heard.push(id));
      off();
    }, { core: true });
    await h.contextChanged("t1");
    expect(heard).toEqual([]);
  });
});
