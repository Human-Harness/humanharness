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
  restoreLinkedTask,
  restoreTaskWithLinked,
} from "../src/main/linked-restore";

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
    await restoreLinkedTask(refs(), "t1", RESTORE_TASK);
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
    await restoreLinkedTask(refs(), "t1", RESTORE_TASK);
    expect(await commits(notes)).toBe(before);
    expect(read(notesDir, "x.md")).toBe("mine");
  });

  it("board mode: by paths in the work folder and each linked history", async () => {
    await turn("t1", "a1", "x1");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["a.md", "notes/x.md"] });
    expect(read(mainDir, "a.md")).toBe("a0");
    expect(read(notesDir, "x.md")).toBe("x0");
  });

  it("board mode: a task that changed only a linked folder is undone there", async () => {
    await turn("t1", null, "x1");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["notes/x.md"] });
    expect(read(notesDir, "x.md")).toBe("x0");
  });

  it("board mode: a linked refusal names the folder's key, and nothing is restored anywhere", async () => {
    await turn("t1", "a1", "x1");
    await notes.save(BEFORE_MESSAGE, { task: "t2" });
    write(notesDir, "x.md", "x2");
    await notes.commitPaths(["x.md"], "Turn: B", { task: "t2" });
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "later", path: "notes/x.md", tasks: ["t2"], outside: 0 });
    expect(read(mainDir, "a.md")).toBe("a1");
    expect(read(notesDir, "x.md")).toBe("x2");
  });

  it("board mode: unsaved changes in a linked folder refuse the undo, named by key", async () => {
    await turn("t1", "a1", "x1");
    write(notesDir, "x.md", "unsaved");
    const r = await restoreTaskWithLinked(main, refs(), "t1", { running: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "uncommitted", path: "notes/x.md" });
    expect(read(mainDir, "a.md")).toBe("a1");
  });

  it("board mode: nothing in any history is 'nothing'", async () => {
    const r = await restoreTaskWithLinked(main, refs(), "t9", { running: async () => [], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "nothing" });
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
    );
    expect(open.mock.calls.map((c) => c[0])).toEqual([notesDir]);
    expect(got).toEqual([{ key: "notes", label: "Notes", path: notesDir, history: notes }]);
  });

  it("a linked folder whose history can't be opened is left out", async () => {
    const got = await linkedHistoriesFor(scopes([entry({ key: "notes", path: notesDir })]), "app", DECLS, async () => null);
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
});

describe("linkedHistoryView", () => {
  it("lists each task's changes per tracked folder, and the untracked folders for the 'not covered' line", async () => {
    await turn("t1", "a1", "x1");
    const view = await linkedHistoryView(
      scopes([entry({ key: "notes", path: notesDir }), entry({ key: "repos", path: "/code/repo", tracked: false }), entry({ key: "docs", path: "/docs", mode: "read", tracked: false })]),
      "app",
      DECLS,
      async () => notes,
    );
    expect(view).toEqual({
      uncovered: [{ key: "repos", label: "Repos" }],
      tasks: { t1: [{ key: "notes", label: "Notes", changes: [{ path: "x.md", kind: "modified" }] }] },
    });
  });

  it("a folder that gained git since it was linked is not covered", async () => {
    const view = await linkedHistoryView(scopes([entry({ key: "notes", path: notesDir, gitChanged: true })]), "app", DECLS, async () => notes);
    expect(view).toEqual({ uncovered: [{ key: "notes", label: "Notes" }], tasks: {} });
  });

  it("no scope or no links: empty", async () => {
    expect(await linkedHistoryView(scopes([]), null, DECLS, async () => notes)).toEqual({ uncovered: [], tasks: {} });
    expect(await linkedHistoryView(scopes([]), "app", DECLS, async () => notes)).toEqual({ uncovered: [], tasks: {} });
  });
});
