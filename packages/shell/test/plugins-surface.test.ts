import { describe, expect, it, vi } from "vitest";
import type { PluginSurfaceView } from "@humanharness/protocol";
import { type Ctx, QUEUES, bundled, setup, until } from "./plugins-fixtures";

const TRIAGE = {
  id: "triage",
  label: "Triage",
  tier: "light",
  scope: "none",
  vars: { type: "object", properties: { issue: { type: "string" } }, required: ["issue"], additionalProperties: false },
  prompt: "Triage {{issue}} now.",
};
const ONCALL = {
  name: "On-call",
  permissions: { tasks: true, secrets: [{ id: "tok", label: "Token" }] },
  data: { queues: QUEUES, other: QUEUES },
  panels: [
    { id: "queue", title: "Queue" },
    { id: "side", slot: "bottom", title: "Side" },
  ],
  chips: [{ id: "who" }],
  settings: { fields: { team: { schema: { type: "string" }, default: "docs", control: "text", label: "Team" } } },
  actions: [TRIAGE],
};
const SLOTS = [{ id: "bottom", label: "Bottom", kind: "panel" as const }];

/** On-call running, its source parked on `ctx` (a run never ends unless `finish` is set). */
async function oncall(over: Record<string, unknown> = {}, opts: { finish?: (ctx: Ctx) => Promise<void>; noWait?: boolean } = {}) {
  let ctx: Ctx | undefined;
  let now = 100_000;
  const surfaceChanged = vi.fn();
  const dataChanged = vi.fn();
  const t = await setup({
    plugins: { bundled: ["oncall", "other"], on: ["oncall"], local: false },
    slots: SLOTS,
    backends: { oncall: { s: (c) => ((ctx = c), opts.finish ? opts.finish(c) : new Promise(() => {})) } },
    over: { clock: () => now, surfaceChanged, dataChanged },
  });
  await bundled(t.root, "oncall", { ...ONCALL, ...over });
  await bundled(t.root, "other", { data: { results: QUEUES } });
  await t.ctl.start();
  if (!opts.noWait) await until(() => ctx !== undefined);
  return { ...t, ctx: () => ctx!, surfaceChanged, dataChanged, tick: (ms: number) => (now += ms) };
}

const lastSurface = (fn: ReturnType<typeof vi.fn>): PluginSurfaceView => fn.mock.calls[fn.mock.calls.length - 1][0];

