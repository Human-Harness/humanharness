import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import git from "isomorphic-git";
import { History, parseCommitMessage, withTrailer } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
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

describe("History", () => {
  it("keeps the git data outside the user folder", async () => {
    write("a.md", "1");
    await history.save("first");
    expect(fs.existsSync(path.join(folder, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(gitdir, "HEAD"))).toBe(true);
  });

  it("commits changes and skips empty saves", async () => {
    write("a.md", "1");
    const sha = await history.save("first");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await history.save("nothing")).toBeNull();
    expect(await history.last()).toBe(sha);
  });

  it("commits an empty folder once so there is always a base", async () => {
    expect(await history.save("start")).toMatch(/^[0-9a-f]{40}$/);
    expect(await history.save("again")).toBeNull();
  });

  it("restores modified, deleted and new files", async () => {
    write("a.md", "1");
    write("dir/b.md", "b");
    const before = (await history.save("before"))!;
    write("a.md", "2");
    fs.rmSync(path.join(folder, "dir/b.md"));
    write("c.md", "new");
    await history.save("agent turn");

    await history.restore(before, "undo");

    expect(read("a.md")).toBe("1");
    expect(read("dir/b.md")).toBe("b");
    expect(fs.existsSync(path.join(folder, "c.md"))).toBe(false);
  });

  it("restores uncommitted changes too", async () => {
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write("a.md", "half-written");
    await history.restore(before, "undo");
    expect(read("a.md")).toBe("1");
  });

  it("never tracks ignored paths", async () => {
    write(".harness/session.json", "{}");
    write("AGENTS.md", "generated");
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write(".harness/session.json", '{"changed":true}');
    await history.restore(before, "undo");
    expect(read(".harness/session.json")).toBe('{"changed":true}');
    expect(read("AGENTS.md")).toBe("generated");
  });

  it("lists entries newest first", async () => {
    write("a.md", "1");
    await history.save("one");
    write("a.md", "2");
    await history.save("two");
    const entries = await history.list();
    expect(entries.map((e) => e.message)).toEqual(["two", "one"]);
    expect(entries[0].date).toBeInstanceOf(Date);
  });

  it("detects a same-size rewrite right after a save", async () => {
    write("a.md", "1");
    expect(await history.save("one")).not.toBeNull();
    write("a.md", "2");
    expect(await history.save("two")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("restore leaves unchanged files untouched", async () => {
    write("a.md", "1");
    write("b.md", "b");
    const before = (await history.save("before"))!;
    const old = new Date("2020-01-01T00:00:00Z");
    fs.utimesSync(path.join(folder, "b.md"), old, old);
    write("a.md", "2");
    await history.restore(before, "undo");
    expect(read("a.md")).toBe("1");
    expect(fs.statSync(path.join(folder, "b.md")).mtime.getTime()).toBe(old.getTime());
  });

  it("restore never writes ignored paths from old commits", async () => {
    const loose = new History(folder, gitdir, []);
    write(".harness/session.json", "old");
    write("a.md", "1");
    const old = (await loose.save("with ignored"))!;
    write(".harness/session.json", "current");
    await history.restore(old, "undo");
    expect(read(".harness/session.json")).toBe("current");
  });

  it("restore prunes directories it empties but keeps the root", async () => {
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write("x/y/z.md", "z");
    await history.save("more");
    await history.restore(before, "undo");
    expect(fs.existsSync(path.join(folder, "x"))).toBe(false);
    expect(fs.existsSync(folder)).toBe(true);
    const empty = (await history.list()).at(-1)!.sha;
    await history.restore(empty, "back");
    expect(fs.existsSync(folder)).toBe(true);
  });

  it("serializes overlapping save and restore", async () => {
    write("a.md", "1");
    const before = (await history.save("before"))!;
    write("a.md", "2");
    write("c.md", "new");
    const [saved, restored] = await Promise.all([history.save("turn"), history.restore(before, "undo")]);
    expect(saved).not.toBeNull();
    expect(restored).not.toBeNull();
    expect(read("a.md")).toBe("1");
    expect(fs.existsSync(path.join(folder, "c.md"))).toBe(false);
    expect(await history.save("noop")).toBeNull();
  });

  it("tracks the notes under .harness/ and nothing else there", async () => {
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);
    write(".harness/notes/turn.md", "note");
    write(".harness/chats/main.jsonl", "chat");
    write("mine.md", "mine");
    const sha = (await h.save("with a note"))!;
    fs.rmSync(path.join(folder, ".harness/notes/turn.md"));
    write(".harness/chats/main.jsonl", "changed");
    await h.restore(sha, "back");
    expect(read(".harness/notes/turn.md")).toBe("note");
    expect(read(".harness/chats/main.jsonl")).toBe("changed");
  });

  it("keeps the person's own .tmp files but not the notes' temp files", async () => {
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);
    write("draft.tmp", "mine");
    write(".harness/notes/turn.md.0b7c2f1e-1111-4222-8333-944455556666.tmp", "partial");
    await h.save("tmp files");
    const files = await git.listFiles({ fs, gitdir, ref: "HEAD" });
    expect(files).toContain("draft.tmp");
    expect(files.some((f) => f.startsWith(".harness/notes/") && f.endsWith(".tmp"))).toBe(false);
  });
});

describe("History trailers", () => {
  it("writes the task and the action as trailers and reads them back", async () => {
    write("a.md", "1");
    const sha = (await history.save("Turn: plan the week", { task: "t-1", action: "plan" }))!;
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha });
    expect(commit.message.trim()).toBe("Turn: plan the week\n\nTask: t-1\nAction: plan");
    const [entry] = await history.list();
    expect(entry).toMatchObject({ sha, message: "Turn: plan the week", task: "t-1", action: "plan" });
  });

  it("leaves commits outside a task without trailers", async () => {
    write("a.md", "1");
    await history.save("Start");
    expect((await history.list())[0]).toMatchObject({ message: "Start", task: null, action: null });
  });

  it("tags a restore with the task it went back to", async () => {
    write("a.md", "1");
    const before = (await history.save("Start"))!;
    write("a.md", "2");
    await history.save("Turn: edit", { task: "t-1" });
    await history.restore(before, "Went back to before the task", { task: "t-1" });
    expect((await history.list())[0]).toMatchObject({ message: "Went back to before the task", task: "t-1", action: null });
    expect(read("a.md")).toBe("1");
  });

  it("keeps the subject on one line and refuses ids that could forge a trailer", async () => {
    write("a.md", "1");
    await history.save("Turn: hi\n\nTask: forged", { task: "bad id\nAction: x" });
    expect((await history.list())[0]).toMatchObject({ message: "Turn: hi Task: forged", task: null, action: null });
  });

  it("builds and parses messages", () => {
    expect(withTrailer("Note: x", { task: "t1" })).toBe("Note: x\n\nTask: t1");
    expect(withTrailer("Start")).toBe("Start");
    expect(parseCommitMessage("Note: x\n\nTask: t1\nAction: plan\n")).toEqual({ subject: "Note: x", task: "t1", action: "plan" });
    expect(parseCommitMessage("Start")).toEqual({ subject: "Start", task: null, action: null });
    expect(parseCommitMessage("Turn: a\n\nTask: two words")).toEqual({ subject: "Turn: a", task: null, action: null });
  });
});

