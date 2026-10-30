import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import { BEFORE_MESSAGE, History, type LinkedFolderEntry, RESTORE_TASK, type ScopeEntry } from "@humanharness/workspace";
import {
  type LinkedHistoryRef,
  linkedHistoriesFor,
  linkedHistoryView,
  openLinkedHistory,
  linkedOnlyRows,
  mergeTaskGroups,
  restoreLinkedTask,
  restoreTaskWithLinked,
} from "../src/main/linked-restore";
import { undoRefusalOf } from "../src/main/tasks-ipc";
import type { HistoryTaskView } from "@humanharness/protocol";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-lrestore-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const DECLS: Record<string, LinkedFolderDecl> = {
  notes: { label: "Notes", mode: "write", history: "auto", many: false },
  repos: { label: "Repos", mode: "write", history: "auto", many: true },
  docs: { label: "Docs", mode: "read", history: "auto", many: false },
};

let base: string;
let main: History;
let mainDir: string;
let notes: History;
let notesDir: string;
const write = (dir: string, rel: string, c: string) => fs.writeFileSync(path.join(dir, rel), c);
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
const commits = async (h: History) => (await h.list(100)).length;

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(root, "b-"));
  mainDir = path.join(base, "main");
  notesDir = path.join(base, "notes");
  fs.mkdirSync(mainDir);
  fs.mkdirSync(notesDir);
  main = new History(mainDir, path.join(base, "main.git"), [".harness/"]);
  notes = new History(notesDir, path.join(base, "notes.git"), [], []);
  await main.init();
  await notes.init();
  write(mainDir, "a.md", "a0");
  write(notesDir, "x.md", "x0");
  await main.save("Start");
  await notes.save("Start");
});

/** One turn of `task` in both histories, as the workspace runs it: "Before message" in each, then the turn's commit. */
async function turn(task: string, mainContent: string | null, notesContent: string | null): Promise<void> {
  await main.save(BEFORE_MESSAGE, { task });
  await notes.save(BEFORE_MESSAGE, { task });
  if (mainContent !== null) {
    write(mainDir, "a.md", mainContent);
    await main.commitPaths(["a.md"], "Turn: A", { task });
  }
  if (notesContent !== null) {
    write(notesDir, "x.md", notesContent);
    await notes.commitPaths(["x.md"], "Turn: A", { task });
  }
}

const noGit = async () => false;
const refs = (): LinkedHistoryRef[] => [{ key: "notes", label: "Notes", path: notesDir, history: notes }];

const entry = (l: Partial<LinkedFolderEntry> & { key: string; path: string }): LinkedFolderEntry => ({ mode: "write", tracked: true, ...l });
const scopes = (linked: LinkedFolderEntry[]): ScopeEntry[] => [
  { id: "app", title: "App", createdAt: "2026-10-28T10:00:00.000Z", archived: false, linked },
  { id: "other", title: "Other", createdAt: "2026-10-28T10:00:00.000Z", archived: false, linked: [entry({ key: "notes", path: "/elsewhere" })] },
];

