import { promises as fs } from "node:fs";
import path from "node:path";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoreMods } from "../../src/main/mods/bundle";
import { createCoreEvents } from "../../src/main/mods/core-events";
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

/** A core mod that records what it hears. */
function listener(h: ModHost, id = "ear") {
  const heard: unknown[][] = [];
  h.registerForTest(
    id,
    "Ear",
    (c) => {
      const on = (c as CoreMainCtx<unknown>).on;
      on.dataChanged((x) => void heard.push(["dataChanged", x]));
      on.restored((p) => void heard.push(["restored", p]));
      on.baseGone((b) => void heard.push(["baseGone", b]));
      on.close(() => void heard.push(["close"]));
    },
    { core: true },
  );
  return heard;
}

describe("the events a core mod hears", () => {
  it("dataChanged, restored(paths) and baseGone(base) reach a core mod, through the core's events", async () => {
    const h = await host();
    const heard = listener(h);
    const events = createCoreEvents({ host: () => h });
    events.dataChanged("notes");
    events.dataChanged(null);
    events.restored(["a.md", "b/c.md"]);
    events.restored(null);
    await events.baseGone("/old/base");
    await new Promise((r) => setTimeout(r, 10));
    expect(heard).toEqual([["dataChanged", { collection: "notes" }], ["dataChanged", { collection: null }], ["restored", ["a.md", "b/c.md"]], ["restored", null], ["baseGone", "/old/base"]]);
  });

  it("close is heard before quit, as the host stops", async () => {
    const h = await host();
    const heard = listener(h);
    await h.stop();
    expect(heard).toEqual([["close"]]);
  });

  it("only a core mod has them; a mod that is off hears nothing", async () => {
    const h = await host();
    let local: unknown;
    h.registerForTest("plain", "Plain", (c) => void (local = c.on));
    const on = local as Record<string, unknown>;
    expect([on.dataChanged, on.restored, on.baseGone]).toEqual([undefined, undefined, undefined]);
    expect(h.registered("dataChanged")).toBe(false);
    const heard = listener(h);
    expect(h.registered("dataChanged")).toBe(true);
    h.registerForTest("silent", "Silent", () => {}, { core: true });
    await h.dataChanged("x");
    expect(heard).toEqual([["dataChanged", { collection: "x" }]]);
  });

  it("a throwing listener counts a strike and the others still hear", async () => {
    const h = await host();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.registerForTest("bad", "Bad", (c) => (c as CoreMainCtx<unknown>).on.baseGone(() => Promise.reject(new Error("boom"))), { core: true });
    const heard = listener(h);
    await h.baseGone("b");
    expect(heard).toEqual([["baseGone", "b"]]);
  });
});

describe("the core's own events", () => {
  it("the shell's services subscribe and unsubscribe; a throwing one never reaches the caller", async () => {
    const events = createCoreEvents({ host: () => null });
    const seen: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    events.on.dataChanged(() => {
      throw new Error("boom");
    });
    const off = events.on.dataChanged((c) => void seen.push(c));
    events.on.restored((p) => void seen.push(p));
    const gone = vi.fn(async () => {});
    events.on.baseGone(gone);
    const closing = vi.fn(async () => {});
    events.on.closing(closing);
    events.dataChanged("c");
    events.restored(["p"]);
    await events.baseGone("/b");
    await events.closing();
    off();
    events.dataChanged("again");
    expect(seen).toEqual(["c", ["p"]]);
    expect(gone).toHaveBeenCalledWith("/b");
    expect(closing).toHaveBeenCalledTimes(1);
  });

  it("with no host, the events still reach the shell's listeners", async () => {
    const events = createCoreEvents({ host: () => null });
    await expect(events.baseGone("/b")).resolves.toBeUndefined();
    expect(() => events.dataChanged(null)).not.toThrow();
  });
});

describe("a core mod's worker entry and its imports", () => {
  let tmp: string;
  // Inside the package, so `@humanharness/search` resolves as it does for a mod under packages/mods.
  const base = path.resolve(import.meta.dirname, "..", ".core-events-fixtures");
  beforeEach(async () => {
    await fs.mkdir(base, { recursive: true });
    tmp = await fs.mkdtemp(path.join(base, "f-"));
  });
  afterEach(() => fs.rm(base, { recursive: true, force: true }));

  async function fixture(id: string, files: Record<string, string>) {
    for (const [rel, text] of Object.entries(files)) {
      const file = path.join(tmp, "mods", id, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    }
  }
  const json = (id: string) => JSON.stringify({ id, name: id, version: "0.1.0", apiVersion: 1, main: "main.js" });
  const pkg = (...deps: string[]) => JSON.stringify({ name: "x", dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"])) });

  it("emits worker.js beside main.js when the mod has src/worker.ts", async () => {
    await fixture("indexer", {
      "mod.json": json("indexer"),
      "package.json": pkg("@humanharness/mod-sdk"),
      "src/main.ts": "export default {};\n",
      "src/worker.ts": "import { parentPort } from 'node:worker_threads';\nparentPort?.postMessage('ready');\n",
    });
    const dest = path.join(tmp, "out");
    await buildCoreMods(path.join(tmp, "mods"), dest, ["indexer"]);
    const worker = await fs.readFile(path.join(dest, "indexer", "worker.js"), "utf8");
    expect(worker).toContain("worker_threads");
    expect(await fs.stat(path.join(dest, "indexer", "main.js"))).toBeTruthy();
  });

  it("a mod without a worker emits none; a worker that imports something undeclared fails the build", async () => {
    await fixture("plain", { "mod.json": json("plain"), "src/main.ts": "export default {};\n" });
    await fixture("bad", { "mod.json": json("bad"), "src/main.ts": "export default {};\n", "src/worker.ts": "import 'undeclared';\n" });
    const dest = path.join(tmp, "out");
    await buildCoreMods(path.join(tmp, "mods"), dest, ["plain"]);
    expect(await fs.stat(path.join(dest, "plain", "worker.js")).catch(() => null)).toBeNull();
    await expect(buildCoreMods(path.join(tmp, "mods"), dest, ["bad"])).rejects.toThrow(/core mod "bad".*undeclared can't be imported by a core mod/s);
  });

  it("a core mod's main and worker may import @humanharness/search when its package.json declares it", async () => {
    const files = (deps: string[]) => ({
      "mod.json": json("finder"),
      "package.json": pkg(...deps),
      "src/main.ts": "import { actionDocs } from '@humanharness/search';\nexport default { id: 'finder', main() { void actionDocs; } };\n",
      "src/worker.ts": "import { actionDocs } from '@humanharness/search';\nvoid actionDocs;\n",
    });
    await fixture("finder", files(["@humanharness/mod-sdk", "@humanharness/search"]));
    const dest = path.join(tmp, "out");
    await buildCoreMods(path.join(tmp, "mods"), dest, ["finder"]);
    for (const f of ["main.js", "worker.js"]) expect((await fs.stat(path.join(dest, "finder", f))).size).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(dest, "finder", "main.js"), "utf8")).not.toMatch(/from\s+["']@humanharness\/search/);

    await fixture("nodecl", { ...files(["@humanharness/mod-sdk"]), "mod.json": json("nodecl") });
    await expect(buildCoreMods(path.join(tmp, "mods"), dest, ["nodecl"])).rejects.toThrow(/@humanharness\/search can't be imported by a core mod/);
  });
});
