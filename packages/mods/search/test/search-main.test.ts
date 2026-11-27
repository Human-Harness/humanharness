import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionSchema, z } from "@humanharness/harness-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import mod from "../src/main";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-main-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const collections = {
  people: collectionSchema.parse({ scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string() }), search: { title: "id" } }),
  plain: collectionSchema.parse({ scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string() }) }),
};

function fakeCtx() {
  const handled = new Map<string, (...a: unknown[]) => unknown>();
  const on: Record<string, (...a: never[]) => unknown> = {};
  const hook = (name: string) => (fn: (...a: never[]) => unknown) => ((on[name] = fn), () => {});
  const store = { readAll: vi.fn(async () => ({ records: [] })), changedAt: vi.fn(async () => 0) };
  const search = {
    userData: () => path.join(tmp, "userData"),
    openScope: async () => null,
    scopeTitles: async () => new Map<string, string>(),
    references: async () => [],
    tasks: async () => ({ actions: [], open: null, past: [] }),
    extraDenied: async () => [],
    reveal: async () => true,
    collections: () => collections,
    scopes: async () => [],
    store: () => store,
    plugins: () => null,
  };
  const ctx = {
    id: "search",
    push: vi.fn(),
    ipc: (name: string, fn: (args: unknown) => unknown) => (handled.set(name, fn), () => {}),
    on: { dataChanged: hook("dataChanged"), restored: hook("restored"), baseGone: hook("baseGone"), close: hook("close") },
    app: { setup: async () => ({ engineId: "e", base: tmp }), context: { scoped: () => false }, search },
  };
  return { ctx: ctx as unknown as CoreMainCtx, handled, on };
}

describe("the search core mod's main", () => {
  it("answers query and opened as its own ipc (args as an array), as data", async () => {
    const t = fakeCtx();
    await mod.main?.(t.ctx as never);
    expect([...t.handled.keys()].sort()).toEqual(["opened", "query"]);
    // Nothing is built until the window asks (D0, D8); an open for a hit that does not exist is data, not a throw.
    expect(await t.handled.get("opened")?.([{}])).toEqual(expect.objectContaining({ ok: false }));
  });

  it("hears dataChanged, restored, baseGone and close", async () => {
    const t = fakeCtx();
    await mod.main?.(t.ctx as never);
    expect(Object.keys(t.on).sort()).toEqual(["baseGone", "close", "dataChanged", "restored"]);
    // None of them throws with no live index yet (nothing was asked).
    await t.on.dataChanged({ collection: "people" } as never);
    await t.on.dataChanged({ collection: "plain" } as never);
    await t.on.dataChanged({ collection: null } as never);
    await t.on.restored(null as never);
    await t.on.baseGone("/x" as never);
    await t.on.close();
  });

  it("does nothing without the app's parts (a harness's or a local mod's ctx)", async () => {
    const t = fakeCtx();
    const bare = { ...t.ctx, app: undefined } as unknown as CoreMainCtx;
    await mod.main?.(bare as never);
    expect(t.handled.size).toBe(0);
  });
});
