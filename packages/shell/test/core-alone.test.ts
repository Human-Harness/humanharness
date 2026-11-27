// The core alone (minimal-core 1a): Sidekick is a core mod, so the shell's main builds its services with no mods, has
// no Sidekick object and imports no Sidekick module.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidekickCollection } from "@humanharness/harness-sdk";
import { DataStore } from "@humanharness/workspace";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() }, dialog: {}, shell: {} }));

const { createAppServices } = await import("../src/main/app-services");
type Deps = Parameters<typeof createAppServices>[0];

const main = path.resolve(import.meta.dirname, "../src/main");

let base: string;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-core-alone-"));
});
afterEach(() => fs.rm(base, { recursive: true, force: true }));

/** The app services' deps with nothing running: no task, no history, no mods. */
function deps(o: Partial<Deps> = {}): Deps {
  const tasks = { isBusy: () => false, chatScope: async () => "_app", trailerNow: async () => undefined, runningTask: async () => null } as unknown as ReturnType<Deps["tasks"]>;
  return {
    harness: () => ({ id: "h", name: "H", actions: {}, data: {} }) as never,
    config: () => ({ load: async () => ({}) }) as never,
    here: main,
    guards: { turnBlocked: () => null } as never,
    quitting: () => false,
    moving: () => null,
    window: () => null,
    tasks: () => tasks,
    jobsHost: () => null,
    profilesCtl: () => null,
    settingsCtl: () => null,
    pluginsCtl: () => null,
    engineIpc: () => null,
    validConfig: async () => ({ folder: base, engineId: "claude" }) as never,
    baseOf: (c) => c.folder,
    scoped: () => false,
    activeScope: async () => false,
    dataStoreFor: (b) => new DataStore(b, {}),
    scopeStoreFor: () => ({ list: async () => [] }) as never,
    scopesView: async () => ({ list: [] }) as never,
    currentHistory: async () => null,
    currentBase: async () => base,
    ownCommits: () => false,
    closeRuntime: async () => {},
    arrivedInProfile: async () => {},
    workReferences: async () => [],
    sendToWindow: () => {},
    ...o,
  };
}

describe("the core alone (minimal-core 1a)", () => {
  it("builds the app services with no mods and no Sidekick object", () => {
    const s = createAppServices(deps());
    expect(Object.keys(s).filter((k) => /sidekick/i.test(k))).toEqual([]);
    // A restore refreshes the settings and search only: nothing of Sidekick's is called.
    expect(() => s.afterRestore()).not.toThrow();
  });

  it("a restore tells the core mods to refresh (Sidekick reads its settings and base again)", () => {
    const refresh = vi.fn(async () => {});
    createAppServices(deps({ modHost: () => ({ refresh }) })).afterRestore();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a commit's paths reach a core mod as `restored(paths)`", () => {
    const restored = vi.fn(async () => {});
    let onCommit: (c: { paths: string[] }) => void = () => {};
    const history = { onCommit: (fn: typeof onCommit) => ((onCommit = fn), () => {}) };
    const s = createAppServices(deps({ modHost: () => ({ refresh: async () => {}, restored }) }));
    s.announceCommits(history as never);
    onCommit({ paths: ["a.md"] });
    expect(restored).toHaveBeenCalledWith(["a.md"]);
  });

  it("a commit reaches a core mod as `historyCommit(paths)` too; a restore alone is no commit", () => {
    const historyCommit = vi.fn(async () => {});
    const sent: unknown[][] = [];
    let onCommit: (c: { paths: string[] }) => void = () => {};
    const history = { onCommit: (fn: typeof onCommit) => ((onCommit = fn), () => {}) };
    const s = createAppServices(deps({ modHost: () => ({ refresh: async () => {}, historyCommit }), sendToWindow: (...a: unknown[]) => void sent.push(a) }));
    s.announceCommits(history as never);
    onCommit({ paths: ["a.md"] });
    expect(historyCommit).toHaveBeenCalledWith(["a.md"]);
    // The window's own push is as before.
    expect(sent).toEqual([["hh:fileCommits", ["a.md"]]]);
    s.afterRestore();
    expect(historyCommit).toHaveBeenCalledTimes(1);
  });

  it("without a mod store, the `sidekick` collection is no collection of the core's", async () => {
    const s = createAppServices(deps());
    await expect(s.personData({ op: "get", collection: "sidekick", key: "settings" }, { scope: "_app" })).rejects.toThrow(/no collection "sidekick"/);
  });

  it("a mod's own store takes its collection's requests; the harness UI never reaches it", async () => {
    const own = new DataStore(base, { sidekick: sidekickCollection() });
    const s = createAppServices(deps({ modStores: { has: (name) => name === "sidekick", storeFor: (b, name) => (b === base && name === "sidekick" ? own : undefined) } }));
    await s.personData({ op: "get", collection: "sidekick", key: "settings" }, { scope: "_app" });
    await expect(s.harnessUiData({ op: "get", collection: "sidekick", key: "settings" }, {})).rejects.toThrow(/no collection "sidekick"/);
  });

  it("the shell's main imports no Sidekick module", async () => {
    const offenders: string[] = [];
    for (const rel of await fs.readdir(main, { recursive: true })) {
      if (!/\.tsx?$/.test(rel)) continue;
      const text = await fs.readFile(path.join(main, rel), "utf8");
      for (const m of text.matchAll(/(?:\bfrom|^import|\bimport\()\s*"([^"\n]+)"/gm)) if (/sidekick/i.test(m[1])) offenders.push(`${rel}: ${m[1]}`);
      // Sidekick's names from the packages that still re-export them (harness-sdk, runtime, workspace).
      for (const m of text.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@humanharness\/[a-z-]+"/gm)) {
        const names = m[1].split(",").map((n) => n.trim().replace(/^type\s+/, ""));
        for (const n of names) if (/sidekick/i.test(n)) offenders.push(`${rel}: ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no Sidekick file is left in the shell's main", async () => {
    const files = (await fs.readdir(main, { recursive: true })).filter((f) => /sidekick/i.test(path.basename(f)));
    expect(files).toEqual([]);
  });
});
