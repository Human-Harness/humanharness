import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MainCtx, ModStore } from "@humanharness/mod-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type HostDeps, ModHost, localDay, msToNextDay } from "../../src/main/mods/host";
import { type ServiceDeps, buildServices, modUsageRecord, modUsageSummary } from "../../src/main/mods/services";
import { type TaskDepsDeps, createTaskDeps } from "../../src/main/task-deps";
import type { UsageRecord } from "../../src/main/usage-log";

const task = { id: "t1", scope: "main" };

async function host(over: Partial<HostDeps> = {}) {
  const h = new ModHost({
    config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    beforeSendMs: 5_000,
    hookMs: 5_000,
    ...over,
  });
  await h.start([]);
  return h;
}

function serviceDeps(o: { userData?: string; base?: string | null; data?: ServiceDeps["data"] } = {}): ServiceDeps {
  return {
    harnessId: "demo",
    userData: o.userData ?? os.tmpdir(),
    base: async () => (o.base === undefined ? os.tmpdir() : o.base),
    engineRun: vi.fn(async () => ({ ok: true, text: "" })),
    runningTask: async () => null,
    noteTitles: async () => [],
    notify: vi.fn(),
    ...(o.data ? { data: o.data } : {}),
  };
}

const COLLECTION = { scoped: false, key: "id", schema: z.object({ id: z.string(), text: z.string().optional() }), agent: "none" };

