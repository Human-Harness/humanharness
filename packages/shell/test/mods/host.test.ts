import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ModHost, type HostDeps } from "../../src/main/mods/host";
import { resolveMods } from "../../src/main/mods/resolve";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");
const task = { id: "t1", scope: "main" };
/** For the `slow` fixture, whose beforeSend never answers. */
const SHORT = { beforeSendMs: 50, hookMs: 50 };

async function host(declared: Record<string, Record<string, unknown>>, over: Partial<HostDeps> = {}) {
  const { mods } = await resolveMods({ declared, harnessModsDir: fx, local: [], core: {} });
  const deps: HostDeps = {
    config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    // Far past any load: only the tests of a mod that never answers take the short budget.
    beforeSendMs: 5_000,
    hookMs: 5_000,
    ...over,
  };
  const h = new ModHost(deps);
  await h.start(mods);
  return { h, deps };
}

describe("ModHost", () => {
  it("runs beforeSend rewrites in load order and passes config", async () => {
    const { h } = await host({ echo: { word: "hi" } });
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("hi");
    expect(await h.beforeSend({ text: "other", task: null })).toBe("other");
  });
  it("sends the text unchanged when a mod throws or holds past the budget", async () => {
    const { h } = await host({ broken: {}, slow: {} }, SHORT);
    expect(await h.beforeSend({ text: "x", task: null })).toBe("x");
  });
  it("turns a mod off after three failures in a row, saves why, and tells the person", async () => {
    const { h, deps } = await host({ broken: {} });
    for (let i = 0; i < 3; i++) await h.beforeSend({ text: "x", task: null });
    expect(h.view().find((m) => m.id === "broken")).toMatchObject({ on: false, failed: "broken on purpose" });
    expect(deps.config.saveFailed).toHaveBeenCalledWith("broken", "broken on purpose");
    expect(deps.notice).toHaveBeenCalledWith(expect.stringContaining("Broken"));
  });
  it("counts a timeout as a strike: three holds past the budget turn the mod off", async () => {
    const { h } = await host({ slow: {} }, SHORT);
    for (let i = 0; i < 3; i++) expect(await h.beforeSend({ text: "x", task: null })).toBe("x");
    expect(h.view().find((m) => m.id === "slow")).toMatchObject({ on: false, failed: expect.stringMatching(/^timed out after \d+ ms$/) });
  });
  it("a mod that failed before starts off, with its reason", async () => {
    const { h } = await host({ echo: {} }, { config: { load: async () => ({ failed: { echo: "threw" } }), saveFailed: vi.fn(async () => {}) } });
    expect(h.view()[0]).toMatchObject({ on: false, failed: "threw" });
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("ping");
  });
  it("a success resets the count", async () => {
    let fail = true;
    const { mods } = await resolveMods({ declared: {}, harnessModsDir: fx, local: [], core: {} });
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 5_000, hookMs: 5_000 });
    await h.start(mods);
    h.registerForTest("flaky", "Flaky", (ctx) => ctx.on.taskOpen(() => { if (fail) throw new Error("x"); }));
    await h.taskOpen(task);
    await h.taskOpen(task);
    fail = false;
    await h.taskOpen(task);
    fail = true;
    await h.taskOpen(task);
    await h.taskOpen(task);
    expect(h.view().find((m) => m.id === "flaky")?.on).toBe(true);
  });
  it("turning a mod off runs its disposers: its hooks stop", async () => {
    const { h } = await host({ echo: {} });
    await h.set("echo", false);
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("ping");
    await h.set("echo", true);
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("pong");
  });
  it("answers a mod's ipc and refuses an unknown one", async () => {
    const { h } = await host({ echo: {} });
    expect(await h.ipc("echo", "hello", 1)).toEqual({ ok: true, value: { hello: 1 } });
    expect(await h.ipc("echo", "nope", 1)).toEqual({ ok: false, reason: "no such channel" });
  });
  it("lists what a mod registered", async () => {
    const { h } = await host({ echo: {} });
    expect(h.view()[0]).toMatchObject({ id: "echo", name: "Echo", version: "0.1.0", origin: "harness", on: true, registers: { hooks: ["beforeSend", "turnEnd"], ipc: ["hello"] } });
  });
  it("turns on a mod without main, importing nothing, with no hooks", async () => {
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 5_000, hookMs: 5_000 });
    // The folder has no code at all: an import would fail.
    await h.start([{ json: { id: "plain", name: "Plain", version: "0.1.0", apiVersion: 1, requires: [], history: false }, dir: path.join(fx, "nowhere"), origin: "harness", shipped: "harness", config: { a: 1 } }]);
    expect(h.view()[0]).toMatchObject({ id: "plain", on: true, ui: false, registers: { hooks: [], ipc: [] } });
    expect(h.view()[0].problem).toBeUndefined();
  });
  it("says which mods have a ui part (0b2: the window imports it)", async () => {
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 5_000, hookMs: 5_000 });
    await h.start([{ json: { id: "shown", name: "Shown", version: "0.1.0", apiVersion: 1, requires: [], history: false, ui: "ui.js" }, dir: path.join(fx, "nowhere"), origin: "harness", shipped: "harness", config: undefined }]);
    expect(h.view()[0]).toMatchObject({ id: "shown", ui: true });
  });
  it("starts a core mod whose core default is on", async () => {
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), coreOn: (id) => id === "plain" });
    const json = (id: string) => ({ id, name: id, version: "0.1.0", apiVersion: 1 as const, requires: [], history: false });
    await h.start([
      { json: json("plain"), dir: "", origin: "core", shipped: "core", config: undefined },
      { json: json("other"), dir: "", origin: "core", shipped: "core", config: undefined },
    ]);
    expect(h.view().map((m) => [m.id, m.on])).toEqual([["plain", true], ["other", false]]);
  });
  it("doesn't start a mod whose required mod is missing or off", async () => {
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 5_000, hookMs: 5_000 });
    await h.start([{ json: { id: "needy", name: "Needy", version: "0.1.0", apiVersion: 1, requires: ["ghost"], history: false, main: "main.js" }, dir: path.join(fx, "echo"), origin: "harness", shipped: "harness", config: undefined }]);
    expect(h.view()[0]).toMatchObject({ on: false, problem: 'needs the mod "ghost"' });
  });
});
