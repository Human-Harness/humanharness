import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexStore, type Snapshot, searchDir } from "../src/main/search/store";

let userData: string;
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-store-data-"));
});
afterEach(() => fs.rmSync(userData, { recursive: true, force: true }));

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ index: '{"x":1}', files: {}, chats: {}, memory: [], truncated: false, ...o });

describe("IndexStore data meta (search spec D4)", () => {
  it("round-trips each source's stamp and ids", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    const data = { "harness:_app/people": { stamp: "10:20", ids: ["data:harness:_app/people#a"] } };
    store.schedule(() => snap({ data }));
    await store.flush();
    expect(await store.load()).toEqual(snap({ data }));
  });

  it("a snapshot without data loads without it; a bad data shape throws the snapshot away", async () => {
    const store = new IndexStore(searchDir(userData, "/w/a"));
    store.schedule(() => snap());
    await store.flush();
    expect(await store.load()).not.toHaveProperty("data");
    const file = path.join(store.dir, "files.json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...meta, data: { x: { stamp: 1, ids: "no" } } }));
    expect(await store.load()).toBeNull();
  });
});