describe("PluginsController surface", () => {
  it("D0: nothing running → an empty surface, never pushed", async () => {
    const surfaceChanged = vi.fn();
    const t = await setup({ over: { surfaceChanged } });
    await t.ctl.start();
    expect(t.ctl.surface()).toEqual({ panels: [], chips: [], reloads: {} });
    const u = await setup({ plugins: { bundled: ["oncall"], on: [], local: false }, over: { surfaceChanged } });
    await bundled(u.root, "oncall", ONCALL);
    await u.ctl.start();
    expect(u.ctl.surface()).toEqual({ panels: [], chips: [], reloads: {} });
    expect(surfaceChanged).not.toHaveBeenCalled();
  });

  it("panelsNeeded: called when a plugin with panels starts, before panelHost serves it; never for none on or no panels (D0)", async () => {
    let servedAtCall: unknown = "not called";
    const t0 = await setup({ plugins: { bundled: ["oncall"], on: [], local: false }, over: { panelsNeeded: vi.fn() } });
    await bundled(t0.root, "oncall", ONCALL);
    await t0.ctl.start();
    expect(t0.deps.panelsNeeded).not.toHaveBeenCalled();
    const t1 = await setup({ plugins: { bundled: ["bare"], on: ["bare"], local: false }, over: { panelsNeeded: vi.fn() } });
    await bundled(t1.root, "bare", { data: { results: QUEUES } });
    await t1.ctl.start();
    expect(t1.ctl.surface().panels).toEqual([]);
    expect(t1.deps.panelsNeeded).not.toHaveBeenCalled();
    const ctlRef: { ctl?: { panelHost(id: string): unknown } } = {};
    const panelsNeeded = vi.fn(() => (servedAtCall = ctlRef.ctl?.panelHost("oncall")));
    const t2 = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, over: { panelsNeeded } });
    ctlRef.ctl = t2.ctl;
    await bundled(t2.root, "oncall", ONCALL);
    await t2.ctl.start();
    expect(panelsNeeded).toHaveBeenCalledTimes(1);
    // Installed before the plugin can be served or drawn.
    expect(servedAtCall).toBeNull();
  });

  it("panels in their slots, chips set and unset, and off removes them; each change is pushed", async () => {
    const t = await oncall();
    expect(t.ctl.surface().panels).toEqual([
      { plugin: "oncall", pluginName: "On-call", id: "queue", title: "Queue", slot: "plugins", url: "hh-plugin://oncall/panel-queue.html" },
      { plugin: "oncall", pluginName: "On-call", id: "side", title: "Side", slot: "bottom", url: "hh-plugin://oncall/panel-side.html" },
    ]);
    expect(t.surfaceChanged).toHaveBeenCalled();
    // P9: stored as given, no markup added.
    await t.ctx().call("chip.set", "who", { text: "<b>Ann</b>", severity: "warn" });
    const chips = [{ plugin: "oncall", pluginName: "On-call", id: "who", slot: "chips", text: "<b>Ann</b>", severity: "warn", panel: "queue" }];
    expect(t.ctl.surface().chips).toEqual(chips);
    expect(lastSurface(t.surfaceChanged).chips).toEqual(chips);
    await t.ctx().call("chip.clear", "who");
    expect(t.ctl.surface().chips).toEqual([]);
    expect(lastSurface(t.surfaceChanged).chips).toEqual([]);
    await t.ctx().call("chip.set", "who", { text: "Bo" });
    await t.ctl.setOn("oncall", false);
    expect(t.ctl.surface()).toEqual({ panels: [], chips: [], reloads: {} });
    expect(lastSurface(t.surfaceChanged)).toEqual({ panels: [], chips: [], reloads: {} });
  });

  it("a slot the harness doesn't declare, or of the other kind, falls back to the core's", async () => {
    const t = await oncall({ panels: [{ id: "a", slot: "nowhere", title: "A" }], chips: [{ id: "who", slot: "bottom" }] });
    await t.ctx().call("chip.set", "who", { text: "x" });
    expect(t.ctl.surface().panels.map((p) => p.slot)).toEqual(["plugins"]);
    expect(t.ctl.surface().chips.map((c) => c.slot)).toEqual(["chips"]);
  });

  it("panelHost: a running plugin's dist and panel ids; null for another, an inherited name, or once it stops (P7)", async () => {
    const t = await oncall();
    const host = t.ctl.panelHost("oncall");
    expect(host?.panels).toEqual(["queue", "side"]);
    expect(host?.dist).toMatch(/oncall[\\/]dist$/);
    expect(t.ctl.panelHost("other")).toBeNull();
    expect(t.ctl.panelHost("constructor")).toBeNull();
    await t.ctl.setOn("oncall", false);
    expect(t.ctl.panelHost("oncall")).toBeNull();
  });

  it("panelHost is null once the controller is stopped (detached)", async () => {
    const t = await oncall();
    expect(t.ctl.panelHost("oncall")).not.toBeNull();
    await t.ctl.stop();
    expect(t.ctl.panelHost("oncall")).toBeNull();
  });

  it("bumpReload counts per plugin and pushes", async () => {
    const t = await oncall();
    t.ctl.bumpReload("oncall");
    t.ctl.bumpReload("oncall");
    expect(t.ctl.surface().reloads).toEqual({ oncall: 2 });
    expect(lastSurface(t.surfaceChanged).reloads).toEqual({ oncall: 2 });
    t.ctl.bumpReload("nope");
    expect(t.ctl.surface().reloads).toEqual({ oncall: 2 });
  });
});

