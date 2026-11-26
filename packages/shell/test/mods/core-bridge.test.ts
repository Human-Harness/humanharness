import type { MainCtx } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { type CoreAppParts, coreAppFor } from "../../src/main/mods/core-app";
import { type HostDeps, ModHost } from "../../src/main/mods/host";
import { PUSH_CHANNELS } from "../../src/main/mods/push-channels";
import { needsHost } from "../../src/main/mods/wiring";

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

/** A fake of everything the app hands the core mods, recording each call. */
function parts() {
  const calls: unknown[][] = [];
  const rec =
    <A extends unknown[], R>(name: string, value: R) =>
    (...args: A): R => {
      calls.push([name, ...args]);
      return value;
    };
  const engine = (id: string) => ({ id }) as never;
  let turns = 0;
  const session = {
    profile: { engine: "codex", tier: "deep", model: "big", effort: "high", cap: 1000 },
    ask: vi.fn(async (prompt: string) => ({ ok: true, text: `${prompt}#${++turns}` })),
    close: vi.fn(async () => {}),
  };
  const p: CoreAppParts = {
    harness: { name: "Demo", tagline: "Tag", sidekick: { purposes: ["x"] } },
    phases: rec("phases", [{ id: "plan", label: "Plan", brief: "plan.md" }]),
    phaseBrief: rec("phaseBrief", Promise.resolve("Plan carefully")),
    dataTables: rec("dataTables", ["books"]),
    setup: rec("setup", Promise.resolve({ engineId: "codex", base: "/base" })),
    task: rec("task", Promise.resolve({ id: "t1", scope: "main", phase: "plan" })),
    hasNotice: rec("hasNotice", Promise.resolve(true)),
    engine: (id) => (calls.push(["engine", id]), engine(id)),
    command: (e) => (calls.push(["command", e.id]), Promise.resolve({ command: ["codex"], env: { A: "1" } })),
    profile: (e, tier, process) => (calls.push(["profile", e.id, tier, process]), Promise.resolve(session.profile as never)),
    workDir: rec("workDir", "/work/sidekick"),
    writeBrief: (folder, text, e) => (calls.push(["writeBrief", folder, text, e.id]), Promise.resolve(true)),
    open: (o) => (calls.push(["open", o.engine.id, o.command, o.folder, o.profile]), session as never),
    uiLanguage: rec("uiLanguage", Promise.resolve("English")),
    dailyInput: rec("dailyInput", Promise.resolve({ day: "2026-11-18", notes: ["N"], tokens: { tasks: 1, sidekick: 2 }, open: [] })),
    pickImportFiles: rec("pickImportFiles", Promise.resolve(["/a.md"])),
    tagKey: (id, create) => (calls.push(["tagKey", id, create]), Promise.resolve(Buffer.alloc(32, 1))),
    personData: rec("personData", Promise.resolve({ ok: true })),
    saveDecision: rec("saveDecision", Promise.resolve()),
  };
  return { p, calls, session };
}

describe("ctx.push (core mods only)", () => {
  it("a core mod pushes on an existing app channel and the window receives it", async () => {
    const push = vi.fn();
    const h = await host({ push });
    h.registerForTest("sidekick", "Sidekick", (ctx) => (ctx as CoreMainCtx<unknown>).push("hh:tasks", { cards: [] }), { core: true });
    expect(push).toHaveBeenCalledWith("hh:tasks", { cards: [] });
  });

  it("an unknown channel is refused, and nothing reaches the window", async () => {
    const push = vi.fn();
    const h = await host({ push });
    let ctx!: CoreMainCtx<unknown>;
    h.registerForTest("sidekick", "Sidekick", (c) => void (ctx = c as CoreMainCtx<unknown>), { core: true });
    expect(() => ctx.push("hh:nope", 1)).toThrow(/hh:nope/);
    // A name without `hh:` is the mod's own (mods-1b): it never reaches an app channel.
    ctx.push("sidekick" as never, 1);
    // hh:modPush carries a mod's id: no core mod names it.
    expect(() => ctx.push("hh:modPush", 1)).toThrow();
    // An invoke channel is not a push channel.
    expect(() => ctx.push("hh:getTasks", 1)).toThrow();
    expect(push).not.toHaveBeenCalled();
  });

  it("a mod that was turned off pushes nothing", async () => {
    const push = vi.fn();
    const h = await host({ push });
    let ctx!: CoreMainCtx<unknown>;
    h.registerForTest("sidekick", "Sidekick", (c) => void (ctx = c as CoreMainCtx<unknown>), { core: true });
    await h.set("sidekick", false);
    ctx.push("hh:tasks", 1);
    expect(push).not.toHaveBeenCalled();
  });

  it("knows the app's push channels", () => {
    expect(PUSH_CHANNELS.has("hh:tasks")).toBe(true);
    expect(PUSH_CHANNELS.has("hh:modsChanged")).toBe(true);
    expect(PUSH_CHANNELS.has("hh:getTasks")).toBe(false);
    // Sidekick's state goes on the mod's own name (minimal-core 1b), never on an app channel.
    expect([...PUSH_CHANNELS].filter((c) => c.startsWith(`hh:${"sidekick"}`))).toEqual([]);
  });
});

