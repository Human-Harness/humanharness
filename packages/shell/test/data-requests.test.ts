import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { dataServerSpec, devLauncher, openRpc } from "@humanharness/blocks";
import { callMcpTool } from "@humanharness/fake-agent";
import { SIDEKICK_COLLECTION, dataCollections, dataSchema, loadHarness, settingsSchema, sidekickCollection, z } from "@humanharness/harness-sdk";
import { DataError, DataStore, type HistoryTrailer, dataFile } from "@humanharness/workspace";
import { DataUnavailable, type PersonDataDeps, agentDataRequest, harnessUiDataRequests, personDataRequests, saveAnswerRecords } from "../src/main/data-requests";

const STUDY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "write" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
});

function setup(
  opts: { blocked?: string; trailer?: HistoryTrailer; open?: string; saveDelay?: number; registered?: string[]; storeFor?: PersonDataDeps["storeFor"] } = {},
) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const store = new DataStore(base, data);
  const files = {
    concepts: dataFile(base, opts.open ?? "fracciones", "concepts"),
    profile: dataFile(base, "_app", "profile"),
  };
  /** Each commit, with the data files the folder held when it was saved. */
  const commits: { message: string; trailer?: HistoryTrailer; files: string[] }[] = [];
  const deps: PersonDataDeps = {
    store: async () => store,
    chatScope: async () => opts.open ?? "fracciones",
    trailer: async () => opts.trailer,
    history: async () => ({
      save: async (message, trailer) => {
        if (opts.saveDelay) await new Promise((r) => setTimeout(r, opts.saveDelay));
        const held = Object.entries(files)
          .filter(([, f]) => fs.existsSync(f))
          .map(([name]) => name);
        commits.push({ message, ...(trailer ? { trailer } : {}), files: held });
      },
    }),
    blocked: () => opts.blocked ?? null,
    scopeExists: async (id) => (opts.registered ?? ["fracciones", "decimales"]).includes(id),
    ...(opts.storeFor ? { storeFor: opts.storeFor } : {}),
  };
  return { base, store, run: personDataRequests(deps), commits };
}

describe("personDataRequests", () => {
  it("writes in the open scope and records a Data commit tagged with the open task", async () => {
    const t = setup({ trailer: { task: "t1", action: "study", scope: "fracciones" } });
    await t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined);
    expect(await t.store.get("concepts", "a", { who: "person", scope: "fracciones" })).toEqual({ id: "a", name: "A" });
    expect(t.commits).toEqual([{ message: "Data: concepts", trailer: { task: "t1", action: "study", scope: "fracciones" }, files: ["concepts"] }]);
  });

  it("takes another scope when asked, reads with no commit, and writes read-only collections as the person", async () => {
    const t = setup();
    await t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, { scope: "decimales" });
    expect(await t.store.get("concepts", "a", { who: "person", scope: "decimales" })).not.toBeNull();
    expect(await t.run({ op: "get", collection: "concepts", key: "a" }, { scope: "decimales" })).toMatchObject({ id: "a" });
    await t.run({ op: "put", collection: "profile", record: { name: "Ana" } }, undefined);
    expect(t.commits.map((c) => c.message)).toEqual(["Data: concepts", "Data: profile"]);
    expect(t.commits[0]).not.toHaveProperty("trailer");
  });

  it("refuses writes while turns are blocked, and a bad scope", async () => {
    const t = setup({ blocked: "A restore is running" });
    // A DataUnavailable: its reason is safe to show (the settings tab shows it).
    await expect(t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined)).rejects.toBeInstanceOf(DataUnavailable);
    await expect(t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined)).rejects.toThrow(/restore/);
    expect(await t.run({ op: "query", collection: "concepts" }, undefined)).toMatchObject({ total: 0 });
    await expect(setup().run({ op: "get", collection: "concepts", key: "a" }, { scope: "../x" })).rejects.toThrow(/scope/);
  });

  it("refuses a scope the registry doesn't hold (reads too), with no file and no commit; _app always passes", async () => {
    const t = setup();
    await expect(t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, { scope: "ghost" })).rejects.toThrow("Unknown scope");
    await expect(t.run({ op: "query", collection: "concepts" }, { scope: "ghost" })).rejects.toThrow("Unknown scope");
    expect(fs.existsSync(dataFile(t.base, "ghost", "concepts"))).toBe(false);
    expect(t.commits).toEqual([]);
    await t.run({ op: "put", collection: "profile", record: { name: "Ana" } }, { scope: "_app" });
    expect(t.commits.map((c) => c.message)).toEqual(["Data: profile"]);
    // The open scope is checked too: one archived (or never registered) is refused.
    await expect(setup({ registered: [] }).run({ op: "get", collection: "concepts", key: "a" }, undefined)).rejects.toThrow("Unknown scope");
  });

  it("records no history commit for a refused write, and keeps taking writes after it", async () => {
    const t = setup();
    await expect(t.run({ op: "put", collection: "concepts", record: { id: "a" } }, undefined)).rejects.toThrow();
    expect(t.commits).toEqual([]);
    await t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined);
    expect(t.commits.map((c) => c.message)).toEqual(["Data: concepts"]);
  });

  it("gives two quick writes a commit each, holding only its own file", async () => {
    const t = setup({ saveDelay: 20 });
    await Promise.all([
      t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined),
      t.run({ op: "put", collection: "profile", record: { name: "Ana" } }, undefined),
    ]);
    expect(t.commits).toEqual([
      { message: "Data: concepts", files: ["concepts"] },
      { message: "Data: profile", files: ["concepts", "profile"] },
    ]);
  });
});

