import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ScopeStore, migrateToScopes, readNotes, writeNote } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterEach(() => vi.restoreAllMocks());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));
const at = () => new Date("2026-10-25T10:00:00.000Z");
const note = { title: "T", summary: ["s"], decisions: [], files: [], open: [] };
const meta = { date: "2026-10-20T10:00:00.000Z", engine: "claude" };
const chat = (base: string) => {
  fs.mkdirSync(path.join(base, ".harness", "chats"), { recursive: true });
  fs.writeFileSync(path.join(base, ".harness", "chats", "main.jsonl"), '{"id":"1"}\n');
};

describe("migrateToScopes", () => {
  it("moves the flat notes into main and registers main last; the chat stays main's", async () => {
    const base = tmp();
    await writeNote(base, "manifest", note, meta);
    await writeNote(base, "q-hello", note, meta);
    chat(base);
    expect(await migrateToScopes(base, at)).toBe(true);
    expect(await readNotes(base)).toEqual([]);
    expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.slug).sort()).toEqual(["manifest", "q-hello"]);
    expect(fs.readFileSync(path.join(base, ".harness", "chats", "main.jsonl"), "utf8")).toBe('{"id":"1"}\n');
    expect(await new ScopeStore(base).list()).toEqual([{ id: "main", title: "General", createdAt: "2026-10-25T10:00:00.000Z", archived: false }]);
    // Done once: the registry is the marker.
    expect(await migrateToScopes(base, at)).toBe(false);
  });

  it("migrates a folder that has only a chat", async () => {
    const base = tmp();
    chat(base);
    expect(await migrateToScopes(base, at)).toBe(true);
    expect((await new ScopeStore(base).list()).map((s) => s.id)).toEqual(["main"]);
  });

  it("does nothing in a fresh folder, or one with only tasks.json", async () => {
    const base = tmp();
    expect(await migrateToScopes(base, at)).toBe(false);
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(base, ".harness", "tasks.json"), '{"version":1,"current":null,"actions":{}}');
    expect(await migrateToScopes(base, at)).toBe(false);
    expect(fs.existsSync(path.join(base, ".harness", "scopes.json"))).toBe(false);
  });

  it("finishes a migration a crash cut short", async () => {
    const base = tmp();
    await writeNote(base, "a", note, meta);
    await writeNote(base, "b", note, meta, ".harness/notes/main/");
    expect(await migrateToScopes(base, at)).toBe(true);
    expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.slug).sort()).toEqual(["a", "b"]);
  });

  it("never overwrites a note already in main; the flat one stays", async () => {
    const base = tmp();
    await writeNote(base, "a", { ...note, title: "flat" }, meta);
    await writeNote(base, "a", { ...note, title: "in main" }, meta, ".harness/notes/main/");
    expect(await migrateToScopes(base, at)).toBe(true);
    expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.title)).toEqual(["in main"]);
    expect((await readNotes(base)).map((n) => n.title)).toEqual(["flat"]);
  });

  describe("on a filesystem without hard links", () => {
    const noLinks = (code: string) =>
      vi.spyOn(fs.promises, "link").mockRejectedValue(Object.assign(new Error(code), { code }));

    it.each(["ENOTSUP", "EPERM", "ENOSYS", "EMLINK"])("copies then removes the flat note (%s)", async (code) => {
      const base = tmp();
      await writeNote(base, "a", note, meta);
      noLinks(code);
      expect(await migrateToScopes(base, at)).toBe(true);
      expect(await readNotes(base)).toEqual([]);
      expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.slug)).toEqual(["a"]);
    });

    it("still never overwrites a note already in main", async () => {
      const base = tmp();
      await writeNote(base, "a", { ...note, title: "flat" }, meta);
      await writeNote(base, "a", { ...note, title: "in main" }, meta, ".harness/notes/main/");
      noLinks("ENOTSUP");
      expect(await migrateToScopes(base, at)).toBe(true);
      expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.title)).toEqual(["in main"]);
      expect((await readNotes(base)).map((n) => n.title)).toEqual(["flat"]);
    });
  });
});