describe("PluginsController panel calls", () => {
  it("data.query reads only the plugin's own collections, read-only and capped (P5)", async () => {
    const t = await oncall();
    await t.ctx().data.put("queues", { key: "a", n: 1 });
    await t.ctx().data.put("queues", { key: "b", n: 2 });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "queues", where: { n: 2 }, limit: 50 })).toMatchObject({ ok: true, value: [{ key: "b", n: 2 }] });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "other.results" })).toEqual({ ok: false, error: "Unknown collection" });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "results" })).toEqual({ ok: false, error: "Unknown collection" });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "toString" })).toEqual({ ok: false, error: "Unknown collection" });
    expect(await t.ctl.panelCall("oncall", "queue", "data.put", { collection: "queues", record: { key: "c" } })).toMatchObject({ ok: false });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { op: "put", collection: "queues", record: { key: "c" } })).toMatchObject({ ok: false });
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "queues", limit: 10_000 })).toMatchObject({ ok: true });
    const big = { collection: "queues", where: { key: "x".repeat(5000) } };
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", big)).toEqual({ ok: false, error: "Too large" });
    // The records themselves, as plugin-ui's query and useQuery take them (the e2e found the store's wrapper read as []).
    expect(await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "queues" })).toEqual({ ok: true, value: [expect.objectContaining({ key: "a" }), expect.objectContaining({ key: "b" })] });
  });

  it("limit is capped at 500", async () => {
    const t = await oncall();
    const spy = vi.spyOn((t.ctl as unknown as { running: Map<string, { data: { query: (...a: unknown[]) => unknown } }> }).running.get("oncall")!.data, "query");
    await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "queues", limit: 10_000 });
    await t.ctl.panelCall("oncall", "queue", "data.query", { collection: "queues" });
    expect(spy.mock.calls.map((c) => (c[1] as { limit: number }).limit)).toEqual([500, 500]);
  });

  it("P4: a stopped plugin, an undeclared panel, another plugin's name → Not running; an unknown call is refused", async () => {
    const t = await oncall();
    expect(await t.ctl.panelCall("oncall", "nope", "settings.get", {})).toEqual({ ok: false, error: "Not running" });
    expect(await t.ctl.panelCall("other", "queue", "settings.get", {})).toEqual({ ok: false, error: "Not running" });
    expect(await t.ctl.panelCall("oncall", "queue", "resize", {})).toEqual({ ok: false, error: "Unknown call" });
    expect(await t.ctl.panelCall("oncall", "queue", "fetch", {})).toEqual({ ok: false, error: "Unknown call" });
    await t.ctl.setOn("oncall", false);
    expect(await t.ctl.panelCall("oncall", "queue", "settings.get", {})).toEqual({ ok: false, error: "Not running" });
  });

  it("settings.get gives values and work hours, never a key (B6)", async () => {
    const t = await oncall({ sources: [{ id: "s", ttl: 600, workHoursOnly: true }] }, { noWait: true });
    await t.ctl.setSecret("oncall", "tok", "secret-value-123");
    const answer = await t.ctl.panelCall("oncall", "queue", "settings.get", {});
    expect(answer).toMatchObject({ ok: true, value: { team: "docs", workHours: { days: expect.any(Array) } } });
    expect(JSON.stringify(answer)).not.toContain("secret-value-123");
  });

  it("refresh runs once; again within 10 s or while it runs → skipped; an unknown source is refused", async () => {
    let runs = 0;
    const t = await oncall({ sources: [{ id: "s", ttl: 600 }] }, { finish: async () => void runs++ });
    await until(() => runs === 1);
    expect(await t.ctl.panelCall("oncall", "queue", "refresh", { source: "s" })).toEqual({ ok: true, value: "skipped" });
    t.tick(10_001);
    expect(await t.ctl.panelCall("oncall", "queue", "refresh", { source: "s" })).toEqual({ ok: true, value: "refreshed" });
    expect(runs).toBe(2);
    expect(await t.ctl.panelCall("oncall", "queue", "refresh", { source: "s" })).toEqual({ ok: true, value: "skipped" });
    expect(await t.ctl.panelCall("oncall", "queue", "refresh", { source: "nope" })).toEqual({ ok: false, error: "Unknown source" });
    expect(runs).toBe(2);
  });

  it("refresh while a run is in flight → skipped", async () => {
    const t = await oncall();
    t.tick(60_000);
    expect(await t.ctl.panelCall("oncall", "queue", "refresh", { source: "s" })).toEqual({ ok: true, value: "skipped" });
  });
});

