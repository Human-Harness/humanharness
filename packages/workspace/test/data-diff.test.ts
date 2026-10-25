import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DATA_PREFIX, History, NOTES_PREFIX, dataDiffOf, diffCollection } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

describe("diffCollection", () => {
  it("finds records added, changed and removed by key", () => {
    const before = json([{ id: "a", s: 1 }, { id: "b", s: 1 }]);
    const after = json([{ id: "b", s: 2 }, { id: "c", s: 1 }]);
    expect(diffCollection(before, after, "id")).toEqual({
      added: [{ id: "c", s: 1 }],
      changed: [{ before: { id: "b", s: 1 }, after: { id: "b", s: 2 } }],
      removed: [{ id: "a", s: 1 }],
    });
  });

  it("treats a missing or broken file as empty, and a single record by itself", () => {
    expect(diffCollection(null, json([{ id: "a" }]), "id").added).toEqual([{ id: "a" }]);
    expect(diffCollection("{nope", null, "id")).toEqual({ added: [], changed: [], removed: [] });
    expect(diffCollection(json({ name: "Ana" }), json({ name: "Ana B" }), undefined).changed).toEqual([{ before: { name: "Ana" }, after: { name: "Ana B" } }]);
    expect(diffCollection(json({ b: 1, a: 2 }), json({ a: 2, b: 1 }), undefined).changed).toEqual([]);
  });
});

describe("dataDiffOf", () => {
  it("reads a task's data changes from the history, per collection and scope", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const folder = path.join(dir, "Work");
    const file = path.join(folder, ".harness", "data", "fracciones", "concepts.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json([{ id: "a", state: "seen" }]));
    const history = new History(folder, path.join(dir, "git"), [".harness/"], [NOTES_PREFIX, DATA_PREFIX]);
    await history.init();
    await history.save("Start");
    fs.writeFileSync(file, json([{ id: "a", state: "mastered" }, { id: "b", state: "seen" }]));
    await history.save("Turn: study", { task: "t1", action: "study", scope: "fracciones" });
    const data = dataSchema.parse({ concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), state: z.string() }), agent: "write" } });
    expect(await dataDiffOf(history, "t1", data)).toEqual([
      {
        collection: "concepts",
        scope: "fracciones",
        added: [{ id: "b", state: "seen" }],
        changed: [{ before: { id: "a", state: "seen" }, after: { id: "a", state: "mastered" } }],
        removed: [],
      },
    ]);
    expect(await dataDiffOf(history, "nope", data)).toEqual([]);
    expect(await history.readFileAt(null, ".harness/data/fracciones/concepts.json")).toBeNull();
  });
});
