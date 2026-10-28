import { describe, expect, it, vi } from "vitest";
import { PluginChannel } from "../src/main/plugin-channel";

const ready = (ch: PluginChannel) => ch.handle("ready", { sources: [] });

describe("PluginChannel (Decision 10)", () => {
  it("hands queued runs to `next` and resolves the run on `done`", async () => {
    const ctx = vi.fn(async () => ({ ok: true as const, value: 1 }));
    const ch = new PluginChannel({ ctx, idleMs: 25_000 });
    await ready(ch);
    const run = ch.run("r1", "queues");
    expect(await ch.handle("next", undefined)).toEqual({ kind: "run", runId: "r1", source: "queues" });
    await ch.handle("done", { runId: "r1", ok: false, error: "HTTP 500" });
    await expect(run).rejects.toThrow("HTTP 500");
    const ok = ch.run("r2", "queues");
    await ch.handle("next", undefined);
    await ch.handle("done", { runId: "r2", ok: true });
    await expect(ok).resolves.toBeUndefined();
  });

  it("a waiting `next` gets a run queued after it", async () => {
    const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    await ready(ch);
    const next = ch.handle("next", null);
    void ch.run("r1", "s").catch(() => {});
    expect(await next).toEqual({ kind: "run", runId: "r1", source: "s" });
  });

  it("`next` with nothing queued answers idle after idleMs", async () => {
    vi.useFakeTimers();
    try {
      const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
      await ready(ch);
      const next = ch.handle("next", undefined);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(await next).toEqual({ kind: "idle" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards ctx calls with their run id; refuses unknown methods and malformed args", async () => {
    const ctx = vi.fn(async () => ({ ok: true as const, value: "v" }));
    const ch = new PluginChannel({ ctx, idleMs: 25_000 });
    expect(await ch.handle("ctx", { runId: "r1", name: "settings.get", args: [] })).toEqual({ ok: true, value: "v" });
    expect(ctx).toHaveBeenCalledWith("r1", "settings.get", []);
    await expect(ch.handle("tasks", {})).rejects.toThrow(/unknown/i);
    await expect(ch.handle("done", { runId: 5 })).rejects.toThrow();
    await expect(ch.handle("ctx", { runId: "r1", name: "x", args: [], extra: 1 })).rejects.toThrow();
  });

  it("`ready` with an error rejects the start; close() rejects pending runs", async () => {
    const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    const ready = ch.ready();
    await ch.handle("ready", { error: "SyntaxError: x" });
    await expect(ready).rejects.toThrow("SyntaxError: x");
    const run = ch.run("r2", "queues");
    ch.close();
    await expect(run).rejects.toThrow(/stopped/);
    await expect(ch.run("r3", "queues")).rejects.toThrow(/stopped/);
    await expect(ch.handle("next", null)).rejects.toThrow(/stopped/);
  });

  it("`ready` with sources resolves; close() answers a waiting next with idle", async () => {
    const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    await ch.handle("ready", { sources: ["a", "b"] });
    expect(await ch.ready()).toEqual({ sources: ["a", "b"] });
    const next = ch.handle("next", null);
    ch.close();
    expect(await next).toEqual({ kind: "idle" });
  });

  it("fail() rejects one run and drops it from the queue; a late done is ignored", async () => {
    const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    await ready(ch);
    const run = ch.run("r1", "s");
    ch.fail("r1", "The sync took too long");
    await expect(run).rejects.toThrow("too long");
    expect(await ch.handle("done", { runId: "r1", ok: true })).toBeNull();
    const next = ch.handle("next", null);
    void ch.run("r2", "s").catch(() => {});
    expect(await next).toMatchObject({ runId: "r2" });
  });

  it("hands runs only to a page that sent `ready`: a `next` before it, or after a failed load, is refused", async () => {
    const ch = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    const run = ch.run("r1", "s");
    await expect(ch.handle("next", null)).rejects.toThrow(/not ready/);
    await ready(ch);
    expect(await ch.handle("next", null)).toMatchObject({ kind: "run", runId: "r1" });
    void run.catch(() => {});
    const bad = new PluginChannel({ ctx: async () => ({ ok: true, value: null }), idleMs: 25_000 });
    await bad.handle("ready", { error: "SyntaxError: x" });
    await expect(bad.handle("next", null)).rejects.toThrow(/not ready/);
  });
});
