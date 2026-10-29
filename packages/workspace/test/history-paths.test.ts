import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hpaths-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");
const treeOf = async (sha: string) => {
  const files: Record<string, string> = {};
  await git.walk({
    fs,
    gitdir,
    trees: [git.TREE({ ref: sha })],
    map: async (p, [t]) => {
      if (p !== "." && t && (await t.type()) === "blob") files[p] = Buffer.from((await t.content())!).toString("utf8");
      return undefined;
    },
  });
  return files;
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/"]);
  await history.init();
  write("a.md", "a0");
  write("b.md", "b0");
  await history.save("Start");
});

describe("History.commitPaths (parallel spec §5.2 step 4)", () => {
  it("commits only the listed paths; the rest stay dirty in the folder", async () => {
    write("a.md", "a1");
    write("b.md", "b1");
    write("c.md", "c1");
    const sha = (await history.commitPaths(["a.md", "c.md"], "Turn: one", { task: "t1" }))!;
    expect(await treeOf(sha)).toEqual({ "a.md": "a1", "b.md": "b0", "c.md": "c1" });
    expect((await history.list(1))[0]).toMatchObject({ message: "Turn: one", task: "t1" });
    expect(read("b.md")).toBe("b1");
    // The next whole save picks b.md up.
    const next = (await history.save("Turn: two", { task: "t2" }))!;
    expect(await treeOf(next)).toEqual({ "a.md": "a1", "b.md": "b1", "c.md": "c1" });
  });
  it("a deleted path is removed; nothing changed among the paths: no commit", async () => {
    fs.rmSync(path.join(folder, "a.md"));
    const sha = (await history.commitPaths(["a.md"], "Turn: rm"))!;
    expect(await treeOf(sha)).toEqual({ "b.md": "b0" });
    expect(await history.commitPaths(["b.md"], "Turn: same")).toBeNull();
    expect(await history.commitPaths([], "Turn: none")).toBeNull();
  });
  it("an untracked path is never staged", async () => {
    write(".harness/tasks.json", "{}");
    expect(await history.commitPaths([".harness/tasks.json"], "Turn: app")).toBeNull();
  });
});

