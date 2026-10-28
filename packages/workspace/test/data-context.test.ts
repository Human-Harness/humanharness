import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore, buildDataContext, buildDataContextParts, estimateTokens } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const concept = z.object({ id: z.string(), name: z.string(), state: z.string(), notes: z.string() });
const person = { who: "person" as const, scope: "fracciones" };

function setup(extra: Record<string, unknown> = {}) {
  let t = 0;
  const data = dataSchema.parse({
    concepts: { scoped: true, key: "id", schema: concept, agent: "write", context: { fields: ["name", "state"], tokens: 120 }, ...extra },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string(), level: z.string() }), agent: "read", context: { fields: "all", tokens: 100 } },
    secrets: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "none" },
    cards: { scoped: true, key: "id", schema: z.object({ id: z.string() }), agent: "read" },
  });
  const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), data, { now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, t++)) });
  return { store, data };
}

describe("buildDataContext", () => {
  it("is empty with no data, so the first message is unchanged (D2)", async () => {
    const { store, data } = setup();
    expect(await buildDataContext(store, data, "fracciones", "study")).toBe("");
    expect(await buildDataContext(store, {}, "main", undefined)).toBe("");
  });

  it("writes one table per collection with context, key first, the most recently changed first", async () => {
    const { store, data } = setup();
    await store.put("profile", { name: "Ana", level: "6th grade" }, person);
    await store.put("concepts", { id: "a", name: "Halves", state: "seen", notes: "x" }, person);
    await store.put("concepts", { id: "b", name: "Thirds | sixths", state: "unseen", notes: "y" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toBe(
      [
        "## Data: concepts",
        "",
        "| id | name | state |",
        "|---|---|---|",
        "| b | Thirds \\| sixths | unseen |",
        "| a | Halves | seen |",
        "",
        "## Data: profile",
        "",
        "| name | level |",
        "|---|---|",
        "| Ana | 6th grade |",
      ].join("\n"),
    );
  });

  it("cuts a table at its tokens and says how many rows are left out", async () => {
    const { store, data } = setup();
    for (let i = 0; i < 40; i++) await store.put("concepts", { id: `c${String(i).padStart(2, "0")}`, name: `Concept number ${i}`, state: "seen", notes: "" }, person);
    const text = await buildDataContext(store, data, "fracciones", "study");
    const rows = text.split("\n").filter((l) => l.startsWith("| c"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
    expect(text).toContain(`… ${40 - rows.length} more in concepts: use data_query to read them.`);
  });

  it("follows the harness's order, and skips scoped collections outside a scope", async () => {
    const { store, data } = setup({ context: { fields: ["name"], tokens: 400, order: (records: { name: string }[], ctx: { action?: string }) => [...records].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ ...r, name: `${r.name} (${ctx.action})` })) } });
    await store.put("concepts", { id: "b", name: "B", state: "seen", notes: "" }, person);
    await store.put("concepts", { id: "a", name: "A", state: "seen", notes: "" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toContain("| a | A (study) |\n| b | B (study) |");
    expect(await buildDataContext(store, data, "_app", undefined)).toBe("");
  });

  it("keeps a table and its footer within the tokens, even when one row alone is too long", async () => {
    const { store, data } = setup({ context: { fields: "all", tokens: 50 } });
    for (const id of ["a", "b", "c"]) await store.put("concepts", { id, name: "N".repeat(300), state: "S".repeat(300), notes: "T".repeat(300) }, person);
    const text = (await buildDataContext(store, data, "fracciones", "study")).split("\n\n## Data: profile")[0]!;
    expect(estimateTokens(text)).toBeLessThanOrEqual(50);
    expect(text).toContain("more in concepts");
    expect(text.split("\n").filter((l) => l.startsWith("| c") || l.startsWith("| a") || l.startsWith("| b")).length).toBe(1);
  });

  it("keeps the other tables when the order throws or returns no list", async () => {
    for (const order of [() => { throw new Error("boom"); }, () => "nope"]) {
      const { store, data } = setup({ context: { fields: ["name"], tokens: 400, order } });
      await store.put("profile", { name: "Ana", level: "6th grade" }, person);
      await store.put("concepts", { id: "a", name: "A", state: "seen", notes: "" }, person);
      await store.put("concepts", { id: "b", name: "B", state: "seen", notes: "" }, person);
      const text = await buildDataContext(store, data, "fracciones", "study");
      expect(text).toContain("| b | B |\n| a | A |");
      expect(text).toContain("## Data: profile");
    }
  });

  it("counts the records the order left out as left out", async () => {
    const { store, data } = setup({ context: { fields: ["name"], tokens: 400, order: (r: { id: string }[]) => r.filter((x) => x.id === "a") } });
    for (const id of ["a", "b", "c"]) await store.put("concepts", { id, name: id, state: "seen", notes: "" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toContain("… 2 more in concepts");
  });

  it("flattens lone carriage returns and escapes backslashes before pipes", async () => {
    const { store, data } = setup({ context: { fields: ["name"], tokens: 400 } });
    await store.put("concepts", { id: "a", name: "x\r\ny\rz a\\b\\|c", state: "", notes: "" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toContain("| a | x y z a\\\\b\\\\\\|c |");
  });
});

describe("buildDataContextParts (context-panel spec §3.1)", () => {
  it("one part per collection with the rows it loaded; joined, they are buildDataContext", async () => {
    const { store, data } = setup();
    await store.put("concepts", { id: "c1", name: "Halves", state: "new", notes: "" }, person);
    await store.put("concepts", { id: "c2", name: "Thirds", state: "new", notes: "" }, person);
    await store.put("profile", { name: "Ana", level: "6" }, person);
    const parts = await buildDataContextParts(store, data, "fracciones", "study");
    expect(parts.map((p) => [p.collection, p.rows])).toEqual([
      ["concepts", 2],
      ["profile", 1],
    ]);
    expect(parts.map((p) => p.text).join("\n\n")).toBe(await buildDataContext(store, data, "fracciones", "study"));
  });

  it("D0: no part without data", async () => {
    const { store, data } = setup();
    expect(await buildDataContextParts(store, data, "fracciones", "study")).toEqual([]);
  });
});