describe("History.tasks", () => {
  const withNotes = () => new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);

  it("groups commits by task, newest task first, with the files each task changed; Earlier last", async () => {
    const h = withNotes();
    await h.init();
    write("a.md", "1");
    write("b.md", "b");
    const base = (await h.save("Start"))!;
    write("a.md", "2");
    write("c.md", "new");
    await h.save("Turn: first", { task: "t1", action: "plan" });
    write(".harness/notes/plan.md", "note");
    write(".harness/chats/main.jsonl", "chat");
    await h.save("Note: The plan", { task: "t1", action: "plan" });
    fs.rmSync(path.join(folder, "b.md"));
    const t2end = (await h.save("Turn: second", { task: "t2" }))!;

    const groups = await h.tasks();
    expect(groups.map((g) => g.taskId)).toEqual(["t2", "t1", null]);
    const [t2, t1, earlier] = groups;
    expect(t2).toMatchObject({ actionId: null, end: t2end, changes: [{ path: "b.md", kind: "deleted" }] });
    expect(t2.date).toBeInstanceOf(Date);
    expect(t1.start).toBe(base);
    expect(t1.actionId).toBe("plan");
    expect(t1.changes).toEqual([
      { path: ".harness/notes/plan.md", kind: "added" },
      { path: "a.md", kind: "modified" },
      { path: "c.md", kind: "added" },
    ]);
    expect(t1.entries.map((e) => e.message)).toEqual(["Note: The plan", "Turn: first"]);
    expect(earlier).toMatchObject({ taskId: null, actionId: null, start: null, end: base });
    expect(earlier.changes).toEqual([
      { path: "a.md", kind: "added" },
      { path: "b.md", kind: "added" },
    ]);
  });

  it("puts a restore in the group of the task it went back to, which then changed nothing", async () => {
    write("a.md", "1");
    const base = (await history.save("Start"))!;
    write("a.md", "2");
    await history.save("Turn: edit", { task: "t1" });
    write("b.md", "b");
    await history.save("Turn: other", { task: "t2" });
    const t1 = (await history.tasks()).find((g) => g.taskId === "t1")!;
    expect(t1.start).toBe(base);
    await history.restore(t1.start!, "Went back to before the task", { task: "t1" });

    const groups = await history.tasks();
    expect(groups.map((g) => g.taskId)).toEqual(["t1", "t2", null]);
    expect(groups[0].entries[0].message).toBe("Went back to before the task");
    expect(groups[0].changes).toEqual([]);
    expect(read("a.md")).toBe("1");
    expect(fs.existsSync(path.join(folder, "b.md"))).toBe(false);
  });

  it("reads a commit's trailer", async () => {
    write("a.md", "1");
    const tagged = (await history.save("Turn: x", { task: "t1", action: "plan" }))!;
    write("a.md", "2");
    const plain = (await history.save("Start"))!;
    expect(await history.trailerOf(tagged)).toEqual({ task: "t1", action: "plan" });
    expect(await history.trailerOf(plain)).toBeNull();
  });

  it("lists the files it tracks now", async () => {
    const h = withNotes();
    await h.init();
    write("a.md", "1");
    write("dir/b.md", "b");
    write(".harness/notes/n.md", "n");
    write(".harness/chats/main.jsonl", "c");
    write("AGENTS.md", "generated");
    expect((await h.trackedFiles()).sort()).toEqual([".harness/notes/n.md", "a.md", "dir/b.md"]);
  });
});