describe("ctx.app (core mods only)", () => {
  it("offers every service, built on the app's own parts", async () => {
    const { p, calls, session } = parts();
    const h = await host({ push: vi.fn(), coreApp: (id) => coreAppFor(p, id) });
    let ctx!: CoreMainCtx<unknown>;
    h.registerForTest("sidekick", "Sidekick", (c) => void (ctx = c as CoreMainCtx<unknown>), { core: true });
    const app = ctx.app;

    // Harness: name, phases, a phase's brief, the raw sidekick key, the data tables.
    expect(app.harness.name).toBe("Demo");
    expect(app.harness.tagline).toBe("Tag");
    expect(app.harness.sidekick).toEqual({ purposes: ["x"] });
    expect(app.harness.phases("build")).toEqual([{ id: "plan", label: "Plan", brief: "plan.md" }]);
    expect(await app.harness.phaseBrief("build", "plan")).toBe("Plan carefully");
    expect(app.harness.dataTables()).toEqual(["books"]);
    expect(await app.setup()).toEqual({ engineId: "codex", base: "/base" });
    expect(await app.task()).toEqual({ id: "t1", scope: "main", phase: "plan" });

    // A session of several turns, on the engine and model the mod chose.
    expect(await app.sessions.hasNotice("codex")).toBe(true);
    const cmd = await app.sessions.command("codex");
    const profile = await app.sessions.profile("codex", "deep");
    const own = await app.sessions.profile("claude");
    expect(app.sessions.workDir("/base", "sidekick")).toBe("/work/sidekick");
    await app.sessions.writeBrief("/work/sidekick", "# Brief", "codex");
    const s = app.sessions.open({ engineId: "codex", command: cmd!.command, env: cmd!.env, folder: "/work/sidekick", profile });
    const signal = new AbortController().signal;
    expect((await s.ask("one", signal)).text).toBe("one#1");
    expect((await s.ask("two", signal)).text).toBe("two#2");
    expect(s.profile.model).toBe("big");
    await s.close();
    expect(session.ask).toHaveBeenCalledTimes(2);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(calls).toContainEqual(["command", "codex"]);
    expect(calls).toContainEqual(["profile", "codex", "deep", "sidekick"]);
    // Without a tier: the mod's own process.
    expect(calls).toContainEqual(["profile", "claude", undefined, "sidekick"]);
    expect(own.engine).toBe("codex");
    expect(calls).toContainEqual(["writeBrief", "/work/sidekick", "# Brief", "codex"]);
    expect(calls.filter((c) => c[0] === "open")).toEqual([["open", "codex", ["codex"], "/work/sidekick", session.profile]]);

    // The rest: the UI language, the daily input, the picker, the source-tag key and writes as the person.
    expect(await app.uiLanguage()).toBe("English");
    expect((await app.dailyInput("/base", "2026-11-18")).notes).toEqual(["N"]);
    expect(await app.pickImportFiles()).toEqual(["/a.md"]);
    expect((await app.tagKey(true))?.length).toBe(32);
    expect(calls).toContainEqual(["tagKey", "sidekick", true]);
    await app.person.data({ op: "put", collection: "sidekick", record: {} }, { scope: "_app" });
    expect(calls).toContainEqual(["personData", { op: "put", collection: "sidekick", record: {} }, { scope: "_app" }]);
    await app.person.note({ scope: "main", title: "T", decision: "D" });
    expect(calls).toContainEqual(["saveDecision", { scope: "main", title: "T", decision: "D" }]);
  });

  it("a harness mod and a local mod push only on their own names, and see no ctx.app", async () => {
    const { p } = parts();
    const push = vi.fn();
    const h = await host({ push, coreApp: (id) => coreAppFor(p, id) });
    const seen: Record<string, MainCtx<unknown>> = {};
    h.registerForTest("own", "Own", (c) => void (seen.own = c), { origin: "harness" });
    h.registerForTest("mine", "Mine", (c) => void (seen.mine = c));
    h.registerForTest("core", "Core", (c) => void (seen.core = c), { core: true });
    for (const id of ["own", "mine"]) {
      expect(() => seen[id].push("hh:settings", 1)).toThrow(/core mod/);
      expect("app" in seen[id]).toBe(false);
    }
    expect(push).not.toHaveBeenCalled();
    expect("push" in seen.core && "app" in seen.core).toBe(true);
  });

  it("an app with no mod builds no host, and a host without the bridge gives a core mod no app push and no ctx.app", async () => {
    expect(needsHost({ declared: undefined, local: [], coreIds: [] })).toBe(false);
    const h = await host();
    let ctx!: MainCtx<unknown>;
    h.registerForTest("core", "Core", (c) => void (ctx = c), { core: true });
    expect(() => ctx.push("hh:settings", 1)).toThrow();
    expect("app" in ctx).toBe(false);
  });
});
