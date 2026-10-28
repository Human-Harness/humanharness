import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { migrateChats } from "../src/main/chat-migration";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-cmig-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const line = (text: string) => JSON.stringify({ id: text, role: "user", text, blocks: [], activities: [], at: "2026-10-28T10:00:00Z" }) + "\n";

/** A base with `.harness/chats/` holding `files` (name → content). */
function baseWith(files: Record<string, string>): { base: string; chats: string } {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  const chats = path.join(base, ".harness", "chats");
  fs.mkdirSync(chats, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(chats, name), content);
  return { base, chats };
}

const archived = (chats: string): string[] => fs.readdirSync(path.join(chats, "archive")).map((n) => fs.readFileSync(path.join(chats, "archive", n), "utf8"));

describe("migrateChats (Decision 8, P6)", () => {
  it("the scope's chat becomes its open task's chat; the old file is archived", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a") + line("b"), "s1.jsonl": line("c") });
    const moved = await migrateChats(base, [{ scope: "main", task: "t1" }]);
    expect(moved).toEqual({ copied: ["main"], archived: ["main", "s1"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a") + line("b"));
    expect(fs.existsSync(path.join(chats, "main.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(chats, "s1.jsonl"))).toBe(false);
    expect(archived(chats).sort()).toEqual([line("a") + line("b"), line("c")].sort());
    expect(fs.readdirSync(path.join(chats, "main"))).toEqual(["t1.jsonl"]);
  });

  it("runs once: a second call does nothing, even to a scope file written since", async () => {
    const { base, chats } = baseWith({});
    expect(await migrateChats(base, [])).toEqual({ copied: [], archived: [] });
    fs.writeFileSync(path.join(chats, "main.jsonl"), line("later"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: [], archived: [] });
    expect(fs.readFileSync(path.join(chats, "main.jsonl"), "utf8")).toBe(line("later"));
    expect(fs.existsSync(path.join(chats, "main"))).toBe(false);
  });

  it("works without a chats folder", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: [], archived: [] });
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: [], archived: [] });
  });

  it("a failed copy leaves the old file where it was, and the next start finishes", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a"), main: "a file where the folder should be" });
    await expect(migrateChats(base, [{ scope: "main", task: "t1" }])).rejects.toThrow();
    expect(fs.readFileSync(path.join(chats, "main.jsonl"), "utf8")).toBe(line("a"));
    expect(fs.existsSync(path.join(chats, "archive"))).toBe(false);
    fs.rmSync(path.join(chats, "main"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: ["main"], archived: ["main"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a"));
  });

  it("interrupted after the copy: the next start archives without copying twice", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a") + line("b") });
    fs.mkdirSync(path.join(chats, "main"));
    fs.writeFileSync(path.join(chats, "main", "t1.jsonl"), line("a") + line("b"));
    fs.writeFileSync(path.join(chats, "main", "t1.jsonl.0123.tmp"), line("a"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: ["main"], archived: ["main"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a") + line("b"));
    expect(archived(chats)).toEqual([line("a") + line("b")]);
  });

  it("interrupted after archiving some scopes: the next start does the rest only", async () => {
    const { base, chats } = baseWith({ "s1.jsonl": line("c") });
    fs.mkdirSync(path.join(chats, "archive"));
    fs.writeFileSync(path.join(chats, "archive", "2026-10-28T10-00-00-000Z-parallel.jsonl"), line("a"));
    fs.mkdirSync(path.join(chats, "main"));
    fs.writeFileSync(path.join(chats, "main", "t1.jsonl"), line("a"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }, { scope: "s1", task: "t2" }])).toEqual({ copied: ["s1"], archived: ["s1"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a"));
    expect(fs.readFileSync(path.join(chats, "s1", "t2.jsonl"), "utf8")).toBe(line("c"));
    expect(archived(chats).sort()).toEqual([line("a"), line("c")].sort());
  });

  it("a task chat that already holds the start of the scope's chat gets the rest, once", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a") + line("b") });
    fs.mkdirSync(path.join(chats, "main"));
    fs.writeFileSync(path.join(chats, "main", "t1.jsonl"), line("a"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: ["main"], archived: ["main"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a") + line("b"));
  });

  it("a task chat with lines of its own is kept as it is; the scope's chat is only archived", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a") });
    fs.mkdirSync(path.join(chats, "main"));
    fs.writeFileSync(path.join(chats, "main", "t1.jsonl"), line("z"));
    expect(await migrateChats(base, [{ scope: "main", task: "t1" }])).toEqual({ copied: [], archived: ["main"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("z"));
    expect(archived(chats)).toEqual([line("a")]);
  });

  it("refuses a bad task id before touching anything", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a"), "s1.jsonl": line("c") });
    await expect(migrateChats(base, [{ scope: "s1", task: "t2" }, { scope: "main", task: "../x" }])).rejects.toThrow(/task/);
    expect(fs.readdirSync(chats).sort()).toEqual(["main.jsonl", "s1.jsonl"]);
  });

  it("never copies through a symlinked scope folder; the old file stays", async () => {
    const { base, chats } = baseWith({ "main.jsonl": line("a") });
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.symlinkSync(outside, path.join(chats, "main"));
    await expect(migrateChats(base, [{ scope: "main", task: "t1" }])).rejects.toThrow(/outside/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.readFileSync(path.join(chats, "main.jsonl"), "utf8")).toBe(line("a"));
  });

  it("leaves files that are not a scope's chat alone", async () => {
    const { base, chats } = baseWith({ "notes.txt": "x", "Bad Name.jsonl": line("x") });
    expect(await migrateChats(base, [])).toEqual({ copied: [], archived: [] });
    expect(fs.readdirSync(chats).sort()).toEqual([".per-task", "Bad Name.jsonl", "notes.txt"]);
  });
});
