import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveIndex } from "@humanharness/search";
import { type BuildMessage, build } from "../src/main/search/build";
import { IndexStore, type Snapshot, searchDir } from "../src/main/search/store";

let userData: string;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-store-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(userData, { recursive: true, force: true });
});

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ index: '{"x":1}', files: { "folder/a.md": { size: 1, mtimeMs: 2, how: "text" } }, chats: {}, memory: ["action:a"], truncated: false, ...o });

describe("IndexStore (§4.1)", () => {
  it("lives under <userData>/search, one folder per base", () => {
    expect(path.dirname(searchDir(userData, "/w/a"))).toBe(path.join(userData, "search"));
    expect(searchDir(userData, "/w/a")).not.toBe(searchDir(userData, "/w/b"));
  });

  it("writes atomically with 0600 and reads back", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    store.schedule(() => snap());
    await store.flush();
    for (const f of ["index.json", "files.json"]) expect(fs.statSync(path.join(store.dir, f)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(store.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(await store.load()).toEqual(snap());
  });

  it("is a cache: a missing, broken or older snapshot loads as null", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    expect(await store.load()).toBeNull();
    store.schedule(() => snap());
    await store.flush();
    fs.writeFileSync(path.join(store.dir, "files.json"), "{broken");
    expect(await store.load()).toBeNull();
    fs.writeFileSync(path.join(store.dir, "files.json"), JSON.stringify({ version: 0, files: {}, chats: {}, memory: [] }));
    expect(await store.load()).toBeNull();
    fs.writeFileSync(path.join(store.dir, "files.json"), JSON.stringify({ version: 1, files: { a: { size: "x" } }, chats: {}, memory: [] }));
    expect(await store.load()).toBeNull();
  });

  it("writes at most every 5 s while changes come in", async () => {
    vi.useFakeTimers();
    const store = new IndexStore(searchDir(userData, "/w/a"));
    const get = vi.fn(() => snap());
    store.schedule(get);
    store.schedule(get);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await store.flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps the recents and the scopes toggle; discard removes the folder", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    expect(await store.prefs()).toEqual({ recent: [], allScopes: false });
    await store.savePrefs({ recent: ["note:x"], allScopes: true });
    expect(await store.prefs()).toEqual({ recent: ["note:x"], allScopes: true });
    expect(fs.statSync(path.join(store.dir, "prefs.json")).mode & 0o777).toBe(0o600);
    await store.discard();
    expect(fs.existsSync(store.dir)).toBe(false);
  });
  it("the snapshot on disk never holds a skipped secret file's text, nor a note's token line (§8.2)", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-store-folder-"));
    try {
      const token = `ghp_${"B".repeat(36)}`;
      fs.writeFileSync(path.join(folder, "keys.txt"), `${token}\nsecretneighbourword`);
      fs.mkdirSync(path.join(folder, ".harness/notes"), { recursive: true });
      fs.writeFileSync(path.join(folder, ".harness/notes/n.md"), `# Note\nkeptword\n${token}`);
      const live = LiveIndex.empty();
      let files: Snapshot["files"] = {};
      await build({ roots: [{ key: "folder", path: folder }], scoped: false, known: {}, chats: {} }, (m: BuildMessage) => {
        if (m.type === "names" || m.type === "docs") live.upsert(m.docs);
        if (m.type === "removed") live.remove(m.ids);
        if (m.type === "done") files = m.files;
      });
      expect(files["folder/keys.txt"].how).toBe("skipped:secret-shaped");
      const store = new IndexStore(searchDir(userData, folder));
      store.schedule(() => snap({ index: live.toJSON(), files, memory: [] }));
      await store.flush();
      const disk = fs.readdirSync(store.dir).map((f) => fs.readFileSync(path.join(store.dir, f), "utf8")).join("\n");
      expect(disk).toContain("keptword");
      expect(disk).not.toContain("secretneighbourword");
      expect(disk).not.toContain("ghp_");
      expect(disk.toLowerCase()).not.toContain("bbbbbbbbbbbbbbbb");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
