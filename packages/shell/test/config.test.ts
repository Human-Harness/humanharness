import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigStore, cleanJobs, historyDir } from "../src/main/config";

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

  it("drops a hand-edited language that isn't a canonical tag, keeping the rest", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    for (const bad of ["pt-br", 5]) {
      fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", language: bad }));
      expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x" });
    }
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", language: "pt-BR" }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x", language: "pt-BR" });
  });

  it("D0: a config without a profile never gets one", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/x", language: "es", engineId: "claude" });
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"))).sort()).toEqual(["engineId", "folder", "language"]);
  });

  it("only setProfile changes the active profile; a save never does (profiles spec §4)", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/x" });
    await store.setProfile("sofi");
    await store.save({ profile: "tomas", appearance: "dark" });
    expect(await store.load()).toEqual({ folder: "/x", profile: "sofi", appearance: "dark" });
    await store.setProfile(undefined);
    expect(await store.load()).toEqual({ folder: "/x", appearance: "dark" });
  });

  it("a hand-edited profile that isn't an id is dropped when read", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", profile: "../etc" }));
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/x" });
  });

  it("keeps valid parallel caps and notifyWaiting; drops bad ones (parallel spec §7)", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", parallel: { tasks: 3, jobs: "x" }, notifyWaiting: "yes" }));
    expect(await store.load()).toEqual({ folder: "/x", parallel: { tasks: 3 } });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", parallel: { tasks: 1.5, jobs: null }, notifyWaiting: true }));
    expect(await store.load()).toEqual({ folder: "/x", notifyWaiting: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", parallel: "3" }));
    expect(await store.load()).toEqual({ folder: "/x" });
  });

  it("D0: a config without parallel or notifyWaiting never gets them", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ language: "es" });
    const loaded = await store.load();
    expect("parallel" in loaded).toBe(false);
    expect("notifyWaiting" in loaded).toBe(false);
  });

  it("keeps each job's valid Settings › Jobs entry; drops bad ids, bad values and empty entries (part 3)", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    const jobs = { sync: { off: true, dailyTokens: 5000 }, tidy: { off: "yes", dailyTokens: 0 }, digest: { dailyTokens: 2.5 }, "Bad Id": { off: true }, nightly: { dailyTokens: 100, extra: 1 } };
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", jobs }));
    expect(await store.load()).toEqual({ folder: "/x", jobs: { sync: { off: true, dailyTokens: 5000 }, nightly: { dailyTokens: 100 } } });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", jobs: ["sync"] }));
    expect(await store.load()).toEqual({ folder: "/x" });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ folder: "/x", jobs: { sync: {} } }));
    expect(await store.load()).toEqual({ folder: "/x" });
  });

  it("a saved jobs object replaces the whole entry: turning the last job back on clears it", async () => {
    const store = new ConfigStore(fs.mkdtempSync(path.join(root, "c-")));
    await store.save({ jobs: { sync: { off: true }, tidy: { dailyTokens: 10 } } });
    await store.save({ jobs: { tidy: { dailyTokens: 10 } } });
    expect((await store.load()).jobs).toEqual({ tidy: { dailyTokens: 10 } });
    await store.save({ jobs: {} });
    expect("jobs" in (await store.load())).toBe(false);
  });

  it("D0: a config without jobs never gets them", async () => {
    const store = new ConfigStore(fs.mkdtempSync(path.join(root, "c-")));
    await store.save({ language: "es" });
    expect("jobs" in (await store.load())).toBe(false);
  });

  it("cleanJobs (the save's check): only declared ids, each cleaned; not an object is no change", () => {
    const declared = (id: string) => id === "sync" || id === "tidy";
    expect(cleanJobs({ sync: { off: true, dailyTokens: -1 }, tidy: { off: false }, other: { off: true }, toString: { off: true } }, declared)).toEqual({ sync: { off: true } });
    expect(cleanJobs({}, declared)).toEqual({});
    expect(cleanJobs("x", declared)).toBeUndefined();
    expect(cleanJobs(null, declared)).toBeUndefined();
    expect(cleanJobs([{ off: true }], declared)).toBeUndefined();
    expect(Object.getPrototypeOf(cleanJobs(JSON.parse('{"__proto__":{"off":true}}'), () => true))).toBe(Object.prototype);
  });

  it("setProfile refuses anything that isn't an id", async () => {
    const store = new ConfigStore(fs.mkdtempSync(path.join(root, "c-")));
    await expect(store.setProfile("../x")).rejects.toThrow(/profile/);
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
