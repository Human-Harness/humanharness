import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigStore } from "../src/main/config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ConfigStore", () => {
  it("starts empty and merges patches to disk", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    expect(await store.load()).toEqual({});
    await store.save({ language: "es" });
    await store.save({ folder: "/x", engineId: "claude" });
    expect(await new ConfigStore(dir).load()).toEqual({ language: "es", folder: "/x", engineId: "claude" });
  });

  it("never changes the folder once set", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/first" });
    await store.save({ folder: "/second" });
    expect((await store.load()).folder).toBe("/first");
  });

  it("survives a corrupt file", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    fs.writeFileSync(path.join(dir, "config.json"), "{nope");
    expect(await new ConfigStore(dir).load()).toEqual({});
  });
});
