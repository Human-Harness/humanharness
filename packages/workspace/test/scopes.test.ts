import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LINKED_MANY_MAX } from "@humanharness/harness-sdk";
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

describe("ScopeStore links (hatches spec §3.2)", () => {
  const file = (base: string) => path.join(base, ".harness", "scopes.json");

  it("D0: an entry without links is written exactly as before", async () => {
    const base = tmp();
    const store = new ScopeStore(base, at);
    await store.create("Fracciones");
    expect(fs.readFileSync(file(base), "utf8")).toBe(
      `${JSON.stringify([{ id: "fracciones", title: "Fracciones", createdAt: "2026-10-25T10:00:00.000Z", archived: false }], null, 2)}\n`,
    );
  });

  it("links, lists and unlinks; unlinking the last link removes the key", async () => {
    const base = tmp();
    const store = new ScopeStore(base, at);
    await store.create("App");
    const e = { key: "repos", path: "/Users/me/code/app", mode: "write" as const, tracked: false };
    await store.link("app", e);
    expect((await store.list())[0].linked).toEqual([e]);
    await store.unlink("app", "repos", "/Users/me/code/app");
    expect("linked" in (await store.list())[0]).toBe(false);
    expect(fs.readFileSync(file(base), "utf8")).not.toContain("linked");
  });

  it("keeps the links through rename and archive", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    const e = { key: "repos", path: "/a", mode: "read" as const, tracked: false };
    await store.link("app", e);
    await store.rename("app", "App two");
    await store.setArchived("app", true);
    expect((await store.list())[0]).toMatchObject({ title: "App two", archived: true, linked: [e] });
  });

  it("refuses the same path twice in one scope, and an unknown scope", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    const e = { key: "repos", path: "/a", mode: "write" as const, tracked: true };
    await store.link("app", e);
    await expect(store.link("app", { ...e, key: "other" })).rejects.toThrow(/already linked/);
    await expect(store.link("nope", e)).rejects.toThrow(/Unknown scope/);
  });

  it("takes one folder under a key, or LINKED_MANY_MAX when the key is many", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    const e = (n: number) => ({ key: "repos", path: `/r${n}`, mode: "write" as const, tracked: false });
    await store.link("app", e(0));
    await expect(store.link("app", e(1))).rejects.toThrow(/at most 1 linked folder$/);
    await store.link("app", { ...e(1), key: "constructor" });
    for (let n = 2; n <= LINKED_MANY_MAX; n++) await store.link("app", e(n), { many: true });
    await expect(store.link("app", e(99), { many: true })).rejects.toThrow(/at most 16 linked folders/);
    const linked = (await store.list())[0].linked ?? [];
    expect(linked.filter((l) => l.key === "repos")).toHaveLength(LINKED_MANY_MAX);
    expect(linked.filter((l) => l.key === "constructor")).toEqual([{ ...e(1), key: "constructor" }]);
  });

  it("refuses an invalid link and an unknown linked folder", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    expect(() => store.link("app", { key: "repos", path: "relative", mode: "write", tracked: false })).toThrow(/Invalid linked folder/);
    await expect(store.setTracked("app", "repos", "/a", true)).rejects.toThrow(/Unknown linked folder/);
  });

  it("setTracked flips tracked and clears gitChanged; markGitChanged sets it", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    await store.link("app", { key: "repos", path: "/a", mode: "write", tracked: true });
    await store.markGitChanged("app", "repos", "/a");
    expect((await store.list())[0].linked?.[0].gitChanged).toBe(true);
    await store.setTracked("app", "repos", "/a", false);
    expect((await store.list())[0].linked?.[0]).toEqual({ key: "repos", path: "/a", mode: "write", tracked: false });
  });

  it("keeps a link's tag; one that is too long or no string is dropped, the link kept", async () => {
    const base = tmp();
    const store = new ScopeStore(base, at);
    await store.create("App");
    await store.link("app", { key: "repos", path: "/a", mode: "write", tracked: true, tag: "f".repeat(64) });
    await store.markGitChanged("app", "repos", "/a");
    expect((await store.list())[0].linked).toEqual([{ key: "repos", path: "/a", mode: "write", tracked: true, gitChanged: true, tag: "f".repeat(64) }]);
    const raw = JSON.parse(fs.readFileSync(file(base), "utf8"));
    raw[0].linked.push({ key: "repos", path: "/b", mode: "read", tracked: false, tag: "x".repeat(129) }, { key: "repos", path: "/c", mode: "read", tracked: false, tag: 7 });
    fs.writeFileSync(file(base), JSON.stringify(raw));
    expect((await store.list())[0].linked?.slice(1)).toEqual([
      { key: "repos", path: "/b", mode: "read", tracked: false },
      { key: "repos", path: "/c", mode: "read", tracked: false },
    ]);
  });

  it("setTracked takes the new tag, or leaves the link untagged", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    await store.link("app", { key: "repos", path: "/a", mode: "write", tracked: true, tag: "old" });
    await store.setTracked("app", "repos", "/a", false, "new");
    expect((await store.list())[0].linked?.[0]).toEqual({ key: "repos", path: "/a", mode: "write", tracked: false, tag: "new" });
    await store.setTracked("app", "repos", "/a", true);
    expect((await store.list())[0].linked?.[0]).toEqual({ key: "repos", path: "/a", mode: "write", tracked: true });
  });

  it("link with valid drops the scope's links it rejects before counting, in the same write", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    await store.link("app", { key: "repos", path: "/forged", mode: "write", tracked: false });
    const signed = { key: "repos", path: "/a", mode: "write" as const, tracked: false, tag: "ok" };
    await store.link("app", signed, { valid: (l) => l.tag === "ok" });
    expect((await store.list())[0].linked).toEqual([signed]);
  });

  it("drops a hand-edited link entry that isn't valid, keeping the scope", async () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(
      file(base),
      JSON.stringify([
        {
          id: "app",
          title: "App",
          createdAt: "",
          archived: false,
          linked: [
            { key: "repos", path: "relative", mode: "write", tracked: false },
            { key: "Bad", path: "/b", mode: "x", tracked: 1 },
            { key: "repos", path: "/ok", mode: "read", tracked: false },
            { key: "other", path: "/ok", mode: "write", tracked: true },
          ],
        },
      ]),
    );
    const [s] = await new ScopeStore(base, at).list();
    expect(s.linked).toEqual([{ key: "repos", path: "/ok", mode: "read", tracked: false }]);
  });
});