describe("Undo this task over linked folders (hatches spec §3.4)", () => {
  it("restores each tracked linked folder to the task's start there", async () => {
    await turn("t1", "a1", "x1");
    const before = await commits(notes);
    expect(await restoreLinkedTask(refs(), "t1", RESTORE_TASK)).toBe(1);
    expect(read(notesDir, "x.md")).toBe("x0");
    expect(await commits(notes)).toBe(before + 1);
    const [last] = await notes.list(1);
    expect(last.message).toBe(RESTORE_TASK);
    expect(last.task).toBeNull();
  });

  it("a task with no commits in a linked history leaves it alone", async () => {
    await main.save(BEFORE_MESSAGE, { task: "t1" });
    write(mainDir, "a.md", "a1");
    await main.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write(notesDir, "x.md", "mine");
    const before = await commits(notes);
    expect(await restoreLinkedTask(refs(), "t1", RESTORE_TASK)).toBe(0);
    expect(await commits(notes)).toBe(before);
    expect(read(notesDir, "x.md")).toBe("mine");
  });

  it("board mode: by paths in the work folder and each linked history", async () => {
    await turn("t1", "a1", "x1");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning: async () => [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["a.md", "notes/x.md"] });
    expect(read(mainDir, "a.md")).toBe("a0");
    expect(read(notesDir, "x.md")).toBe("x0");
  });

  it("board mode: a task that changed only a linked folder is undone there", async () => {
    await turn("t1", null, "x1");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning: async () => [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["notes/x.md"] });
    expect(read(notesDir, "x.md")).toBe("x0");
  });

  it("board mode: a linked refusal names the folder's key, and nothing is restored anywhere", async () => {
    await turn("t1", "a1", "x1");
    await notes.save(BEFORE_MESSAGE, { task: "t2" });
    write(notesDir, "x.md", "x2");
    await notes.commitPaths(["x.md"], "Turn: B", { task: "t2" });
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "later", path: "notes/x.md", tasks: ["t2"], outside: 0 });
    expect(read(mainDir, "a.md")).toBe("a1");
    expect(read(notesDir, "x.md")).toBe("x2");
  });

  it("board mode: unsaved changes in a linked folder refuse the undo, named by key", async () => {
    await turn("t1", "a1", "x1");
    write(notesDir, "x.md", "unsaved");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "uncommitted", path: "notes/x.md" });
    expect(read(mainDir, "a.md")).toBe("a1");
  });

  it("board mode: nothing in any history is 'nothing'", async () => {
    const r = await restoreTaskWithLinked(main, refs(), "t9", { running: async () => [], linkedRunning: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "nothing" });
  });

  it("board mode: a running lane's edit in the linked folder refuses the undo, named by key (P2)", async () => {
    await turn("t1", "a1", "x1");
    const linkedRunning = vi.fn(async (_p: string) => [{ task: "t2", paths: new Set(["x.md"]) as ReadonlySet<string> }]);
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning, includeShared: false });
    expect(r).toEqual({ ok: false, reason: "running", path: "notes/x.md" });
    expect(linkedRunning).toHaveBeenCalledWith(notesDir);
    expect(read(mainDir, "a.md")).toBe("a1");
    expect(read(notesDir, "x.md")).toBe("x1");
  });

  it("board mode: a refusal after the work folder was restored is a partial undo, naming what was and wasn't", async () => {
    await turn("t1", "a1", "x1");
    // Another lane writes the linked file once the work folder's restore commit lands (between checks and restores).
    const off = main.onCommit(() => write(notesDir, "x.md", "lane-B"));
    const logged: string[] = [];
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], linkedRunning: async () => [], includeShared: false, log: (m) => logged.push(m) });
    off();
    expect(r).toEqual({
      ok: false,
      reason: "partial",
      workFolder: true,
      restored: [],
      notRestored: ["notes"],
      refusal: { ok: false, reason: "uncommitted", path: "notes/x.md" },
    });
    expect(read(mainDir, "a.md")).toBe("a0");
    expect(read(notesDir, "x.md")).toBe("lane-B");
    expect(logged).toHaveLength(1);
    expect(undoRefusalOf(r as Exclude<typeof r, { ok: true }>)).toEqual({
      reason: "partial",
      workFolder: true,
      restored: [],
      notRestored: ["notes"],
      cause: { reason: "uncommitted", path: "notes/x.md" },
    });
  });

  it("a folder that has git now, or whose git can't be told, is never given to History (L7, fails closed)", async () => {
    const open = vi.fn(async (_p: string) => notes);
    const links = scopes([entry({ key: "notes", path: notesDir })]);
    expect(await linkedHistoriesFor(links, "app", DECLS, open, async () => true)).toEqual([]);
    expect(
      await linkedHistoriesFor(links, "app", DECLS, open, async () => {
        throw new Error("EACCES");
      }),
    ).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("an untracked folder is never given to History (L7)", async () => {
    const open = vi.fn(async (_p: string) => notes);
    const got = await linkedHistoriesFor(
      scopes([
        entry({ key: "notes", path: notesDir }),
        entry({ key: "repos", path: "/code/git-repo", tracked: false }),
        entry({ key: "repos", path: "/code/now-git", gitChanged: true }),
        entry({ key: "docs", path: "/docs", mode: "read", tracked: true }),
        entry({ key: "gone", path: "/undeclared" }),
      ]),
      "app",
      DECLS,
      open,
      noGit,
    );
    expect(open.mock.calls.map((c) => c[0])).toEqual([notesDir]);
    expect(got).toEqual([{ key: "notes", label: "Notes", path: notesDir, history: notes }]);
  });

  it("a linked folder whose history can't be opened is left out", async () => {
    const got = await linkedHistoriesFor(scopes([entry({ key: "notes", path: notesDir })]), "app", DECLS, async () => null, noGit);
    expect(got).toEqual([]);
  });
});

