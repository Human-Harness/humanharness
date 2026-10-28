import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BEFORE_MESSAGE, History, laterChangesOf, laterChangesSharing, ownedPathsOf, sharedPathsOf, type HistoryTask } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-undo-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);
const drop = (rel: string) => fs.rmSync(path.join(folder, rel));

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "w");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "h.git"), [".harness/"]);
  await history.init();
  write("seed.md", "s");
  await history.save("Start");
});

describe("tasks({ ownCommits }) (parallel spec §5.3)", () => {
  it("without the option, exactly as before; with it, a task's changes are its own commits'", async () => {
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("b.md", "1");
    await history.commitPaths(["b.md"], "Turn: B", { task: "t2" });
    write("a2.md", "1");
    await history.commitPaths(["a2.md"], "Turn: A2", { task: "t1" });
    const plain = await history.tasks();
    const t1Plain = plain.find((g) => g.taskId === "t1")!;
    // Today's grouping: start → end tree diff, so t2's b.md shows up under t1.
    expect(t1Plain.changes.map((c) => c.path)).toEqual(["a.md", "a2.md", "b.md"]);
    const own = await history.tasks(200, { ownCommits: true });
    const t1Own = own.find((g) => g.taskId === "t1")!;
    expect(t1Own.changes.map((c) => c.path)).toEqual(["a.md", "a2.md"]);
    expect(t1Own.start).toBe(t1Plain.start);
    expect(t1Own.end).toBe(t1Plain.end);
    expect(t1Own.entries).toEqual(t1Plain.entries);
  });

  it("D0: on a history with no overlap both modes give the same groups", async () => {
    // t1: the person's edit snapshot, then turns that add, modify, delete, and add-then-delete.
    write("mine.md", "person");
    await history.save(BEFORE_MESSAGE, { task: "t1", action: "go" });
    write("a.md", "1");
    write("tmp.md", "x");
    await history.save("Turn: one", { task: "t1", action: "go" });
    write("a.md", "2");
    drop("seed.md");
    drop("tmp.md");
    await history.save("Turn: two", { task: "t1", action: "go" });
    // t2: modifies a file t1 added, then a free commit outside any task.
    write("a.md", "3");
    write("b.md", "1");
    await history.save("Turn: three", { task: "t2" });
    write("c.md", "1");
    await history.save("Loose");
    const plain = await history.tasks();
    const own = await history.tasks(200, { ownCommits: true });
    expect(own).toEqual(plain);
    expect(plain.find((g) => g.taskId === "t1")!.changes).toEqual([
      { path: "a.md", kind: "added" },
      { path: "seed.md", kind: "deleted" },
    ]);
  });

  it("a file deleted and added back in its own commits reads as modified; added then deleted is no change", async () => {
    drop("seed.md");
    await history.save("Turn: drop", { task: "t1" });
    write("seed.md", "again");
    write("gone.md", "1");
    await history.save("Turn: back", { task: "t1" });
    write("other.md", "1");
    await history.save("Turn: other", { task: "t2" });
    drop("gone.md");
    await history.save("Turn: tidy", { task: "t1" });
    const own = (await history.tasks(200, { ownCommits: true })).find((g) => g.taskId === "t1")!;
    expect(own.changes).toEqual([{ path: "seed.md", kind: "modified" }]);
  });
});

