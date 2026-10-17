import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigStore, historyDir } from "../src/main/config";

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

  it("keeps both fields of two overlapping saves", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await Promise.all([store.save({ language: "es" }), store.save({ engineId: "claude" })]);
    expect(await new ConfigStore(dir).load()).toEqual({ language: "es", engineId: "claude" });
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("replaces the folder only through replaceFolder, keeping everything else", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/first", language: "es", backupDismissed: true });
    expect(await store.replaceFolder("/second")).toEqual({ folder: "/second", language: "es", backupDismissed: true });
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/second", language: "es", backupDismissed: true });
    await store.save({ folder: "/third" });
    expect((await store.load()).folder).toBe("/second");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("drops a hand-edited backupDismissed that isn't a boolean, keeping the rest", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", language: "es", backupDismissed: "yes" }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x", language: "es" });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", backupDismissed: false }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x", backupDismissed: false });
  });

  it("drops a hand-edited text size it doesn't know, keeping the rest", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", textSize: "huge" }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x" });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", textSize: "larger" }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x", textSize: "larger" });
  });
});

describe("historyDir", () => {
  it("gives each folder its own gitdir under userData/history", () => {
    const a = historyDir("/data", "/Users/ana/A");
    expect(a).toMatch(/^\/data\/history\/[0-9a-f]{16}$/);
    expect(historyDir("/data", "/Users/ana/A")).toBe(a);
    expect(historyDir("/data", "/Users/ana/B")).not.toBe(a);
  });
});
