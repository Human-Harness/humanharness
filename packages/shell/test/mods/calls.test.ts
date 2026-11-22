import { describe, expect, it, vi } from "vitest";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { type ModLoaderOptions, createBlockRegistry, startModLoader } from "@humanharness/ui";
import { ModHost, type HostDeps } from "../../src/main/mods/host";
import { registerModsIpc } from "../../src/main/mods/mods-ipc";

/** A mod's ui calls its own main by name (`hh:modCall`) and hears its pushes (`hh:modPush`): mods-1b, mod-calls. */
function deps(over: Partial<HostDeps> = {}): HostDeps {
  return { config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), hookMs: 5_000, ...over };
}

describe("ModHost: a mod's own calls and pushes", () => {
  it("answers a call by name with the mod's ipc handler", async () => {
    const h = new ModHost(deps());
    h.registerForTest("pinger", "Pinger", (ctx) => void ctx.ipc("ping", (x) => (x as number) + 1));
    expect(await h.call("pinger", "ping", 1)).toBe(2);
  });
  it("rejects a call to a mod that is off, unknown, or a name it did not register", async () => {
    const h = new ModHost(deps());
    h.registerForTest("pinger", "Pinger", (ctx) => void ctx.ipc("ping", () => "pong"));
    await expect(h.call("pinger", "nope", 1)).rejects.toThrow('Mod "pinger" has no channel "nope"');
    await expect(h.call("ghost", "ping", 1)).rejects.toThrow('No mod "ghost"');
    await h.set("pinger", false);
    await expect(h.call("pinger", "ping", 1)).rejects.toThrow('Mod "pinger" is off');
  });
  it("a handler that throws rejects the call with its reason", async () => {
    const h = new ModHost(deps());
    h.registerForTest("pinger", "Pinger", (ctx) => void ctx.ipc("ping", () => { throw new Error("bad ping"); }));
    await expect(h.call("pinger", "ping", 1)).rejects.toThrow("bad ping");
  });
  it("an app channel is never a mod's own call", async () => {
    const h = new ModHost(deps());
    h.registerForTest("core1", "Core", (ctx) => void ctx.ipc("hh:coreThing", () => 1), { core: true });
    await expect(h.call("core1", "hh:coreThing", [])).rejects.toThrow("has no channel");
  });
  it("any mod pushes on its own names, while it is on", async () => {
    const modPush = vi.fn();
    const h = new ModHost(deps({ modPush }));
    let push!: (name: string, value: unknown) => void;
    h.registerForTest("ticker", "Ticker", (ctx) => void (push = ctx.push));
    push("tick", 3);
    expect(modPush).toHaveBeenCalledWith("ticker", "tick", 3);
    expect(() => push("hh:settings", 1)).toThrow();
    expect(() => push("", 1)).toThrow();
    await h.set("ticker", false);
    push("tick", 4);
    expect(modPush).toHaveBeenCalledTimes(1);
  });
  it("a core mod's push: an app channel goes to the app's, any other name is its own", () => {
    const modPush = vi.fn();
    const appPush = vi.fn();
    const h = new ModHost(deps({ modPush, push: appPush }));
    let ctx!: CoreMainCtx<unknown>;
    h.registerForTest("core1", "Core", (c) => void (ctx = c as CoreMainCtx<unknown>), { core: true });
    ctx.push("hh:settings", 1);
    expect(appPush).toHaveBeenCalledWith("hh:settings", 1);
    (ctx.push as (n: string, v: unknown) => void)("tick", 2);
    expect(modPush).toHaveBeenCalledWith("core1", "tick", 2);
    // hh:modPush carries a mod's id: a core mod can't forge another mod's push through it.
    expect(() => ctx.push("hh:modPush", { id: "other", name: "tick", value: 0 })).toThrow();
  });
});

