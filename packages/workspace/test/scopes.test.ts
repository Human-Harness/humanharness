import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ScopeStore, cleanTitle, scopeSlug } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));
const at = () => new Date("2026-10-25T10:00:00.000Z");

describe("scopeSlug", () => {
  it("slugs the title and numbers it when taken", () => {
    expect(scopeSlug("Fracciones", new Set())).toBe("fracciones");
    expect(scopeSlug("Fracciones", new Set(["fracciones"]))).toBe("fracciones-2");
    expect(scopeSlug("Fracciones", new Set(["fracciones", "fracciones-2"]))).toBe("fracciones-3");
    expect(scopeSlug("¿Qué es π?", new Set())).toBe("que-es");
    expect(scopeSlug("!!!", new Set())).toBe("scope");
    expect(scopeSlug("a".repeat(100), new Set())).toHaveLength(56);
  });

  it("keeps a title to one line of at most 120 characters", () => {
    expect(cleanTitle("  Dos\n líneas ")).toBe("Dos líneas");
    expect(() => cleanTitle("   ")).toThrow(/title/);
    expect(() => cleanTitle("x".repeat(121))).toThrow(/title/);
    expect(() => cleanTitle(3)).toThrow(/title/);
  });
});

describe("ScopeStore", () => {
  it("creates, renames and archives scopes; the id never changes", async () => {
    const store = new ScopeStore(tmp(), at);
    expect(await store.exists()).toBe(false);
    expect(await store.list()).toEqual([]);
    const a = await store.create("Fracciones");
    const b = await store.create("Fracciones");
    expect([a.id, b.id]).toEqual(["fracciones", "fracciones-2"]);
    expect(a).toEqual({ id: "fracciones", title: "Fracciones", createdAt: "2026-10-25T10:00:00.000Z", archived: false });
    expect(await store.rename("fracciones", "Fracciones y decimales")).toMatchObject({ id: "fracciones", title: "Fracciones y decimales" });
    await store.setArchived("fracciones-2", true);
    expect((await store.list()).map((s) => [s.id, s.archived])).toEqual([
      ["fracciones", false],
      ["fracciones-2", true],
    ]);
    expect(await store.exists()).toBe(true);
    await expect(store.rename("nope", "x")).rejects.toThrow(/Unknown scope/);
  });

  it("adds an entry with a given id once", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.add({ id: "main", title: "General", createdAt: "c", archived: false });
    await store.add({ id: "main", title: "Other", createdAt: "c", archived: false });
    expect(await store.list()).toEqual([{ id: "main", title: "General", createdAt: "c", archived: false }]);
  });

  it("keeps creates in order when they race", async () => {
    const store = new ScopeStore(tmp(), at);
    const made = await Promise.all([store.create("X"), store.create("X"), store.create("X")]);
    expect(made.map((s) => s.id)).toEqual(["x", "x-2", "x-3"]);
  });

  it("sets a broken registry aside and skips bad entries", async () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(base, ".harness", "scopes.json"), "{not json");
    const store = new ScopeStore(base, at);
    expect(await store.list()).toEqual([]);
    expect(fs.readdirSync(path.join(base, ".harness")).some((f) => f.startsWith("scopes.json.corrupt-"))).toBe(true);
    fs.writeFileSync(
      path.join(base, ".harness", "scopes.json"),
      JSON.stringify([{ id: "ok", title: "Ok", createdAt: "c", archived: false }, { id: "../x", title: "Bad" }, { id: "_app", title: "App" }, "x"]),
    );
    expect((await store.list()).map((s) => s.id)).toEqual(["ok"]);
  });
});
