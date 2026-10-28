import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rf-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
  await history.init();
});

describe("History.restoreFile (file-timeline spec §5)", () => {
  it("brings back one file and commits only it; other edits stay uncommitted", async () => {
    write("a.md", "a1");
    write("b.md", "b1");
    const v1 = (await history.save("Turn: one", { task: "t1" }))!;
    write("a.md", "a2");
    write("b.md", "b2");
    await history.save("Turn: two", { task: "t2" });
    write("b.md", "b3 (the person's, not committed)");
    const r = await history.restoreFile("a.md", v1, "Go back: a.md to v1");
    expect(r.skipped).toEqual([]);
    expect(read("a.md")).toBe("a1");
    expect(read("b.md")).toBe("b3 (the person's, not committed)");
    expect(await git.listFiles({ fs, gitdir, ref: r.sha! })).toEqual(["a.md", "b.md"]);
    expect((await history.readBytesAt(r.sha!, "b.md"))?.bytes.toString()).toBe("b2");
    const { commit } = await git.readCommit({ fs, gitdir, oid: r.sha! });
    expect(commit.message.trim()).toBe("Go back: a.md to v1");
    // The next save takes the person's edit.
    expect(await history.save("Before message")).not.toBeNull();
  });

  it("a deleted file comes back with its folders", async () => {
    write("deep/er/c.md", "c");
    const v1 = (await history.save("Turn: make", { task: "t1" }))!;
    fs.rmSync(path.join(folder, "deep"), { recursive: true });
    await history.save("Turn: delete", { task: "t2" });
    await history.restoreFile("deep/er/c.md", v1, "Go back: deep/er/c.md to v1");
    expect(read("deep/er/c.md")).toBe("c");
  });

  it("the same content: no commit", async () => {
    write("a.md", "a1");
    const v1 = (await history.save("Turn: one"))!;
    expect(await history.restoreFile("a.md", v1, "Go back: a.md to v1")).toEqual({ sha: null, skipped: [] });
  });

  it("never writes through a linked folder", async () => {
    write("d/c.md", "c");
    const v1 = (await history.save("Turn: make"))!;
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.rmSync(path.join(folder, "d"), { recursive: true });
    fs.symlinkSync(outside, path.join(folder, "d"));
    const r = await history.restoreFile("d/c.md", v1, "Go back: d/c.md to v1");
    expect(r).toEqual({ sha: null, skipped: ["d/c.md"] });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("refuses a path the history does not track or a version without it", async () => {
    write("a.md", "a1");
    const v1 = (await history.save("Turn: one"))!;
    await expect(history.restoreFile(".harness/tasks.json", v1, "x")).rejects.toThrow("not tracked");
    await expect(history.restoreFile("nope.md", v1, "x")).rejects.toThrow("not in that version");
  });
});