describe("openLinkedHistory", () => {
  it("prefers the workspace's open history", async () => {
    const opened = vi.fn(async () => notes);
    const h = await openLinkedHistory(() => path.join(base, "nope.git"), opened)(notesDir);
    expect(h).toBe(notes);
  });

  it("opens one over an existing gitdir; never creates one", async () => {
    const none = path.join(base, "none.git");
    expect(await openLinkedHistory(() => none, async () => null)(notesDir)).toBeNull();
    expect(fs.existsSync(none)).toBe(false);
    const h = await openLinkedHistory(() => path.join(base, "notes.git"), async () => null)(notesDir);
    expect(h).not.toBeNull();
    expect((await h!.list(1))[0].message).toBe("Start");
  });

  it("a gitdir that is a symlink is not followed", async () => {
    const link = path.join(base, "link.git");
    fs.symlinkSync(path.join(base, "notes.git"), link);
    expect(await openLinkedHistory(() => link, async () => null)(notesDir)).toBeNull();
  });

  it("a gitdir without HEAD is not opened (init would make a repository there)", async () => {
    const empty = path.join(base, "empty.git");
    fs.mkdirSync(empty);
    expect(await openLinkedHistory(() => empty, async () => null)(notesDir)).toBeNull();
    expect(fs.readdirSync(empty)).toEqual([]);
  });
});

describe("mergeTaskGroups (plain mode's undo over linked folders)", () => {
  const g = (taskId: string | null, date: string, path = "a.md"): HistoryTaskView => ({
    taskId,
    actionId: null,
    start: "s",
    end: "e",
    date,
    changes: [{ path, kind: "modified" }],
    entries: [],
  });
  it("adds a task only a linked folder has, its paths named by key, and keeps the newest date of a shared task", () => {
    const merged = mergeTaskGroups(
      [g("t2", "2026-10-28T10:00:00.000Z"), g("t1", "2026-10-28T09:00:00.000Z"), g(null, "2026-10-28T08:00:00.000Z")],
      [{ key: "notes", groups: [g("t3", "2026-10-28T11:00:00.000Z", "x.md"), g("t1", "2026-10-28T10:30:00.000Z", "x.md"), g(null, "2026-10-28T07:00:00.000Z")] }],
    );
    expect(merged.map((m) => [m.taskId, m.date])).toEqual([
      ["t3", "2026-10-28T11:00:00.000Z"],
      ["t1", "2026-10-28T10:30:00.000Z"],
      ["t2", "2026-10-28T10:00:00.000Z"],
      [null, "2026-10-28T08:00:00.000Z"],
    ]);
    expect(merged[0].changes).toEqual([{ path: "notes/x.md", kind: "modified" }]);
    expect(merged[1].changes).toEqual([{ path: "a.md", kind: "modified" }]);
  });
});

