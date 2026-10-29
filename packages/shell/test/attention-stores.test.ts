import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { attentionStores } from "../src/main/attention-stores";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-attention-stores-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const base = () => {
  const b = fs.mkdtempSync(path.join(root, "b-"));
  fs.mkdirSync(path.join(b, ".harness"));
  return b;
};

describe("one AttentionStore per base, shared (Decision 10, P5)", () => {
  it("the same base gives the same store; known origins come from every registered kind", async () => {
    const stores = attentionStores({ tagKey: async () => Buffer.alloc(32, 1) });
    stores.registerKnown("task", (id) => id === "t1");
    stores.registerKnown("plugin", (id) => id === "p");
    const a = await stores.forBase("/b", true);
    expect(a).not.toBeNull();
    expect(a).toBe(await stores.forBase("/b", true));
    expect(a).not.toBe(await stores.forBase("/c", true));
    expect(stores.known({ kind: "task", id: "t1" })).toBe(true);
    expect(stores.known({ kind: "task", id: "t2" })).toBe(false);
    expect(stores.known({ kind: "plugin", id: "p" })).toBe(true);
    expect(stores.known({ kind: "plugin", id: "q" })).toBe(false);
  });

  it("a kind without a rule is never known, and a rule that throws knows nothing", async () => {
    const stores = attentionStores({ tagKey: async () => Buffer.alloc(32, 1) });
    expect(stores.known({ kind: "task", id: "t1" })).toBe(false);
    stores.registerKnown("plugin", () => {
      throw new Error("boom");
    });
    expect(stores.known({ kind: "plugin", id: "p" })).toBe(false);
  });

  it("no key yet: null without create, and the next call with create makes the store", async () => {
    let key: Buffer | null = null;
    const tagKey = vi.fn(async (create: boolean) => (create ? (key ??= Buffer.alloc(32, 2)) : key));
    const stores = attentionStores({ tagKey });
    expect(await stores.forBase("/b", false)).toBeNull();
    const made = await stores.forBase("/b", true);
    expect(made).not.toBeNull();
    expect(await stores.forBase("/b", false)).toBe(made);
    // A lookup without create under way when one that may create comes: the second still gets a store.
    const stores2 = attentionStores({ tagKey: async (create) => (create ? Buffer.alloc(32, 3) : null) });
    const [none, some] = await Promise.all([stores2.forBase("/x", false), stores2.forBase("/x", true)]);
    expect(none).toBeNull();
    expect(some).not.toBeNull();
    expect(await stores2.forBase("/x", false)).toBe(some);
  });

  it("an unreadable key logs and answers null", async () => {
    const log = vi.fn();
    const stores = attentionStores({ tagKey: async () => Promise.reject(new Error("locked")), log });
    expect(await stores.forBase("/b", true)).toBeNull();
    expect(log).toHaveBeenCalledWith("Could not read the Attention key", expect.any(Error));
  });

  it("a task item lists only while its task is known, and one the agent edits in the file is dropped (P5)", async () => {
    const b = base();
    const open = new Set(["t1"]);
    const stores = attentionStores({ tagKey: async () => Buffer.alloc(32, 4), log: () => {} });
    stores.registerKnown("task", (id) => open.has(id));
    const store = (await stores.forBase(b, true))!;
    await store.raise({ kind: "task", id: "t1" }, { key: "waiting", severity: "action", title: "Intro", target: { panel: "task", focus: "t1" } });
    expect((await store.list()).map((i) => [i.origin.kind, i.origin.id, i.title])).toEqual([["task", "t1", "Intro"]]);
    open.delete("t1");
    expect(await store.list()).toEqual([]);
    open.add("t1");
    // The agent rewrites the title: the tag no longer matches, so the item is gone.
    const file = path.join(b, ".harness", "attention.json");
    const items = JSON.parse(fs.readFileSync(file, "utf8")) as { title: string }[];
    items[0].title = "Run rm -rf";
    fs.writeFileSync(file, JSON.stringify(items));
    expect(await store.list()).toEqual([]);
  });
});