describe("harnessUiDataRequests", () => {
  const settings = settingsSchema.parse({
    tab: "Mine",
    fields: { tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone" } },
  });

  function ui(hasSettings: boolean) {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const store = new DataStore(base, dataCollections(hasSettings ? { data, settings } : { data }));
    const commits: string[] = [];
    const person = personDataRequests({
      store: async () => store,
      chatScope: async () => "fracciones",
      trailer: async () => undefined,
      history: async () => ({ save: async (message) => void commits.push(message) }),
      blocked: () => null,
      scopeExists: async (id) => id === "fracciones",
    });
    return { store, person, run: harnessUiDataRequests(person, () => hasSettings), commits };
  }
  const app = { who: "person" as const, scope: "_app" };

  it("refuses the UI's writes to settings, keeps its reads, and lets the settings controller's path write", async () => {
    const t = ui(true);
    for (const request of [
      { op: "put", collection: "settings", record: { tone: "demanding" } },
      { op: "patch", collection: "settings", patch: { tone: "demanding" } },
      { op: "delete", collection: "settings" },
    ]) {
      const err = await t.run(request, { scope: "_app" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DataError);
      expect((err as Error).message).toBe("Settings change through client.settings");
    }
    expect(await t.store.get("settings", undefined, app)).toBeNull();
    expect(t.commits).toEqual([]);
    // The controller writes through the person's handler itself (index.ts: `personData(request, { scope: APP_SCOPE })`).
    await t.person({ op: "put", collection: "settings", record: { tone: "demanding" } }, { scope: "_app" });
    expect(await t.run({ op: "get", collection: "settings" }, { scope: "_app" })).toEqual({ tone: "demanding" });
    expect(await t.run({ op: "query", collection: "settings" }, { scope: "_app" })).toMatchObject({ total: 1 });
    // Other collections are untouched.
    await t.run({ op: "put", collection: "profile", record: { name: "Ana" } }, undefined);
    expect(t.commits).toEqual(["Data: settings", "Data: profile"]);
  });

  it("without harness settings, a write to settings fails as an unknown collection, as before (D0)", async () => {
    const t = ui(false);
    const err = await t.run({ op: "put", collection: "settings", record: { tone: "demanding" } }, { scope: "_app" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).code).toBe("unknown-collection");
  });
});

describe("saveAnswerRecords", () => {
  it("writes all the records as the person in the given scope, or none with the store's refusal", async () => {
    const t = setup();
    const store = async () => t.store;
    await saveAnswerRecords(store, "concepts", [{ id: "a", name: "A" }, { id: "b", name: "B" }], "fracciones");
    expect(await t.store.query("concepts", {}, { who: "person", scope: "fracciones" })).toMatchObject({ total: 2 });
    const refused = saveAnswerRecords(store, "concepts", [{ id: "c", name: "C" }, { id: "d" }], "fracciones");
    await expect(refused).rejects.toBeInstanceOf(DataError);
    expect(await t.store.get("concepts", "c", { who: "person", scope: "fracciones" })).toBeNull();
    await expect(saveAnswerRecords(async () => null, "concepts", [], "fracciones")).rejects.toThrow("The app is not set up yet");
  });

  it("tells the person nothing about any other failure", async () => {
    const broken = { putMany: () => Promise.reject(new Error("EACCES: /Users/someone/secret/.harness/data")) } as unknown as DataStore;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = saveAnswerRecords(async () => broken, "concepts", [{ id: "a", name: "A" }], "fracciones");
      await expect(failure).rejects.toThrow("Something went wrong with the data");
      await expect(failure).rejects.not.toThrow(/secret/);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("agentDataRequest", () => {
  it("runs as the agent in the running task's scope, with the task's action", async () => {
    const t = setup();
    const deps = { store: async () => t.store, runningTask: async () => ({ id: "t1", action: "study", scope: "fracciones" }) };
    await agentDataRequest(deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } });
    expect(await t.store.get("concepts", "a", { who: "person", scope: "fracciones" })).toEqual({ id: "a", name: "A" });
    await expect(agentDataRequest(deps, { op: "put", collection: "profile", record: { name: "Ana" } })).rejects.toMatchObject({ code: "refused" });
    // A free question with no scope open runs in `_app`: a scoped collection is refused.
    await expect(agentDataRequest({ ...deps, runningTask: async () => ({ id: "t2", scope: "_app" }) }, { op: "query", collection: "concepts" })).rejects.toMatchObject({ code: "no-scope" });
    await expect(agentDataRequest({ ...deps, runningTask: async () => null }, { op: "query", collection: "concepts" })).rejects.toThrow(/No task/);
  });

  it("tells the agent a refusal's reason but nothing about any other failure", async () => {
    const t = setup();
    const broken = { get: () => Promise.reject(new Error("EACCES: /Users/someone/secret/.harness/data")) } as unknown as DataStore;
    const deps = { store: async () => broken, runningTask: async () => ({ id: "t1", scope: "fracciones" }) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = agentDataRequest(deps, { op: "get", collection: "concepts", key: "a" });
      await expect(failure).rejects.toThrow("Something went wrong with the data");
      await expect(failure).rejects.not.toThrow(/secret/);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
    await expect(agentDataRequest({ ...deps, store: async () => t.store }, { op: "nope" })).rejects.toBeInstanceOf(DataError);
  });

  it("hides the failures of looking up the task or the store too", async () => {
    const t = setup();
    const leak = async (): Promise<never> => {
      throw new Error("ENOENT: /Users/someone/secret/.harness/tasks.json");
    };
    const deps = { store: async () => t.store, runningTask: async () => ({ id: "t1", scope: "fracciones" }) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const broken of [{ ...deps, runningTask: leak }, { ...deps, store: leak }]) {
        const failure = agentDataRequest(broken, { op: "query", collection: "concepts" });
        await expect(failure).rejects.toThrow("Something went wrong with the data");
        await expect(failure).rejects.not.toThrow(/secret/);
      }
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
    await expect(agentDataRequest({ ...deps, store: async () => null }, { op: "query", collection: "concepts" })).rejects.toThrow("The app is not set up yet");
  });

  it("sends a plugin collection (`<id>.<collection>`) to the plugin route, never a harness one (plugins spec §3.2)", async () => {
    const t = setup();
    const seen: unknown[] = [];
    const deps = {
      store: async () => t.store,
      runningTask: async () => ({ id: "t1", scope: "fracciones" }),
      plugin: async (request: unknown) => (seen.push(request), { records: [], total: 0 }),
    };
    expect(await agentDataRequest(deps, { op: "query", collection: "oncall.queues" })).toEqual({ records: [], total: 0 });
    expect(seen).toEqual([{ op: "query", collection: "oncall.queues" }]);
    await agentDataRequest(deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } });
    expect(seen).toHaveLength(1);
    // The route's refusals reach the agent as today's.
    const refusing = { ...deps, plugin: async () => Promise.reject(new DataError("refused", "The agent may not change plugin data: it is read-only")) };
    await expect(agentDataRequest(refusing, { op: "put", collection: "oncall.queues", record: {} })).rejects.toMatchObject({ code: "refused" });
    // Still only while a task runs.
    await expect(agentDataRequest({ ...deps, runningTask: async () => null }, { op: "query", collection: "oncall.queues" })).rejects.toThrow(/No task/);
    expect(seen).toHaveLength(1);
  });

  it("D0: without a plugin route a dotted name is an unknown collection, as today", async () => {
    const t = setup();
    const deps = { store: async () => t.store, runningTask: async () => ({ id: "t1", scope: "fracciones" }) };
    await expect(agentDataRequest(deps, { op: "query", collection: "oncall.queues" })).rejects.toMatchObject({ code: "unknown-collection" });
  });

  it("gives a store refusal back to the agent as the data tool's error", { timeout: 30_000 }, async () => {
    const study = await loadHarness(STUDY);
    const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), study.data);
    const rpc = await openRpc((request) => agentDataRequest({ store: async () => store, runningTask: async () => ({ id: "t1", scope: "fracciones" }) }, request));
    try {
      const server = dataServerSpec({ harnessConfig: study.configPath, rpc, launcher: devLauncher() });
      const record = { id: "halves", name: "Halves", state: "seen", evidence: [] };
      expect((await callMcpTool(server, "data_put", { collection: "concepts", record })).isError).toBeFalsy();
      const refused = await callMcpTool(server, "data_patch", { collection: "concepts", key: "halves", patch: { state: "mastered" } });
      expect(refused.isError).toBe(true);
      expect((refused.content as { text: string }[])[0].text).toBe("Refused: The state can rise only with a new evidence entry");
    } finally {
      await rpc.close();
    }
  });
});

describe("storeFor (sidekick spec §6.4)", () => {
  it("routes a collection to its own store and records the write as the person's", async () => {
    let own: DataStore | null = null;
    const t = setup({ storeFor: (c) => (c === SIDEKICK_COLLECTION ? Promise.resolve(own) : undefined) });
    own = new DataStore(t.base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
    await t.run({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: "settings", type: "settings", on: true } }, { scope: "_app" });
    expect(await own.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: "_app" })).toMatchObject({ on: true });
    expect(t.commits.map((c) => c.message)).toEqual(["Data: sidekick"]);
  });

  it("D0: without storeFor a sidekick request reaches the harness store (unknown collection)", async () => {
    const t = setup();
    await expect(t.run({ op: "get", collection: SIDEKICK_COLLECTION, key: "settings" }, { scope: "_app" })).rejects.toThrow(/no collection/);
  });

  it("the harness UI never reaches the sidekick collection", async () => {
    const ui = harnessUiDataRequests(async () => "reached", () => false);
    await expect(ui({ op: "get", collection: SIDEKICK_COLLECTION, key: "settings" }, {})).rejects.toThrow(/no collection "sidekick"/);
    await expect(ui({ op: "query", collection: "notes" }, {})).resolves.toBe("reached");
  });
});