describe("History.restorePaths (parallel spec §5.3, T4)", () => {
  it("brings only the listed paths back to `sha`; others keep their in-flight content", async () => {
    const start = (await history.last())!;
    write("a.md", "a1");
    write("b.md", "b1");
    write("n.md", "new");
    const r = await history.restorePaths(["a.md", "n.md"], start, "Undo: the turn did not finish", { task: "t1" });
    expect(read("a.md")).toBe("a0");
    expect(fs.existsSync(path.join(folder, "n.md"))).toBe(false);
    expect(read("b.md")).toBe("b1");
    expect(r.skipped).toEqual([]);
    // The restore's commit stages only those paths: b.md is still dirty.
    expect(await treeOf(r.sha ?? (await history.last())!)).toEqual({ "a.md": "a0", "b.md": "b0" });
  });
  it("commits the restored paths, and only them, when HEAD had moved on", async () => {
    const start = (await history.last())!;
    write("a.md", "a1");
    write("c.md", "c1");
    await history.save("Turn: one");
    write("b.md", "b1");
    const r = await history.restorePaths(["a.md", "c.md"], start, "Undo: one", { task: "t1" });
    expect(r).toEqual({ sha: expect.any(String), skipped: [] });
    expect(await treeOf(r.sha!)).toEqual({ "a.md": "a0", "b.md": "b0" });
    expect((await history.list(1))[0]).toMatchObject({ message: "Undo: one", task: "t1" });
    expect(read("b.md")).toBe("b1");
  });
  it("an untracked path is left alone", async () => {
    const start = (await history.last())!;
    write(".harness/tasks.json", "{}");
    const r = await history.restorePaths([".harness/tasks.json"], start, "Undo");
    expect(r).toEqual({ sha: null, skipped: [] });
    expect(read(".harness/tasks.json")).toBe("{}");
  });
  it("never writes through a link that leads out of the folder", async () => {
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.rmSync(path.join(folder, "a.md"));
    write("d/x.md", "x0");
    const withX = (await history.save("x"))!;
    fs.rmSync(path.join(folder, "d"), { recursive: true });
    fs.symlinkSync(outside, path.join(folder, "d"));
    const r = await history.restorePaths(["d/x.md"], withX, "Undo");
    expect(r.skipped).toEqual(["d/x.md"]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("never removes through a link: a path absent at `sha` under a linked folder is skipped", async () => {
    const start = (await history.last())!;
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(outside, "y.md"), "theirs");
    fs.symlinkSync(outside, path.join(folder, "e"));
    const r = await history.restorePaths(["e/y.md"], start, "Undo");
    expect(r.skipped).toEqual(["e/y.md"]);
    expect(fs.readFileSync(path.join(outside, "y.md"), "utf8")).toBe("theirs");
  });
  it("a link put where a file goes is replaced, its target untouched", async () => {
    const start = (await history.last())!;
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(outside, "secret"), "theirs");
    fs.rmSync(path.join(folder, "a.md"));
    fs.symlinkSync(path.join(outside, "secret"), path.join(folder, "a.md"));
    const r = await history.restorePaths(["a.md"], start, "Undo");
    expect(r.skipped).toEqual([]);
    expect(fs.lstatSync(path.join(folder, "a.md")).isFile()).toBe(true);
    expect(read("a.md")).toBe("a0");
    expect(fs.readFileSync(path.join(outside, "secret"), "utf8")).toBe("theirs");
  });
});

describe("History.restorePaths touches only exact tracked paths (Task 4 review)", () => {
  /** A path absent at `sha` that names an existing file only by a non-exact spelling. */
  const leavesInPlace = async (h: History, given: string, real: string) => {
    const start = (await h.last())!;
    const r = await h.restorePaths([given], start, "Undo: x", { task: "t1" });
    expect(fs.existsSync(path.join(folder, real))).toBe(true);
    expect(r.sha).toBeNull();
  };
  it("a different case, ./, a leading / or a .. segment never deletes a.md", async () => {
    for (const given of ["A.md", "./a.md", "/a.md", "sub/../a.md", "a.md/", "a.md\\"]) await leavesInPlace(history, given, "a.md");
    expect(read("a.md")).toBe("a0");
  });
  it("a kept prefix with .. or a different case never reaches an ignored file", async () => {
    const kept = new History(folder, gitdir, [".harness/"], [".harness/notes/"]);
    await kept.init();
    write(".harness/tasks.json", "{}");
    write(".harness/notes/n.md", "n");
    await kept.save("Note: n");
    await leavesInPlace(kept, ".harness/notes/../tasks.json", ".harness/tasks.json");
    await leavesInPlace(kept, ".HARNESS/tasks.json", ".harness/tasks.json");
  });
  it("never deletes the person's .git", async () => {
    write(".git/config", "[core]");
    await leavesInPlace(history, ".git/config", ".git/config");
  });
  it("a path it couldn't write is left out of the commit", async () => {
    const start = (await history.last())!;
    write("a.md", "a1");
    write("b.md", "b1");
    await history.save("Turn: one", { task: "t1" });
    // A folder where b.md goes: it can't be written, and must not be committed as deleted.
    fs.rmSync(path.join(folder, "b.md"));
    fs.mkdirSync(path.join(folder, "b.md"));
    fs.writeFileSync(path.join(folder, "b.md", "x"), "x");
    const r = await history.restorePaths(["a.md", "b.md"], start, "Undo: x", { task: "t1" });
    expect(r.skipped).toEqual(["b.md"]);
    expect(await treeOf(r.sha!)).toEqual({ "a.md": "a0", "b.md": "b1" });
  });
});
