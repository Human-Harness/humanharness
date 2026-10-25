import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { dataServerSpec, devLauncher, openRpc } from "@humanharness/blocks";
import { callMcpTool } from "@humanharness/fake-agent";
import { dataSchema, loadHarness, z } from "@humanharness/harness-sdk";
import { DataError, DataStore, type HistoryTrailer, dataFile } from "@humanharness/workspace";
import { type PersonDataDeps, agentDataRequest, personDataRequests } from "../src/main/data-requests";

const STUDY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "write" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
});

function setup(opts: { blocked?: string; trailer?: HistoryTrailer; open?: string; saveDelay?: number } = {}) {
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
  };
  return { store, run: personDataRequests(deps), commits };
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
    await expect(t.run({ op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined)).rejects.toThrow(/restore/);
    expect(await t.run({ op: "query", collection: "concepts" }, undefined)).toMatchObject({ total: 0 });
    await expect(setup().run({ op: "get", collection: "concepts", key: "a" }, { scope: "../x" })).rejects.toThrow(/scope/);
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
