import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FILE_INDEX_NAME, FileIndex, addCommit, emptyIndex } from "../src/file-index";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-index-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const sha = (n: number) => n.toString(16).padStart(40, "0");

describe("FileIndex", () => {
  it("adds a commit to every path it names, oldest first, and moves the head", () => {
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["a.md", "b.md"]);
    addCommit(data, sha(2), ["a.md"]);
    expect(data).toEqual({ version: 1, head: sha(2), paths: { "a.md": [sha(1), sha(2)], "b.md": [sha(1)] } });
  });

  it("a path named __proto__ is an own entry, not the prototype", () => {
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["__proto__"]);
    expect(Object.hasOwn(data.paths, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(data.paths)).toBe(Object.prototype);
    expect(JSON.stringify(data.paths)).toBe(`{"__proto__":["${sha(1)}"]}`);
  });

  it("saves through a temp file in the git data and loads it back", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    expect(await index.load()).toBeNull();
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["a.md"]);
    await index.save(data);
    expect(fs.readdirSync(dir)).toEqual([FILE_INDEX_NAME]);
    expect(await new FileIndex(dir).load()).toEqual(data);
  });

  it("a file that is not an index loads as missing", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    for (const bad of ["{", "[]", '{"version":2,"head":null,"paths":{}}', '{"version":1,"head":5,"paths":{}}', '{"version":1,"head":null,"paths":{"a.md":[1]}}']) {
      fs.writeFileSync(path.join(dir, FILE_INDEX_NAME), bad);
      expect(await new FileIndex(dir).load()).toBeNull();
    }
  });

  it("record(parent, …) only adds when the parent is the head; otherwise it leaves the file for a catch-up", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    await index.record(null, sha(1), ["a.md"]);
    await index.record(sha(1), sha(2), ["a.md"]);
    await index.record(sha(9), sha(3), ["b.md"]);
    expect(await index.load()).toEqual({ version: 1, head: sha(2), paths: { "a.md": [sha(1), sha(2)] } });
    // A missing index is not started from a later commit: the next read rebuilds it.
    const other = new FileIndex(fs.mkdtempSync(path.join(root, "g-")));
    await other.record(sha(1), sha(2), ["a.md"]);
    expect(await other.load()).toBeNull();
  });
});
