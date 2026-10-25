import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore, buildDataContext } from "../src";

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
});