describe("linkedOnlyRows (the History panel's rows)", () => {
  const g = (taskId: string | null, date: string, path = "a.md"): HistoryTaskView => ({
    taskId,
    actionId: "implement",
    start: "s",
    end: "e",
    date,
    changes: [{ path, kind: "modified" }],
    entries: [{ sha: `sha-${taskId}-${date}`, message: "Turn: go", date }],
  });

  it("adds a row for a task only linked folders changed, with no files or entries of its own, in date order", () => {
    const rows = linkedOnlyRows(
      [g("t2", "2026-10-28T10:00:00.000Z"), g(null, "2026-10-28T08:00:00.000Z")],
      [
        { key: "notes", groups: [g("t3", "2026-10-28T11:00:00.000Z", "x.md"), g("t2", "2026-10-28T12:00:00.000Z", "x.md"), g(null, "2026-10-28T07:00:00.000Z")] },
        { key: "site", groups: [g("t3", "2026-10-28T11:30:00.000Z", "y.md")] },
      ],
    );
    expect(rows.map((r) => [r.taskId, r.date])).toEqual([
      ["t3", "2026-10-28T11:30:00.000Z"],
      ["t2", "2026-10-28T10:00:00.000Z"],
      [null, "2026-10-28T08:00:00.000Z"],
    ]);
    expect(rows[0]).toMatchObject({ taskId: "t3", actionId: "implement", changes: [], entries: [] });
    // A task the work folder has keeps its row as it is (its linked changes show under the folders' labels).
    expect(rows[1].changes).toEqual([{ path: "a.md", kind: "modified" }]);
  });

  it("no linked-only task: the work folder's rows, untouched; a linked group with no change left adds none", () => {
    const main = [g("t1", "2026-10-28T10:00:00.000Z")];
    expect(linkedOnlyRows(main, [])).toBe(main);
    expect(linkedOnlyRows(main, [{ key: "notes", groups: [{ ...g("t9", "2026-10-28T11:00:00.000Z"), changes: [] }] }])).toBe(main);
  });
});

describe("linkedHistoryView", () => {
  it("lists each task's changes per tracked folder, and the untracked folders for the 'not covered' line", async () => {
    await turn("t1", "a1", "x1");
    const view = await linkedHistoryView(
      scopes([entry({ key: "notes", path: notesDir }), entry({ key: "repos", path: "/code/repo", tracked: false }), entry({ key: "docs", path: "/docs", mode: "read", tracked: false })]),
      "app",
      DECLS,
      async () => notes,
      async (dir) => dir === "/code/repo",
    );
    expect(view).toEqual({
      uncovered: [{ key: "repos", label: "Repos" }],
      tasks: { t1: [{ key: "notes", label: "Notes", changes: [{ path: "x.md", kind: "modified" }] }] },
    });
  });

  it("a folder that gained git since it was linked is not covered", async () => {
    const view = await linkedHistoryView(scopes([entry({ key: "notes", path: notesDir, gitChanged: true })]), "app", DECLS, async () => notes, async () => true);
    expect(view).toEqual({ uncovered: [{ key: "notes", label: "Notes" }], tasks: {} });
  });

  it("an untracked folder with no git now (it lost its git) is not covered and says it has none", async () => {
    const lost = scopes([entry({ key: "repos", path: "/code/repo", tracked: false, gitChanged: true }), entry({ key: "notes", path: "/code/left", tracked: false })]);
    expect((await linkedHistoryView(lost, "app", DECLS, async () => null, noGit)).uncovered).toEqual([
      { key: "repos", label: "Repos", noGit: true },
      { key: "notes", label: "Notes", noGit: true },
    ]);
    // Git that can't be told: the line it had (its own git), never a claim that it has none.
    const unknown = await linkedHistoryView(lost, "app", DECLS, async () => null, async () => Promise.reject(new Error("EACCES")));
    expect(unknown.uncovered).toEqual([
      { key: "repos", label: "Repos" },
      { key: "notes", label: "Notes" },
    ]);
  });

  it("no scope or no links: empty", async () => {
    expect(await linkedHistoryView(scopes([]), null, DECLS, async () => notes, noGit)).toEqual({ uncovered: [], tasks: {} });
    expect(await linkedHistoryView(scopes([]), "app", DECLS, async () => notes, noGit)).toEqual({ uncovered: [], tasks: {} });
  });
});
