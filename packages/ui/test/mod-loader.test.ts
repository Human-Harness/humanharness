// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ModRow, ModsView } from "../src/client";
import { type ModModule, type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { type BlockComponent, createBlockRegistry } from "../src/layout/registry";

const row = (id: string, over: Partial<ModRow> = {}): ModRow => ({
  id,
  name: id,
  version: "1.0.0",
  origin: "local",
  on: true,
  ui: true,
  registers: { hooks: [], ipc: [] },
  ...over,
});
const view = (...mods: ModRow[]): ModsView => ({ mods, problems: [] });

/** A fake hh client: `view()` answers `current`; `changed` and `reloaded` push like main does. */
function fakeClient(initial: ModsView) {
  let current = initial;
  const changed = new Set<(v: ModsView) => void>();
  const reloaded = new Set<(e: { id: string; version: number }) => void>();
  const listeners = new Set<{ id: string; name: string; fn: (v: unknown) => void }>();
  const calls: [string, string, unknown][] = [];
  return {
    calls,
    listeners,
    client: {
      mods: {
        call: async (id: string, name: string, payload?: unknown) => {
          calls.push([id, name, payload]);
          if (name === "fail") throw new Error(`Mod "${id}" has no channel "fail"`);
          return `${id}:${name}`;
        },
        on: (id: string, name: string, fn: (v: unknown) => void) => {
          const l = { id, name, fn };
          listeners.add(l);
          return () => void listeners.delete(l);
        },
        view: async () => current,
        onChanged: (fn: (v: ModsView) => void) => (changed.add(fn), () => void changed.delete(fn)),
        onReloaded: (fn: (e: { id: string; version: number }) => void) => (reloaded.add(fn), () => void reloaded.delete(fn)),
      },
    },
    push(v: ModsView) {
      current = v;
      for (const fn of changed) fn(v);
    },
    reload(id: string, version: number) {
      for (const fn of reloaded) fn({ id, version });
    },
    /** Main's `hh:modPush`. */
    modPush(id: string, name: string, value: unknown) {
      for (const l of [...listeners]) if (l.id === id && l.name === name) l.fn(value);
    },
  };
}

const block = (label: string): BlockComponent => Object.assign(() => null, { label });
/** A mod whose ui registers one block per name, each labelled `label`. */
const mod = (label: string, names = ["main"]): ModModule => ({ default: { ui: (ctx: UiCtx) => void names.forEach((n) => ctx.block(n, block(label))) } });
const label = (c: BlockComponent | undefined) => (c as unknown as { label?: string } | undefined)?.label;

describe("startModLoader", () => {
  it("registers the blocks of an on mod with a ui, imported from hh-mod with its version", async () => {
    const { client } = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const importer = vi.fn(async () => mod("one"));
    const loader = startModLoader({ client, registry, importer });
    await loader.settled();
    expect(importer).toHaveBeenCalledWith("hh-mod://hello/ui.js?v=1.0.0-0");
    expect(label(registry.get("hello", "main"))).toBe("one");
    loader.stop();
  });

  it("a reload replaces the blocks with the new import's", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const importer = vi.fn(async (url: string) => (url.endsWith("-0") ? mod("one", ["main", "old"]) : mod("two")));
    const loader = startModLoader({ client: f.client, registry, importer });
    await loader.settled();
    f.reload("hello", 1);
    await loader.settled();
    expect(importer).toHaveBeenLastCalledWith("hh-mod://hello/ui.js?v=1.0.0-1");
    expect(label(registry.get("hello", "main"))).toBe("two");
    expect(registry.get("hello", "old")).toBeUndefined();
    loader.stop();
  });

  it("a failed import on reload leaves the old blocks and logs", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const log = vi.fn();
    const importer = vi.fn(async (url: string) => {
      if (url.endsWith("-0")) return mod("one");
      throw new Error("404");
    });
    const loader = startModLoader({ client: f.client, registry, importer, log });
    await loader.settled();
    f.reload("hello", 1);
    await loader.settled();
    expect(label(registry.get("hello", "main"))).toBe("one");
    expect(log).toHaveBeenCalled();
    loader.stop();
  });

  it("a mod turned off loses its blocks; turned on again it gets them back", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const loader = startModLoader({ client: f.client, registry, importer: async () => mod("one") });
    await loader.settled();
    f.push(view(row("hello", { on: false })));
    await loader.settled();
    expect(registry.get("hello", "main")).toBeUndefined();
    f.push(view(row("hello")));
    await loader.settled();
    expect(label(registry.get("hello", "main"))).toBe("one");
    loader.stop();
  });

  it("a mod gone from the list loses its blocks", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const loader = startModLoader({ client: f.client, registry, importer: async () => mod("one") });
    await loader.settled();
    f.push(view());
    await loader.settled();
    expect(registry.get("hello", "main")).toBeUndefined();
    loader.stop();
  });

  it("a throwing ui() registers nothing and doesn't stop the others", async () => {
    const { client } = fakeClient(view(row("bad"), row("good")));
    const registry = createBlockRegistry();
    const log = vi.fn();
    const importer = async (url: string): Promise<ModModule> =>
      url.startsWith("hh-mod://bad/")
        ? {
            default: {
              ui: (ctx) => {
                ctx.block("main", block("half"));
                throw new Error("boom");
              },
            },
          }
        : mod("good");
    const loader = startModLoader({ client, registry, importer, log });
    await loader.settled();
    expect(registry.get("bad", "main")).toBeUndefined();
    expect(label(registry.get("good", "main"))).toBe("good");
    expect(log).toHaveBeenCalled();
    loader.stop();
  });

  it("skips core rows and rows without a ui", async () => {
    const { client } = fakeClient(view(row("home", { origin: "core" }), row("quiet", { ui: false })));
    const registry = createBlockRegistry();
    const importer = vi.fn(async () => mod("x"));
    const loader = startModLoader({ client, registry, importer });
    await loader.settled();
    expect(importer).not.toHaveBeenCalled();
    loader.stop();
  });

  it("a new version in hh:modsChanged imports again", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const importer = vi.fn(async (url: string) => (url.includes("v=2.0.0") ? mod("two") : mod("one")));
    const loader = startModLoader({ client: f.client, registry, importer });
    await loader.settled();
    f.push(view(row("hello", { version: "2.0.0" })));
    await loader.settled();
    expect(label(registry.get("hello", "main"))).toBe("two");
    loader.stop();
  });

  it("stop takes every block away and ignores later pushes", async () => {
    const f = fakeClient(view(row("hello")));
    const registry = createBlockRegistry();
    const importer = vi.fn(async () => mod("one"));
    const loader = startModLoader({ client: f.client, registry, importer });
    await loader.settled();
    loader.stop();
    expect(registry.get("hello", "main")).toBeUndefined();
    f.reload("hello", 1);
    await loader.settled();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("ctx.call and ctx.on are bound to the mod's own id", async () => {
    const f = fakeClient(view(row("hello")));
    const heard: unknown[] = [];
    let answer: Promise<unknown> | undefined;
    const importer = async (): Promise<ModModule> => ({
      default: {
        ui: (ctx) => {
          ctx.on("tick", (v) => heard.push(v));
          answer = ctx.call("ping", 1);
        },
      },
    });
    const loader = startModLoader({ client: f.client, registry: createBlockRegistry(), importer });
    await loader.settled();
    expect(await answer).toBe("hello:ping");
    expect(f.calls).toEqual([["hello", "ping", 1]]);
    f.modPush("hello", "tick", 5);
    f.modPush("other", "tick", 6);
    f.modPush("hello", "tock", 7);
    expect(heard).toEqual([5]);
    loader.stop();
  });

  it("a rejected call reaches the ui as a rejection", async () => {
    const f = fakeClient(view(row("hello")));
    let answer: Promise<unknown> | undefined;
    const importer = async (): Promise<ModModule> => ({ default: { ui: (ctx) => void (answer = ctx.call("fail")) } });
    const loader = startModLoader({ client: f.client, registry: createBlockRegistry(), importer });
    await loader.settled();
    await expect(answer).rejects.toThrow('has no channel "fail"');
    loader.stop();
  });

  it("a reload, a mod turned off, or a throwing ui() drops the listeners its ui added", async () => {
    const f = fakeClient(view(row("hello"), row("bad")));
    const importer = async (url: string): Promise<ModModule> => ({
      default: {
        ui: (ctx) => {
          ctx.on("tick", () => {});
          if (url.startsWith("hh-mod://bad/")) throw new Error("boom");
        },
      },
    });
    const loader = startModLoader({ client: f.client, registry: createBlockRegistry(), importer, log: () => {} });
    await loader.settled();
    expect([...f.listeners].map((l) => l.id)).toEqual(["hello"]);
    f.reload("hello", 1);
    await loader.settled();
    expect(f.listeners.size).toBe(1);
    f.push(view(row("hello", { on: false })));
    await loader.settled();
    expect(f.listeners.size).toBe(0);
    loader.stop();
  });

  it("a listener added later (from a block) works, and goes with the mod", async () => {
    const f = fakeClient(view(row("hello")));
    let later!: () => void;
    const heard: unknown[] = [];
    const importer = async (): Promise<ModModule> => ({ default: { ui: (ctx) => void (later = () => void ctx.on("tick", (v) => heard.push(v))) } });
    const loader = startModLoader({ client: f.client, registry: createBlockRegistry(), importer });
    await loader.settled();
    later();
    f.modPush("hello", "tick", 1);
    expect(heard).toEqual([1]);
    loader.stop();
    expect(f.listeners.size).toBe(0);
    later();
    expect(f.listeners.size).toBe(0);
  });

  it("runs the window's core mods' ui with the same ctx, without importing them", async () => {
    const f = fakeClient(view(row("home", { origin: "core" })));
    const registry = createBlockRegistry();
    const importer = vi.fn(async () => mod("x"));
    const heard: unknown[] = [];
    let answer: Promise<unknown> | undefined;
    const home = {
      id: "home",
      ui: (ctx: UiCtx) => {
        ctx.block("main", block("home"));
        ctx.on("tick", (v) => heard.push(v));
        answer = ctx.call("ping");
      },
    };
    const loader = startModLoader({ client: f.client, registry, importer, core: [home] });
    await loader.settled();
    expect(importer).not.toHaveBeenCalled();
    expect(label(registry.get("home", "main"))).toBe("home");
    expect(await answer).toBe("home:ping");
    f.modPush("home", "tick", 9);
    expect(heard).toEqual([9]);
    loader.stop();
    expect(registry.get("home", "main")).toBeUndefined();
    expect(f.listeners.size).toBe(0);
  });
});