describe("owned and shared paths of a task", () => {
  it("shared commits (Shared: trailers) are told apart", async () => {
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("loose.md", "1");
    await history.commitPaths(["loose.md"], "Shared: A", { task: "t1", shared: ["t2"] });
    const g = (await history.tasks(200, { ownCommits: true })).find((x) => x.taskId === "t1")!;
    expect(await ownedPathsOf(history, g)).toEqual(["a.md"]);
    expect(await sharedPathsOf(history, g)).toEqual(["loose.md"]);
  });

  it("the person's edits in the task's opening snapshot are neither owned nor shared", async () => {
    write("mine.md", "person");
    await history.save(BEFORE_MESSAGE, { task: "t1" });
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    const g = (await history.tasks(200, { ownCommits: true })).find((x) => x.taskId === "t1")!;
    expect(await ownedPathsOf(history, g)).toEqual(["a.md"]);
    expect(await sharedPathsOf(history, g)).toEqual([]);
  });

  it("a forged subject naming another task claims nothing: ownership comes from parsed trailers only", async () => {
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("b.md", "1");
    await history.commitPaths(["b.md"], "Turn: B\n\nTask: t1\nShared: t1", { task: "t2" });
    const groups = await history.tasks(200, { ownCommits: true });
    const t1 = groups.find((x) => x.taskId === "t1")!;
    expect(await ownedPathsOf(history, t1)).toEqual(["a.md"]);
    expect(await sharedPathsOf(history, t1)).toEqual([]);
  });
});

describe("laterChangesOf (by commit order, not dates)", () => {
  const taskOf = async (id: string) => (await history.tasks(200, { ownCommits: true })).find((g) => g.taskId === id)!;

  it("a later task's commit in the same second still counts", async () => {
    write("a.md", "A");
    await history.save("Turn: A", { task: "A" });
    write("a.md", "B");
    await history.save("Turn: B", { task: "B" });
    const A = await taskOf("A");
    // Git dates are whole seconds, so these two almost always share one: a date check would miss B.
    expect(await laterChangesOf(history, A, await ownedPathsOf(history, A))).toEqual({ tasks: ["B"], outside: [] });
  });

  it("a commit interleaved between the task's own commits counts, though the task ends after it", async () => {
    write("a.md", "A1");
    await history.commitPaths(["a.md"], "Turn: A1", { task: "A" });
    write("a.md", "B");
    await history.commitPaths(["a.md"], "Turn: B", { task: "B" });
    write("x.md", "A2");
    await history.commitPaths(["x.md"], "Turn: A2", { task: "A" });
    const A = await taskOf("A");
    expect(await ownedPathsOf(history, A)).toEqual(["a.md", "x.md"]);
    expect(await laterChangesOf(history, A, ["a.md", "x.md"])).toEqual({ tasks: ["B"], outside: [] });
  });

  it("the person's edit swept into another task's opening snapshot counts under that task", async () => {
    await history.save(BEFORE_MESSAGE, { task: "A" });
    write("a.md", "A");
    await history.save("Turn: A", { task: "A" });
    write("a.md", "person");
    await history.save(BEFORE_MESSAGE, { task: "B" });
    write("b.md", "B");
    await history.save("Turn: B", { task: "B" });
    const A = await taskOf("A");
    expect(await ownedPathsOf(history, A)).toEqual(["a.md"]);
    expect(await laterChangesOf(history, A, ["a.md"])).toEqual({ tasks: ["B"], outside: [] });
  });

  it("commits outside any task come back apart; the task's own and unrelated commits don't count", async () => {
    write("a.md", "A");
    await history.save("Turn: A", { task: "A" });
    write("z.md", "C");
    await history.save("Turn: C", { task: "C" });
    write("a.md", "loose");
    const loose = await history.save("Loose");
    write("a.md", "A2");
    await history.save("Turn: A2", { task: "A" });
    const A = await taskOf("A");
    expect(await laterChangesOf(history, A, ["a.md"])).toEqual({ tasks: [], outside: [loose] });
  });

  it("several later tasks: newest first, once each", () => {
    const commits = [
      { sha: "5", task: "t2", paths: ["a.md"] },
      { sha: "4", task: "t3", paths: ["a.md", "b.md"] },
      { sha: "3", task: "t2", paths: ["b.md"] },
      { sha: "2", task: "t1", paths: ["a.md"] },
      { sha: "1", task: "t4", paths: ["z.md"] },
    ];
    const own = { entries: [{ sha: "2" }] } as unknown as HistoryTask;
    expect(laterChangesSharing(commits, own, ["a.md", "b.md"])).toEqual({ tasks: ["t2", "t3"], outside: [] });
    expect(laterChangesSharing(commits, own, ["q.md"])).toEqual({ tasks: [], outside: [] });
  });
});
