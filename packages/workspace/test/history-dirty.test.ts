import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hdirty-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/"]);
  await history.init();
  write("a.md", "a0");
  await history.save("Start");
});

describe("dirtyState and changedSince (parallel spec §5.2 step 1, Decision 3)", () => {
  it("null start: every dirty path; a start: only paths whose content moved since", async () => {
    write("b.md", "b1");
    const start = await history.dirtyState();
    expect([...start.keys()]).toEqual(["b.md"]);
    expect(await history.changedSince(null)).toEqual(["b.md"]);
    expect(await history.changedSince(start)).toEqual([]);
    write("b.md", "b2");
    write("c.md", "c1");
    fs.rmSync(path.join(folder, "a.md"));
    expect(await history.changedSince(start)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("a deleted path's state is null; ignored and untracked paths never count", async () => {
    fs.rmSync(path.join(folder, "a.md"));
    write(".harness/x.md", "x");
    write(".DS_Store", "x");
    const start = await history.dirtyState();
    expect([...start]).toEqual([["a.md", null]]);
    expect(await history.changedSince(start)).toEqual([]);
    write("a.md", "a0");
    expect(await history.changedSince(start)).toEqual([]);
    write("a.md", "a1");
    expect(await history.changedSince(start)).toEqual(["a.md"]);
  });

  it("a same-size rewrite right after a commit still counts (racy clean)", async () => {
    write("a.md", "a9");
    expect(await history.changedSince(null)).toEqual(["a.md"]);
  });

  it("a path another turn committed meanwhile drops out unless it changed again", async () => {
    const start = await history.dirtyState();
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Turn: other", { task: "t2" });
    expect(await history.changedSince(start)).toEqual([]);
    write("b.md", "b2");
    expect(await history.changedSince(start)).toEqual(["b.md"]);
  });

  it("a link counts by its target path, never what it points to", async () => {
    fs.symlinkSync("a.md", path.join(folder, "l.md"));
    const start = await history.dirtyState();
    expect(start.has("l.md")).toBe(true);
    write("a.md", "a1");
    expect(await history.changedSince(start)).toEqual(["a.md"]);
    fs.rmSync(path.join(folder, "l.md"));
    fs.symlinkSync("c.md", path.join(folder, "l.md"));
    expect(await history.changedSince(start)).toEqual(["a.md", "l.md"]);
  });
});

describe("commitsSince (parallel spec §5.3 conflicts)", () => {
  it("lists newer commits with their task and changed paths, newest first", async () => {
    const from = (await history.last())!;
    write("a.md", "a1");
    await history.save("Turn: one", { task: "t1" });
    write("b.md", "b1");
    await history.save("Turn: two", { task: "t2" });
    const since = await history.commitsSince(from);
    expect(since.map((c) => ({ task: c.task, paths: c.paths }))).toEqual([
      { task: "t2", paths: ["b.md"] },
      { task: "t1", paths: ["a.md"] },
    ]);
    expect(await history.commitsSince(since[0].sha)).toEqual([]);
  });

  it("null: every commit, the first one's paths against nothing", async () => {
    const all = await history.commitsSince(null);
    expect(all.map((c) => ({ task: c.task, paths: c.paths }))).toEqual([{ task: null, paths: ["a.md"] }]);
  });
});

describe("list carries Job: and Shared:", () => {
  it("only on the commits that have them", async () => {
    write("a.md", "a1");
    await history.save("Shared: one", { task: "t1", job: "sync-jira", shared: ["t2", "t3"] });
    const [shared, start] = await history.list();
    expect(shared).toMatchObject({ message: "Shared: one", task: "t1", job: "sync-jira", shared: ["t2", "t3"] });
    expect(start).not.toHaveProperty("job");
    expect(start).not.toHaveProperty("shared");
  });
});
