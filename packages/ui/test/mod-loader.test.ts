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
  return {
    client: {
      mods: {
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
});