describe("hh:modCall", () => {
  function setup(call = vi.fn(async (..._a: unknown[]): Promise<unknown> => "ok")) {
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const handle = (c: string, fn: (...a: unknown[]) => unknown) => void handlers.set(c, fn);
    const none = async () => {
      throw new Error("unused");
    };
    registerModsIpc(handle as never, {
      view: async () => ({ mods: [], problems: [] }),
      set: none,
      pickFolder: none,
      addLocal: none,
      removeLocal: none,
      isLocal: () => false,
      taken: () => false,
      needsReview: async () => false,
      reviewUser: async () => null,
      trustUser: none,
      call,
    });
    return { invoke: (...a: unknown[]) => Promise.resolve(handlers.get("hh:modCall")!(...a)), call };
  }
  it("routes a call to the named mod", async () => {
    const { invoke, call } = setup();
    expect(await invoke("pinger", "ping", { x: 1 })).toBe("ok");
    expect(call).toHaveBeenCalledWith("pinger", "ping", { x: 1 });
  });
  it("refuses a malformed id or name, and an app channel's name", async () => {
    const { invoke, call } = setup();
    await expect(invoke("Bad!", "ping", 1)).rejects.toThrow();
    await expect(invoke("pinger", 3, 1)).rejects.toThrow();
    await expect(invoke("pinger", "", 1)).rejects.toThrow();
    await expect(invoke("pinger", "hh:sidekickList", 1)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});

describe("a mod's ui and its main, end to end", () => {
  it("the ui calls its main by name and receives its pushes; it cannot reach another mod's names", async () => {
    const pushes = new Set<(p: { id: string; name: string; value: unknown }) => void>();
    const host = new ModHost(deps({ modPush: (id, name, value) => pushes.forEach((fn) => fn({ id, name, value })) }));
    let tick!: (v: unknown) => void;
    host.registerForTest("pinger", "Pinger", (ctx) => {
      ctx.ipc("ping", (x) => `pong ${String(x)}`);
      tick = (v) => ctx.push("tick", v);
    });
    host.registerForTest("other", "Other", (ctx) => void ctx.ipc("secret", () => "leak"));
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const none = async () => {
      throw new Error("unused");
    };
    registerModsIpc(((c: string, fn: (...a: unknown[]) => unknown) => void handlers.set(c, fn)) as never, {
      view: async () => ({ mods: host.view(), problems: [] }),
      set: none,
      pickFolder: none,
      addLocal: none,
      removeLocal: none,
      isLocal: () => false,
      taken: () => false,
      needsReview: async () => false,
      reviewUser: async () => null,
      trustUser: none,
      call: (id, name, payload) => host.call(id, name, payload),
    });
    // The preload's shape, over the handlers above.
    const client = {
      mods: {
        view: async () => ({ mods: host.view().map((r) => ({ ...r, ui: true })), problems: [] }),
        onChanged: () => () => {},
        onReloaded: () => () => {},
        call: async (id: string, name: string, payload?: unknown) => handlers.get("hh:modCall")!(id, name, payload),
        on: (id: string, name: string, fn: (v: unknown) => void) => {
          const l = (p: { id: string; name: string; value: unknown }) => void (p.id === id && p.name === name && fn(p.value));
          pushes.add(l);
          return () => void pushes.delete(l);
        },
      },
    };
    const heard: unknown[] = [];
    let answer: Promise<unknown> | undefined;
    let stolen: Promise<unknown> | undefined;
    const importer: NonNullable<ModLoaderOptions["importer"]> = async (url) => ({
      default: {
        ui: (ctx) => {
          if (!url.startsWith("hh-mod://pinger/")) return;
          ctx.on("tick", (v) => heard.push(v));
          answer = ctx.call("ping", 7);
          stolen = ctx.call("secret");
        },
      },
    });
    const loader = startModLoader({ client, registry: createBlockRegistry(), importer, log: () => {} });
    await loader.settled();
    expect(await answer).toBe("pong 7");
    await expect(stolen).rejects.toThrow('Mod "pinger" has no channel "secret"');
    tick(42);
    expect(heard).toEqual([42]);
    loader.stop();
    tick(43);
    expect(heard).toEqual([42]);
  });
});
