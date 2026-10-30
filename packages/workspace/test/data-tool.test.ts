import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type RulesContext, dataSchema, z } from "@humanharness/harness-sdk";
import { type DataChange, DataStore } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const card = z.object({ id: z.string(), title: z.string() });

/** A store whose `cards` rules record what they were given, and every change event. */
function setup(agent: "write" | "read" | "none" = "write") {
  const seen: Omit<RulesContext, "records">[] = [];
  const data = dataSchema.parse({
    cards: {
      scoped: true,
      key: "id",
      schema: card,
      agent,
      rules: (_next: unknown, _prev: unknown, ctx: RulesContext) => {
        const { records: _r, ...rest } = ctx;
        seen.push(rest);
        return true;
      },
    },
  });
  const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), data);
  const changes: DataChange[] = [];
  store.onChange((c) => void changes.push(c));
  return { store, seen, changes };
}

describe("who: tool (tools spec §8.3)", () => {
  it("a tool's write reaches rules with who: tool and its id", async () => {
    const t = setup();
    await t.store.put("cards", { id: "a", title: "A" }, { who: "tool", tool: "apply-triage", scope: "main" });
    await t.store.patch("cards", "a", { title: "B" }, { who: "tool", tool: "apply-triage", scope: "main" });
    await t.store.delete("cards", "a", { who: "tool", tool: "apply-triage", scope: "main" });
    expect(t.seen).toEqual([
      { scope: "main", who: "tool", tool: "apply-triage" },
      { scope: "main", who: "tool", tool: "apply-triage" },
      { scope: "main", who: "tool", tool: "apply-triage" },
    ]);
  });

  it("each change event names the tool", async () => {
    const t = setup();
    await t.store.put("cards", { id: "a", title: "A" }, { who: "tool", tool: "apply-triage", scope: "main" });
    await t.store.delete("cards", "a", { who: "tool", tool: "apply-triage", scope: "main" });
    expect(t.changes).toEqual([
      { collection: "cards", scope: "main", who: "tool", tool: "apply-triage", op: "put", key: "a" },
      { collection: "cards", scope: "main", who: "tool", tool: "apply-triage", op: "delete", key: "a" },
    ]);
  });

  it("a collection with agent: none is still readable and writable by a tool that declares it", async () => {
    const t = setup("none");
    const ctx = { who: "tool" as const, tool: "apply-triage", scope: "main" };
    await t.store.put("cards", { id: "a", title: "A" }, ctx);
    expect(await t.store.get("cards", "a", ctx)).toEqual({ id: "a", title: "A" });
    await expect(t.store.get("cards", "a", { who: "agent", scope: "main" })).rejects.toMatchObject({ code: "refused" });
  });

  it("a tool id given with another writer is not passed on", async () => {
    const t = setup();
    await t.store.put("cards", { id: "a", title: "A" }, { who: "person", tool: "forged", scope: "main" });
    expect(t.seen).toEqual([{ scope: "main", who: "person" }]);
    expect(t.changes[0]).not.toHaveProperty("tool");
  });

  it("D0: who stays agent/person/app without a tool", async () => {
    const t = setup();
    await t.store.put("cards", { id: "a", title: "A" }, { who: "agent", scope: "main", action: "triage" });
    await t.store.put("cards", { id: "b", title: "B" }, { who: "person", scope: "main" });
    await t.store.put("cards", { id: "c", title: "C" }, { who: "app", scope: "main" });
    expect(t.seen).toEqual([
      { action: "triage", scope: "main", who: "agent" },
      { scope: "main", who: "person" },
      { scope: "main", who: "app" },
    ]);
    for (const s of t.seen) expect(s).not.toHaveProperty("tool");
    expect(t.changes).toEqual([
      { collection: "cards", scope: "main", who: "agent", op: "put", key: "a" },
      { collection: "cards", scope: "main", who: "person", op: "put", key: "b" },
      { collection: "cards", scope: "main", who: "app", op: "put", key: "c" },
    ]);
  });
});
