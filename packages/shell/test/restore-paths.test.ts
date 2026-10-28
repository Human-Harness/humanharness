import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "@humanharness/workspace";
import { restoreTaskByPaths } from "../src/main/restore-paths";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rpaths-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  folder = path.join(base, "w");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "h.git"), [".harness/"]);
  await history.init();
  write("a.md", "a0");
  write("b.md", "b0");
  await history.save("Start");
});

/** Task t1's start, then its turn that changes a.md. */
async function t1Changes(): Promise<void> {
  await history.save("Before message", { task: "t1" });
  write("a.md", "a1");
  await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
}

describe("undo a task by its paths (parallel spec §5.3, Decision 12, P2)", () => {
  it("restores only the task's own paths; another task's stay", async () => {
    await t1Changes();
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Turn: B", { task: "t2" });
    const r = await restoreTaskByPaths(history, "t1", { running: [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["a.md"] });
    expect(read("a.md")).toBe("a0");
    expect(read("b.md")).toBe("b1");
  });

  it("refused while a running turn touched one of its paths; names the file", async () => {
    await t1Changes();
    const r = await restoreTaskByPaths(history, "t1", { running: [{ task: "t2", paths: new Set(["a.md"]) }], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "running", path: "a.md" });
    expect(read("a.md")).toBe("a1");
  });

  it("shared paths only after confirm", async () => {
    await t1Changes();
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Shared: A", { task: "t1", shared: ["t2"] });
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toMatchObject({ paths: ["a.md"], sharedLeft: ["b.md"] });
    expect(read("b.md")).toBe("b1");
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: true })).toMatchObject({ ok: true, paths: ["a.md", "b.md"], sharedLeft: [] });
    expect(read("b.md")).toBe("b0");
  });

  it("a path both owned and shared counts as owned: undone without a confirm, never listed as left", async () => {
    await t1Changes();
    write("a.md", "a2");
    await history.commitPaths(["a.md"], "Shared: A", { task: "t1", shared: ["t2"] });
    const r = await restoreTaskByPaths(history, "t1", { running: [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["a.md"], sharedLeft: [] });
    expect(read("a.md")).toBe("a0");
  });

  it("refused when a later task changed one of the paths; nothing is restored", async () => {
    await t1Changes();
    write("a.md", "a-by-t2");
    await history.commitPaths(["a.md"], "Turn: B", { task: "t2" });
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toEqual({ ok: false, reason: "later", path: "a.md", tasks: ["t2"], outside: 0 });
    expect(read("a.md")).toBe("a-by-t2");
  });

  it("refused when the person's own commit outside any task changed one of the paths later", async () => {
    await t1Changes();
    write("a.md", "a-by-hand");
    await history.save("Data: notes");
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toMatchObject({ ok: false, reason: "later", path: "a.md", tasks: [], outside: 1 });
    expect(read("a.md")).toBe("a-by-hand");
  });

  it("refused when one of the paths has changes the history hasn't saved yet; names the file", async () => {
    await t1Changes();
    write("a.md", "unsaved");
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toEqual({ ok: false, reason: "uncommitted", path: "a.md" });
    expect(read("a.md")).toBe("unsaved");
  });

  it("an unsaved change elsewhere doesn't stop it", async () => {
    await t1Changes();
    write("b.md", "unsaved");
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toMatchObject({ ok: true, paths: ["a.md"] });
    expect(read("b.md")).toBe("unsaved");
  });

  it("refused when the task started further back than the history reads: later changes could be missed", async () => {
    await t1Changes();
    for (let i = 0; i < 4; i++) {
      write("b.md", `b${i + 1}`);
      await history.commitPaths(["b.md"], `Turn: B${i}`, { task: "t2" });
    }
    // A later turn of t1 keeps it in the window read; its start is past it.
    write("a.md", "a2");
    await history.commitPaths(["a.md"], "Turn: A again", { task: "t1" });
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false, depth: 3 })).toEqual({ ok: false, reason: "too-far" });
    expect(read("a.md")).toBe("a2");
  });

  it("nothing to undo for a task the history doesn't know", async () => {
    expect(await restoreTaskByPaths(history, "nope", { running: [], includeShared: false })).toEqual({ ok: false, reason: "nothing" });
  });
});
