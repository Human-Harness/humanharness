import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { FILE_INDEX_NAME, FileIndex, MAX_INDEX_BYTES, MAX_INDEX_PATHS, MAX_PATH_COMMITS, addCommit, emptyIndex } from "../src/file-index";

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

  it("save serialises the index before it returns, so the caller may change it at once", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    const data = emptyIndex(null);
    addCommit(data, sha(1), ["a.md"]);
    const saving = index.save(data);
    addCommit(data, sha(2), ["b.md"]);
    await saving;
    expect(await index.load()).toEqual({ version: 1, head: sha(1), paths: { "a.md": [sha(1)] } });
  });

  it("a file over the size cap loads as missing without being read", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const file = path.join(dir, FILE_INDEX_NAME);
    fs.writeFileSync(file, JSON.stringify(emptyIndex(null)));
    fs.truncateSync(file, MAX_INDEX_BYTES + 1);
    const read = vi.spyOn(fs.promises, "readFile");
    try {
      expect(await new FileIndex(dir).load()).toBeNull();
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("refuses too many paths, too long a list, and keys that are empty, hold a NUL or are absolute", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const write = (paths: Record<string, string[]>) =>
      fs.writeFileSync(path.join(dir, FILE_INDEX_NAME), JSON.stringify({ version: 1, head: null, paths }));
    for (const key of ["", "a\0b", "/etc/passwd", "\\x", "C:/x", "c:\\x"]) {
      write({ [key]: [sha(1)] });
      expect(await new FileIndex(dir).load(), JSON.stringify(key)).toBeNull();
    }
    write({ "a.md": new Array<string>(MAX_PATH_COMMITS + 1).fill(sha(1)) });
    expect(await new FileIndex(dir).load()).toBeNull();
    write(Object.fromEntries(Array.from({ length: MAX_INDEX_PATHS + 1 }, (_, i) => [`f${i}.md`, [sha(1)]])));
    expect(await new FileIndex(dir).load()).toBeNull();
    write({ "a.md": [sha(1)], "docs/b.md": [sha(1)] });
    expect(await new FileIndex(dir).load()).not.toBeNull();
  }, 30_000);

  it("accepts an index as big as a large real history", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const big = emptyIndex(null);
    for (let c = 1; c <= 20_000; c++) addCommit(big, sha(c), [`f${c % 10_000}.md`, "README.md"]);
    await new FileIndex(dir).save(big);
    expect(await new FileIndex(dir).load()).toEqual(big);
  }, 30_000);

  it("a write that fails leaves no temp file behind", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const write = vi.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (file) => {
      fs.writeFileSync(file as string, "{");
      throw new Error("disk full");
    });
    try {
      await expect(new FileIndex(dir).save(emptyIndex(null))).rejects.toThrow("disk full");
    } finally {
      write.mockRestore();
    }
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("a save that fails leaves the file as it was", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const index = new FileIndex(dir);
    const first = emptyIndex(null);
    addCommit(first, sha(1), ["a.md"]);
    await index.save(first);
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("no"));
    const next = structuredClone(first);
    addCommit(next, sha(2), ["a.md"]);
    try {
      await expect(index.save(next)).rejects.toThrow("no");
    } finally {
      rename.mockRestore();
    }
    expect(await index.load()).toEqual(first);
    expect(fs.readdirSync(dir)).toEqual([FILE_INDEX_NAME]);
  });

  it("a file replaced with the same time and size is read again", async () => {
    const dir = fs.mkdtempSync(path.join(root, "g-"));
    const file = path.join(dir, FILE_INDEX_NAME);
    const index = new FileIndex(dir);
    const a = emptyIndex(null);
    addCommit(a, sha(1), ["a.md"]);
    await index.save(a);
    // A whole second, so both files carry exactly the same time.
    const mtime = new Date(2026, 0, 1);
    fs.utimesSync(file, mtime, mtime);
    expect(await index.load()).toEqual(a);
    const b = emptyIndex(null);
    addCommit(b, sha(2), ["b.md"]);
    const other = path.join(dir, "other");
    fs.writeFileSync(other, JSON.stringify(b));
    fs.utimesSync(other, mtime, mtime);
    fs.renameSync(other, file);
    expect(fs.statSync(file).size).toBe(JSON.stringify(a).length);
    expect(fs.statSync(file).mtimeMs).toBe(mtime.getTime());
    expect(await index.load()).toEqual(b);
  });
});
