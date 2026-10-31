import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { declarationStamp } from "@humanharness/search";
import { sourceStamp } from "../src/main/search/stamp";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-search-stamp-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const DECL = { key: "id", single: false, search: { title: "title" } };

describe("sourceStamp (search spec D4)", () => {
  it("names each file missing, then follows each one: the records file and the meta file apart", async () => {
    const data = path.join(dir, "items.json");
    const meta = path.join(dir, ".meta", "items.json");
    const none = await sourceStamp([data, meta], DECL);
    expect(none).toBe(`none|none#${declarationStamp(DECL)}`);
    await fs.writeFile(data, "[]\n");
    const one = await sourceStamp([data, meta], DECL);
    expect(one).not.toBe(none);
    await fs.mkdir(path.dirname(meta), { recursive: true });
    await fs.writeFile(meta, "{}\n");
    const two = await sourceStamp([data, meta], DECL);
    expect(two).not.toBe(one);
    expect(two.split("#")[0].split("|")[0]).toBe(one.split("#")[0].split("|")[0]);
  });

  it("changes with the declaration alone", async () => {
    const file = path.join(dir, "items.json");
    await fs.writeFile(file, "[]\n");
    expect(await sourceStamp([file], DECL)).not.toBe(await sourceStamp([file], { ...DECL, search: { title: "name" } }));
  });
});
