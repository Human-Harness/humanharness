import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BEFORE_MESSAGE, History, laterTasksSharing, ownedPathsOf, sharedPathsOf } from "../src";

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

describe("laterTasksSharing", () => {
  const groups = [
    { taskId: "t3", date: "2026-10-28T10:03:00Z", changes: [{ path: "x.md", kind: "modified" as const }] },
    { taskId: "t2", date: "2026-10-28T10:02:00Z", changes: [{ path: "a.md", kind: "modified" as const }] },
    { taskId: null, date: "2026-10-28T10:02:30Z", changes: [{ path: "a.md", kind: "modified" as const }] },
    { taskId: "t1", date: "2026-10-28T10:01:00Z", changes: [{ path: "a.md", kind: "added" as const }] },
    { taskId: "t0", date: "2026-10-28T10:00:00Z", changes: [{ path: "a.md", kind: "added" as const }] },
  ];

  it("only later tasks that changed one of the same paths", () => {
    expect(laterTasksSharing(groups, "t1", "2026-10-28T10:01:00Z", ["a.md"]).map((g) => g.taskId)).toEqual(["t2"]);
  });

  it("takes Date values as History.tasks gives them", () => {
    const dated = groups.map((g) => ({ ...g, date: new Date(g.date) }));
    expect(laterTasksSharing(dated, "t1", new Date("2026-10-28T10:01:00Z"), ["a.md"]).map((g) => g.taskId)).toEqual(["t2"]);
  });

  it("nothing when no path is shared", () => {
    expect(laterTasksSharing(groups, "t1", "2026-10-28T10:01:00Z", ["z.md"])).toEqual([]);
  });
});