describe("PluginsController prepared tasks", () => {
  it("requestAction needs permissions.tasks and a declared action", async () => {
    const t = await oncall();
    expect(await t.ctl.requestAction("oncall", "nope", {})).toEqual({ ok: false, error: "Unknown action" });
    expect(await t.ctl.requestAction("other", "triage", { issue: "x" })).toEqual({ ok: false, error: "Not running" });
    (t.ctl as unknown as { running: Map<string, { approvedTasks: boolean }> }).running.get("oncall")!.approvedTasks = false;
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "x" })).toEqual({ ok: false, error: "This plugin may not prepare tasks" });
    expect(t.ctl.surface().prepared).toBeUndefined();
  });

  it("bad vars refuse; good vars prepare a card; a second within 2 s is too soon, later it replaces the first", async () => {
    const t = await oncall();
    expect(await t.ctl.panelCall("oncall", "queue", "requestAction", { action: "triage", vars: { issue: 3 } })).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "x", extra: "smuggled" })).toMatchObject({ ok: false });
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "y".repeat(201) })).toMatchObject({ ok: false, error: expect.stringMatching(/200/) });
    expect(t.ctl.surface().prepared).toBeUndefined();
    expect(await t.ctl.panelCall("oncall", "queue", "requestAction", { action: "triage", vars: { issue: "DOC-123" } })).toEqual({ ok: true, value: "prepared" });
    const first = t.ctl.surface().prepared!;
    expect(first).toMatchObject({ plugin: "oncall", pluginName: "On-call", title: "On-call · Triage DOC-123", prompt: "Triage DOC-123 now.", tier: "light", scope: "app" });
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(lastSurface(t.surfaceChanged).prepared).toEqual(first);
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "DOC-124" })).toEqual({ ok: false, error: "Too soon" });
    t.tick(2000);
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "DOC-125" })).toEqual({ ok: true, value: "prepared" });
    expect(t.ctl.surface().prepared?.title).toBe("On-call · Triage DOC-125");
    expect(await t.ctl.takePrepared(first.token)).toBeNull();
  });

  it("concurrent requestAction calls give one card", async () => {
    const t = await oncall();
    const out = await Promise.all([t.ctl.requestAction("oncall", "triage", { issue: "A" }), t.ctl.requestAction("oncall", "triage", { issue: "B" })]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.filter((o) => !o.ok)).toEqual([{ ok: false, error: "Too soon" }]);
  });

  it("a value holding {{x}} is not expanded again (P6)", async () => {
    const t = await oncall();
    await t.ctl.requestAction("oncall", "triage", { issue: "{{issue}}" });
    expect(t.ctl.surface().prepared?.prompt).toBe("Triage {{issue}} now.");
  });

  it("takePrepared gives exactly the card's text once (P13); cancel clears", async () => {
    const t = await oncall({ actions: [{ ...TRIAGE, scope: "required" }] });
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-1" });
    const card = t.ctl.surface().prepared!;
    expect(card.scope).toBe("open");
    const taken = await t.ctl.takePrepared(card.token);
    expect(taken).toEqual({ prompt: card.prompt, display: card.title, tier: "light", plugin: "oncall", scope: "required" });
    expect(taken!.prompt).toBe(card.prompt);
    expect(t.ctl.surface().prepared).toBeUndefined();
    expect(await t.ctl.takePrepared(card.token)).toBeNull();
    t.tick(2000);
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-2" });
    const next = t.ctl.surface().prepared!;
    t.ctl.cancelPrepared("wrong");
    expect(t.ctl.surface().prepared).toBeDefined();
    t.ctl.cancelPrepared(next.token);
    expect(t.ctl.surface().prepared).toBeUndefined();
    expect(await t.ctl.takePrepared(next.token)).toBeNull();
    expect(await t.ctl.takePrepared(undefined as unknown as string)).toBeNull();
  });

  it("a prepared task dies after 10 minutes", async () => {
    const t = await oncall();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-1" });
    const { token } = t.ctl.surface().prepared!;
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(t.ctl.surface().prepared).toBeUndefined();
    expect(await t.ctl.takePrepared(token)).toBeNull();
  });

  it("a base change, a rebase or the plugin turning off kills it", async () => {
    const t = await oncall();
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-1" });
    const a = t.ctl.surface().prepared!.token;
    await t.ctl.rebase();
    expect(await t.ctl.takePrepared(a)).toBeNull();
    t.tick(2000);
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-2" });
    const b = t.ctl.surface().prepared!.token;
    t.setBase(`${t.base}-other`);
    expect(await t.ctl.takePrepared(b)).toBeNull();
    t.setBase(t.base);
    await t.ctl.rebase();
    t.tick(2000);
    await until(() => t.ctl.surface().panels.length > 0);
    expect(await t.ctl.requestAction("oncall", "triage", { issue: "DOC-3" })).toEqual({ ok: true, value: "prepared" });
    const c = t.ctl.surface().prepared!.token;
    await t.ctl.setOn("oncall", false);
    expect(t.ctl.surface().prepared).toBeUndefined();
    expect(await t.ctl.takePrepared(c)).toBeNull();
  });
});

