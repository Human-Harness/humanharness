import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HomeHistory, changeMessage } from "../src/main/mods/home-history";

let root: string;
let home: string;
let gitdir: string;
let h: HomeHistory | null = null;
async function put(rel: string, text: string): Promise<void> {
  const file = path.join(home, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
const read = (rel: string) => fs.readFile(path.join(home, rel), "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until `fn` is true, or fails after `ms`. */
async function until(fn: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(25);
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-home-history-"));
  home = path.join(root, "home");
  gitdir = path.join(root, "history");
  await put("mods/hello/mod.json", "{}\n");
  await put("mods/hello/ui.tsx", "one\n");
});
afterEach(async () => {
  h?.close();
  h = null;
  await fs.rm(root, { recursive: true, force: true });
});

describe("changeMessage", () => {
  it("names at most three paths", () => {
    expect(changeMessage(["a"])).toBe("Change to the app: a");
    expect(changeMessage(["a", "b", "c"])).toBe("Change to the app: a, b, c");
    expect(changeMessage(["a", "b", "c", "d", "e"])).toBe("Change to the app: a, b, c and 2 more");
  });
});

describe("HomeHistory", () => {
  it("commits what is there on init, then nothing more when nothing changed", async () => {
    h = new HomeHistory(home, gitdir);
    await h.init();
    const first = await h.last();
    expect(first?.message).toBe("Change to the app: mods/hello/mod.json, mods/hello/ui.tsx");
    await h.init();
    expect((await h.last())?.message).toBe(first?.message);
    expect(await h.commitNow()).toBeNull();
  });

  it("tracks only mods/, layouts/ and settings.json; never storage/, sessions/, core/, .error or .control.json", async () => {
    await put("storage/x.json", "{}");
    await put("sessions/s.jsonl", "x");
    await put("core/mods/home/mod.json", "{}");
    await put("harness/layouts/main.json", "{}");
    await put(".control.json", "{}");
    await put(".layers.json", "{}");
    await put("AGENTS.md", "x");
    await put("mods/hello/ui.tsx.error", "bad");
    await put("layouts/mine.json", "{}");
    await put("layouts/broken.json.error", "bad");
    await put("settings.json", "{}");
    h = new HomeHistory(home, gitdir);
    await h.init();
    expect(await h.trackedFiles()).toEqual(["layouts/mine.json", "mods/hello/mod.json", "mods/hello/ui.tsx", "settings.json"]);
  });

  it("commits an edit once, after a quiet second", async () => {
    h = new HomeHistory(home, gitdir, 300);
    await h.init();
    const commits: string[] = [];
    h.onChange((c) => commits.push(c?.message ?? ""));
    h.watch();
    await sleep(100);
    await put("mods/hello/ui.tsx", "two\n");
    await sleep(100);
    await put("mods/hello/ui.tsx", "three\n");
    await put("mods/hello/ui.tsx.error", "bad\n");
    await put("storage/x.json", "{}");
    await until(async () => commits.length > 0);
    await sleep(600);
    expect(commits).toEqual(["Change to the app: mods/hello/ui.tsx"]);
    expect(await h.count()).toBe(2);
  });

  it("a change outside what it tracks is never committed", async () => {
    h = new HomeHistory(home, gitdir, 100);
    await h.init();
    h.watch();
    await sleep(100);
    await put("storage/x.json", "{}");
    await put(".control.json", "{}");
    await sleep(500);
    expect(await h.count()).toBe(1);
  });

  it("undo brings back the previous files and commits", async () => {
    h = new HomeHistory(home, gitdir);
    await h.init();
    await put("mods/hello/ui.tsx", "two\n");
    await put("layouts/mine.json", "{}\n");
    await h.commitNow();
    const undone = await h.undo();
    expect(undone?.message).toBe("Undo: Change to the app: layouts/mine.json, mods/hello/ui.tsx");
    expect(await read("mods/hello/ui.tsx")).toBe("one\n");
    await expect(fs.access(path.join(home, "layouts/mine.json"))).rejects.toThrow();
    expect(await h.count()).toBe(3);
    expect((await h.last())?.message).toBe(undone?.message);
  });

  it("undo with one commit does nothing", async () => {
    h = new HomeHistory(home, gitdir);
    await h.init();
    expect(await h.undo()).toBeNull();
    expect(await h.count()).toBe(1);
    expect(await read("mods/hello/ui.tsx")).toBe("one\n");
  });

  it("undo leaves what it doesn't track alone", async () => {
    h = new HomeHistory(home, gitdir);
    await h.init();
    await put("storage/x.json", "keep");
    await put("mods/hello/ui.tsx.error", "bad");
    await put("mods/hello/ui.tsx", "two\n");
    await h.commitNow();
    await h.undo();
    expect(await read("storage/x.json")).toBe("keep");
    expect(await read("mods/hello/ui.tsx.error")).toBe("bad");
  });
});
