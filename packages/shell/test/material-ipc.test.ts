import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { LINK_MAX_ITEMS } from "@humanharness/material/light";
import { DATA_PREFIX, DataStore, MATERIAL_KEEP, NOTES_PREFIX } from "@humanharness/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyKeep, materialAppState, materialItems, materialRecommended, openMaterial } from "../src/main/material-ipc";

const material = { accepts: ["text", "pdf"] as ("text" | "pdf")[], grounding: { default: "mixed" as const, personCanChange: true } };

describe("D0: a harness without material", () => {
  it("keeps today's history keep list; with material the registry is kept too", () => {
    expect(historyKeep({})).toEqual([NOTES_PREFIX, DATA_PREFIX]);
    expect(historyKeep({ material })).toEqual([NOTES_PREFIX, DATA_PREFIX, MATERIAL_KEEP]);
  });
  it("adds no `material` key to AppState", () => {
    const state = { name: "x", ...materialAppState({}) };
    expect(Object.hasOwn(state, "material")).toBe(false);
    expect(materialAppState({ material })).toEqual({ material: { accepts: ["text", "pdf"], items: false, grounding: { default: "mixed", personCanChange: true }, maxPages: 300 } });
    expect(materialAppState({ material: { ...material, items: { collection: "concepts", label: "name" } } }).material?.items).toBe(true);
  });
  it("recommends a tier per material stage (Settings › Models); links only with items, overrides kept", () => {
    expect(materialRecommended({ tiers: {} })).toEqual({ "material-review": "standard", "material-repair": "light", "material-label": "light", "material-sheet": "light" });
    expect(materialRecommended({ tiers: { review: "deep" }, items: { collection: "concepts", label: "name" } })).toEqual({
      "material-review": "deep",
      "material-repair": "light",
      "material-label": "light",
      "material-sheet": "light",
      "material-link": "standard",
    });
  });
});

describe("openMaterial (hh:materialOpen)", () => {
  const opened: string[] = [];
  const open = async (file: string) => {
    opened.push(file);
    return file.endsWith("broken.pdf") ? "No app" : "";
  };
  const svc = { originalOf: async (_scope: unknown, id: unknown) => (id === "ch2" ? "/b/material/main/ch2.pdf" : id === "bad" ? "/b/material/main/broken.pdf" : null) };
  it("without material: not-ready; an unknown id: unknown-source; otherwise opened", async () => {
    expect(await openMaterial(null, "main", "ch2", open)).toEqual({ ok: false, reason: "not-ready" });
    expect(await openMaterial(svc, "main", "nope", open)).toEqual({ ok: false, reason: "unknown-source" });
    expect(await openMaterial(svc, "main", "ch2", open)).toEqual({ ok: true });
    expect(await openMaterial(svc, "main", "bad", open)).toEqual({ ok: false, reason: "invalid" });
    expect(opened).toEqual(["/b/material/main/ch2.pdf", "/b/material/main/broken.pdf"]);
  });
});

describe("materialItems (the links stage's items, material spec §8)", () => {
  const data = dataSchema.parse({
    concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string().optional() }), agent: "write" },
    terms: { scoped: false, key: "n", schema: z.object({ n: z.number(), name: z.unknown().optional() }), agent: "read" },
    hidden: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "none" },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
  });
  const person = { who: "person" as const, scope: "fractions" };
  let root: string;
  let store: DataStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-items-"));
    store = new DataStore(root, data);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const read = (collection: string, scope = "fractions") => materialItems({ collection, label: "name" }, data, async () => store, scope);

  it("a scoped collection: the scope's records, the label cut to 200 characters, the key without one", async () => {
    await store.put("concepts", { id: "halves", name: "Halves" }, person);
    await store.put("concepts", { id: "long", name: "x".repeat(300) }, person);
    await store.put("concepts", { id: "nameless" }, person);
    await store.put("concepts", { id: "other" }, { ...person, scope: "decimals" });
    const items = await read("concepts");
    expect(items.map((i) => i.key)).toEqual(["halves", "long", "nameless"]);
    expect(items[0].label).toBe("Halves");
    expect(items[1].label).toHaveLength(200);
    expect(items[2].label).toBe("nameless");
  });

  it("an app-wide collection: the same records in every scope; a label that isn't text falls back to the key", async () => {
    await store.put("terms", { n: 1, name: "One" }, person);
    await store.put("terms", { n: 2, name: { not: "text" } }, person);
    expect(await read("terms", "decimals")).toEqual([{ key: "1", label: "One" }, { key: "2", label: "2" }]);
  });

  it("at most LINK_MAX_ITEMS", async () => {
    for (let i = 0; i < LINK_MAX_ITEMS + 5; i++) await store.put("terms", { n: i, name: `T${i}` }, person);
    expect(await read("terms")).toHaveLength(LINK_MAX_ITEMS);
  });

  it("nothing for a hidden collection, one with no key, an unknown one, no store yet, or a read that fails", async () => {
    await store.put("hidden", { id: "a", name: "Secret" }, person);
    expect(await read("hidden")).toEqual([]);
    expect(await read("profile")).toEqual([]);
    expect(await read("nope")).toEqual([]);
    expect(await materialItems(undefined, data, async () => store, "fractions")).toEqual([]);
    expect(await materialItems({ collection: "concepts", label: "name" }, data, async () => null, "fractions")).toEqual([]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = async () => {
      throw new Error("no config");
    };
    expect(await materialItems({ collection: "concepts", label: "name" }, data, failing, "fractions")).toEqual([]);
    // A scoped collection asked from `_app` throws in the store: still nothing, never a throw.
    expect(await read("concepts", "_app")).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});