describe("PluginsController attention targets", () => {
  it("a panel target opens the panel and marks the item read; an action target prepares the task", async () => {
    const t = await oncall();
    await t.ctx().attention.raise({ key: "p", severity: "action", title: "Panel", target: { panel: "queue", focus: "DOC-1" } });
    await t.ctx().attention.raise({ key: "a", severity: "action", title: "Act", target: { action: "triage", vars: { issue: "DOC-9" } } });
    expect(await t.ctl.attention.open("oncall", "p")).toEqual({ kind: "panel", plugin: "oncall", panel: "queue", focus: "DOC-1" });
    expect((await t.ctl.attention.view()).items.find((i) => i.key === "p")?.read).toBe(true);
    expect(await t.ctl.attention.open("oncall", "a")).toEqual({ kind: "prepared" });
    expect(t.ctl.surface().prepared).toMatchObject({ title: "On-call · Triage DOC-9", prompt: "Triage DOC-9 now." });
    expect(await t.ctl.attention.open("oncall", "missing")).toEqual({ kind: "none" });
    expect(await t.ctl.attention.open(1 as unknown as string, "a")).toEqual({ kind: "none" });
  });

  it("bad vars, a plugin that is off, or a panel that is gone → none", async () => {
    const t = await oncall();
    await t.ctx().attention.raise({ key: "bad", severity: "action", title: "Bad", target: { action: "triage", vars: { issue: 1 } } });
    await t.ctx().attention.raise({ key: "p", severity: "info", title: "Panel", target: { panel: "queue" } });
    expect(await t.ctl.attention.open("oncall", "bad")).toEqual({ kind: "none" });
    expect(t.ctl.surface().prepared).toBeUndefined();
    await t.ctl.setOn("oncall", false);
    expect(await t.ctl.attention.open("oncall", "p")).toEqual({ kind: "none" });
  });

  it("an action target whose request is refused (too soon) → none and an error-log line", async () => {
    const t = await oncall();
    await t.ctx().attention.raise({ key: "a", severity: "action", title: "Act", target: { action: "triage", vars: { issue: "DOC-9" } } });
    await t.ctl.requestAction("oncall", "triage", { issue: "DOC-1" });
    expect(await t.ctl.attention.open("oncall", "a")).toEqual({ kind: "none" });
    expect((await t.ctl.detail("oncall"))!.errors.map((e) => e.message).join("\n")).toMatch(/Too soon/);
  });
});

describe("PluginsController data pushes", () => {
  it("a run that wrote pushes its collections once at its end; a run that wrote nothing pushes nothing", async () => {
    let write = true;
    const t = await oncall({ sources: [{ id: "s", ttl: 600 }] }, {
      finish: async (ctx) => {
        if (!write) return;
        await ctx.data.put("queues", { key: "a" });
        await ctx.data.put("queues", { key: "b" });
        await ctx.data.query("other");
      },
    });
    await until(() => t.dataChanged.mock.calls.length > 0);
    expect(t.dataChanged.mock.calls).toEqual([["oncall", ["queues"]]]);
    write = false;
    t.tick(20_000);
    await t.ctl.refresh("oncall", "s");
    expect(t.dataChanged).toHaveBeenCalledTimes(1);
  });
});