describe("the new hooks", () => {
  it("betweenTasks, phaseMoved, daily and close reach a mod that registered them", async () => {
    const h = await host();
    const seen: unknown[] = [];
    h.registerForTest("all", "All", (ctx) => {
      ctx.on.betweenTasks(() => void seen.push("between"));
      ctx.on.phaseMoved((e) => void seen.push(["moved", e.from, e.to]));
      ctx.on.daily((d) => void seen.push(["daily", d.day]));
      ctx.on.close(() => void seen.push("close"));
    });
    expect(["betweenTasks", "phaseMoved", "daily", "close"].every((n) => h.registered(n as "daily"))).toBe(true);
    await h.betweenTasks();
    await h.phaseMoved({ task, from: "a", to: "b" });
    await h.daily(new Date(2026, 10, 18, 9));
    await h.stop();
    expect(seen).toEqual(["between", ["moved", "a", "b"], ["daily", "2026-11-18"], "close"]);
    expect(h.view()[0]).toMatchObject({ on: false });
  });

  it("close runs before the disposers", async () => {
    const h = await host();
    const order: string[] = [];
    h.registerForTest("c", "C", (ctx) => {
      ctx.on.close(() => void order.push("close"));
      ctx.on.taskOpen(() => undefined);
    });
    // A disposer of its own, pushed after: runs on stop, after close.
    h.registerForTest("d", "D", (ctx) => {
      const off = ctx.on.close(() => void order.push("close d"));
      void off;
    });
    await h.stop();
    expect(order).toEqual(["close", "close d"]);
    expect(h.registered("close")).toBe(false);
  });

  it("a mod that is off, or none, registered nothing", async () => {
    const h = await host();
    expect(h.registered("betweenTasks")).toBe(false);
    h.registerForTest("x", "X", (ctx) => ctx.on.daily(() => undefined));
    await h.set("x", false);
    expect(h.registered("daily")).toBe(false);
  });

  it("daily runs at start and at each local midnight", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 18, 23, 0) });
    try {
      const h = await host();
      const days: string[] = [];
      h.registerForTest("d", "D", (ctx) => ctx.on.daily((d) => void days.push(d.day)));
      h.startDaily();
      await vi.advanceTimersByTimeAsync(0);
      expect(days).toEqual(["2026-11-18"]);
      await vi.advanceTimersByTimeAsync(msToNextDay(new Date()) + 2_000);
      expect(days).toEqual(["2026-11-18", "2026-11-19"]);
      await h.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("localDay is the local calendar day", () => {
    expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("ctx.focus", () => {
  it("a mod holds a task in focus until it lets go or goes off", async () => {
    const changed = vi.fn();
    const h = await host({ focusChanged: changed });
    let ctx!: MainCtx<unknown>;
    h.registerForTest("f", "F", (c) => void (ctx = c));
    ctx.focus.set("t1", true);
    ctx.focus.set("t1", true);
    expect(h.focused("t1")).toBe(true);
    expect(h.focused("t2")).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    ctx.focus.set("t1", false);
    expect(h.focused("t1")).toBe(false);
    ctx.focus.set("t2", true);
    await h.set("f", false);
    expect(h.focused("t2")).toBe(false);
    expect(changed).toHaveBeenLastCalledWith("t2");
  });
});

describe("ctx.stores", () => {
  it("a store of the mod's own: per base, written as the app, one history commit per write", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-store-"));
    const commit = vi.fn(async () => {});
    const s = buildServices(serviceDeps({ base, data: { blocked: () => null, commit } }))("notes");
    const store: ModStore = s.stores!.open("notes", COLLECTION);
    expect(await store.readAll()).toEqual([]);
    await store.write([
      { op: "put", collection: "notes", record: { id: "a", text: "one" } },
      { op: "put", collection: "notes", record: { id: "b", text: "two" } },
    ]);
    expect((await store.readAll()).map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(base, [".harness/data/_app/notes.json"], "Data: notes");
    expect(JSON.parse(await readFile(path.join(base, ".harness", "data", "_app", "notes.json"), "utf8"))).toBeTruthy();
  });

  it("refuses another mod's name, a request on another collection, and a write while turns are held", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-store-"));
    let blocked: string | null = null;
    const commit = vi.fn(async () => {});
    const s = buildServices(serviceDeps({ base, data: { blocked: () => blocked, commit } }))("notes");
    expect(() => s.stores!.open("settings", COLLECTION)).toThrow(/named "notes"/);
    const store = s.stores!.open("notes-extra", COLLECTION);
    await expect(store.write([{ op: "put", collection: "notes", record: { id: "a" } }])).rejects.toThrow(/Not a data request on notes-extra/);
    blocked = "A restore is under way";
    await expect(store.write([{ op: "put", collection: "notes-extra", record: { id: "a" } }])).rejects.toThrow("A restore is under way");
    expect(commit).not.toHaveBeenCalled();
  });

  it("reads nothing before setup and refuses a write", async () => {
    const s = buildServices(serviceDeps({ base: null, data: { blocked: () => null, commit: async () => {} } }))("notes");
    const store = s.stores!.open("notes", COLLECTION);
    expect(await store.readAll()).toEqual([]);
    await expect(store.write([])).rejects.toThrow(/not set up/);
  });
});

describe("ctx.usage", () => {
  const usage = (n: number) => ({ inputTokens: n, outputTokens: n, cacheReadTokens: n, cacheWriteTokens: n });

  it("records the mod's turn in the usage log and sums what it spent", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-usage-"));
    const s = buildServices(serviceDeps({ base }))("coach");
    await s.usage!.record("pre", { engine: "claude", ok: true, task: "t1", usage: usage(10) });
    await s.usage!.record("after", { engine: "claude", ok: true, task: "t2", usage: usage(1) });
    const lines = (await readFile(path.join(base, ".harness", "usage.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as UsageRecord);
    expect(lines[0]).toMatchObject({ engine: "claude", phase: "mod", process: "mod:coach", moment: "pre", task: "t1", ok: true });
    const sum = await s.usage!.summary({ task: "t1", day: localDay(new Date()) });
    expect(sum).toEqual({ week: 44, task: 30, day: { tasks: 0, mod: 33 } });
  });

  it("Sidekick's lines keep their phase and process, so every usage view counts them as before", () => {
    const r = modUsageRecord("sidekick", "daily", { engine: "claude", ok: true, by: "coach", usage: usage(1) }, "2026-11-18T10:00:00.000Z");
    expect(r).toMatchObject({ phase: "sidekick", process: "sidekick", moment: "daily", sidekick: "coach" });
    expect(modUsageSummary("sidekick", [r], {}, new Date("2026-11-19T10:00:00.000Z")).week).toBe(4);
  });

  it("keeps only known, checked fields", () => {
    const r = modUsageRecord("coach", "x", { engine: "claude", ok: true, usage: { inputTokens: "a" }, evil: 1 } as never);
    expect(r).not.toHaveProperty("usage");
    expect(r).not.toHaveProperty("evil");
  });
});

describe("task deps with mods", () => {
  const deps = (modHost: ModHost | null) =>
    createTaskDeps({
      modHost: () => modHost,
      hooks: {},
      settingsCtl: () => null,
      sidekickCtl: () => null,
      pluginsCtl: () => null,
      linked: () => null,
      jobsHost: () => null,
      tasks: () => ({ runningTask: async () => null }),
    } as unknown as TaskDepsDeps);

  it("with no mod, or a mod without these hooks, nothing is added (as before)", async () => {
    expect(deps(null).betweenTasks).toBeUndefined();
    expect(deps(null).phaseMoved).toBeUndefined();
    const h = await host();
    h.registerForTest("quiet", "Quiet", (ctx) => ctx.on.taskOpen(() => undefined));
    expect(deps(h).betweenTasks).toBeUndefined();
    expect(deps(h).phaseMoved).toBeUndefined();
  });

  it("calls the mods' betweenTasks and phaseMoved when one registered them", async () => {
    const h = await host();
    const seen: string[] = [];
    h.registerForTest("m", "M", (ctx) => {
      ctx.on.betweenTasks(() => void seen.push("between"));
      ctx.on.phaseMoved((e) => void seen.push(`moved ${e.to}`));
    });
    const d = deps(h);
    await d.betweenTasks!();
    d.phaseMoved!({ task, from: "a", to: "b" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["between", "moved b"]);
  });
});
