import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("reads trailers only from a last paragraph made of trailer lines", () => {
    expect(parseCommitMessage("Turn: a\n\nSome body text\nTask: t1")).toEqual({ subject: "Turn: a", task: null, action: null });
    expect(parseCommitMessage("Turn: a\n\nTask: t1\nSigned-off-by: x")).toEqual({ subject: "Turn: a", task: null, action: null });
    expect(parseCommitMessage("Turn: a\n\nAction: plan\nTask: t1")).toEqual({ subject: "Turn: a", task: "t1", action: "plan" });
  });
});

describe("History.tasks", () => {
  const withNotes = () => new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);

  it("groups commits by task, newest task first, with the files each task changed; Other changes last", async () => {
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

  it("starts a task at its first turn's snapshot, so going back keeps the person's own earlier edits", async () => {
    write("a.md", "1");
    await history.save("Start");
    write("mine.md", "user edit");
    const before = (await history.save("Before message", { task: "t1" }))!;
    write("ai.md", "ai");
    await history.save("Turn: write", { task: "t1" });

    const [t1] = await history.tasks();
    expect(t1.start).toBe(before);
    expect(t1.changes).toEqual([{ path: "ai.md", kind: "added" }]);
    expect(t1.entries.map((e) => e.message)).toEqual(["Turn: write", "Before message"]);
    await history.restore(t1.start!, "Went back to before the task", { task: "t1" });
    expect(read("mine.md")).toBe("user edit");
    expect(fs.existsSync(path.join(folder, "ai.md"))).toBe(false);
  });

  it("finds the start of a task whose first commits are past the depth", async () => {
    write("x.md", "x");
    const base = (await history.save("Start"))!;
    write("a.md", "a");
    await history.save("Turn: a", { task: "t1" });
    write("b.md", "b");
    await history.save("Turn: b", { task: "t1" });
    write("c.md", "c");
    await history.save("Turn: c", { task: "t1" });

    const [t1] = await history.tasks(2);
    expect(t1.entries.map((e) => e.message)).toEqual(["Turn: c", "Turn: b"]);
    expect(t1.start).toBe(base);
    expect(t1.changes.map((c) => c.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("applies the snapshot rule to a task's true first commit past the depth", async () => {
    write("x.md", "x");
    await history.save("Start");
    write("mine.md", "user edit");
    const before = (await history.save("Before message", { task: "t1" }))!;
    write("a.md", "a");
    await history.save("Turn: a", { task: "t1" });
    write("b.md", "b");
    await history.save("Turn: b", { task: "t1" });

    const [t1] = await history.tasks(1);
    expect(t1.start).toBe(before);
    expect(t1.changes.map((c) => c.path)).toEqual(["a.md", "b.md"]);
  });

  it("groups interleaved commits by task id, from before the task's first commit to its last", async () => {
    write("x.md", "x");
    const base = (await history.save("Start"))!;
    write("a.md", "a");
    const first = (await history.save("Turn: a", { task: "t1" }))!;
    write("u.md", "u");
    const between = (await history.save("Start"))!;
    write("b.md", "b");
    const last = (await history.save("Turn: b", { task: "t1" }))!;

    const groups = await history.tasks();
    expect(groups.map((g) => g.taskId)).toEqual(["t1", null]);
    const [t1, earlier] = groups;
    expect(t1.entries.map((e) => e.sha)).toEqual([last, first]);
    expect(t1).toMatchObject({ start: base, end: last });
    expect(t1.changes.map((c) => c.path)).toEqual(["a.md", "b.md", "u.md"]);
    expect(earlier.entries.map((e) => e.sha)).toEqual([between, base]);
  });

  it("reports a file replaced by a folder, and a folder replaced by a file", async () => {
    write("x", "file");
    write("y/inner.md", "inner");
    await history.save("Start");
    fs.rmSync(path.join(folder, "x"));
    write("x/new.md", "new");
    fs.rmSync(path.join(folder, "y"), { recursive: true });
    write("y", "file");
    await history.save("Turn: swap", { task: "t1" });

    const [t1] = await history.tasks();
    expect(t1.changes).toEqual([
      { path: "x", kind: "deleted" },
      { path: "x/new.md", kind: "added" },
      { path: "y", kind: "added" },
      { path: "y/inner.md", kind: "deleted" },
    ]);
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

describe.skipIf(process.platform === "win32")("History restore and symlinks", () => {
  let outside: string;
  beforeEach(() => {
    outside = fs.mkdtempSync(path.join(root, "outside-"));
  });
  const link = (rel: string) => path.join(folder, rel);

  it("restores a file link as a link and never writes to what it points to", async () => {
    const target = path.join(outside, "target.txt");
    fs.writeFileSync(target, "keep");
    fs.symlinkSync(target, link("mine.md"));
    const before = (await history.save("before"))!;
    await history.save("turn");

    await history.restore(before, "undo");
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
    expect(fs.lstatSync(link("mine.md")).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link("mine.md"))).toBe(target);
  });

  it("puts a re-pointed link back without touching the file it now points to", async () => {
    const target = path.join(outside, "target.txt");
    const victim = path.join(outside, "victim.txt");
    fs.writeFileSync(target, "keep");
    fs.writeFileSync(victim, "secret");
    fs.symlinkSync(target, link("mine.md"));
    const before = (await history.save("before"))!;
    fs.rmSync(link("mine.md"));
    fs.symlinkSync(victim, link("mine.md"));

    await history.restore(before, "undo");
    expect(fs.readFileSync(victim, "utf8")).toBe("secret");
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
    expect(fs.readlinkSync(link("mine.md"))).toBe(target);
  });

  it("replaces a link with the regular file the restore point had, leaving its target alone", async () => {
    const victim = path.join(outside, "victim.txt");
    fs.writeFileSync(victim, "secret");
    write("a.md", "1");
    const before = (await history.save("before"))!;
    fs.rmSync(link("a.md"));
    fs.symlinkSync(victim, link("a.md"));

    await history.restore(before, "undo");
    expect(fs.readFileSync(victim, "utf8")).toBe("secret");
    expect(fs.lstatSync(link("a.md")).isFile()).toBe(true);
    expect(read("a.md")).toBe("1");
  });

  it("removes a link the restore point didn't have, not its target", async () => {
    const victim = path.join(outside, "victim.txt");
    fs.writeFileSync(victim, "secret");
    const before = (await history.save("before"))!;
    fs.symlinkSync(victim, link("new.md"));

    await history.restore(before, "undo");
    expect(fs.readFileSync(victim, "utf8")).toBe("secret");
    expect(() => fs.lstatSync(link("new.md"))).toThrow();
  });

  it("writes nothing through a linked folder that leads outside", async () => {
    const h = new History(folder, gitdir, [".harness/"], [".harness/notes/"]);
    write(".harness/notes/n.md", "note");
    const before = (await h.save("before"))!;
    fs.rmSync(link(".harness/notes"), { recursive: true });
    fs.symlinkSync(outside, link(".harness/notes"));

    expect((await h.restoreReport(before, "undo")).skipped).toEqual([".harness/notes/n.md"]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("goes from a real folder to a link to it and back without writing outside", async () => {
    write("d/x.md", "mine");
    const real = (await history.save("real"))!;
    fs.rmSync(link("d"), { recursive: true });
    fs.symlinkSync(outside, link("d"));
    const linked = (await history.save("linked"))!;

    expect((await history.restoreReport(real, "back")).skipped).toEqual([]);
    expect(fs.lstatSync(link("d")).isDirectory()).toBe(true);
    expect(read("d/x.md")).toBe("mine");
    expect(fs.readdirSync(outside)).toEqual([]);

    expect((await history.restoreReport(linked, "forth")).skipped).toEqual([]);
    expect(fs.readlinkSync(link("d"))).toBe(outside);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("recreates a folder link over a real folder of the same name, leaving the outside file alone", async () => {
    fs.writeFileSync(path.join(outside, "x.md"), "keep");
    fs.symlinkSync(outside, link("d"));
    const before = (await history.save("linked"))!;
    fs.rmSync(link("d"));
    write("d/x.md", "mine");
    await history.save("real");

    await history.restore(before, "undo");
    expect(fs.readlinkSync(link("d"))).toBe(outside);
    expect(fs.readFileSync(path.join(outside, "x.md"), "utf8")).toBe("keep");
  });

  it("keeps the exec bit when it recreates a file", async () => {
    write("run.sh", "echo");
    fs.chmodSync(link("run.sh"), 0o755);
    const before = (await history.save("before"))!;
    fs.rmSync(link("run.sh"));

    await history.restore(before, "undo");
    expect(fs.statSync(link("run.sh")).mode & 0o111).not.toBe(0);
  });

  it("restores when the folder itself is reached through a link", async () => {
    const real = fs.mkdtempSync(path.join(root, "real-"));
    const viaLink = path.join(outside, "folder-link");
    fs.symlinkSync(real, viaLink);
    const h = new History(viaLink, path.join(real, "..", `${path.basename(real)}.git`));
    await h.init();
    fs.writeFileSync(path.join(real, "a.md"), "1");
    fs.mkdirSync(path.join(real, "dir"));
    fs.writeFileSync(path.join(real, "dir", "b.md"), "b");
    const before = (await h.save("before"))!;
    fs.writeFileSync(path.join(real, "a.md"), "2");
    fs.rmSync(path.join(real, "dir"), { recursive: true });

    expect((await h.restoreReport(before, "undo")).skipped).toEqual([]);
    expect(fs.readFileSync(path.join(real, "a.md"), "utf8")).toBe("1");
    expect(fs.readFileSync(path.join(real, "dir", "b.md"), "utf8")).toBe("b");
  });

  it("skips a file or link whose place is now a folder, and restores the rest", async () => {
    write("a.md", "1");
    write("b.md", "1");
    fs.symlinkSync("b.md", link("l"));
    const before = (await history.save("before"))!;
    fs.rmSync(link("a.md"));
    fs.rmSync(link("l"));
    write("a.md/.DS_Store", "x");
    write("l/.DS_Store", "x");
    write("b.md", "2");

    const { sha, skipped } = await history.restoreReport(before, "undo");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(skipped).toEqual(["a.md", "l"]);
    expect(read("b.md")).toBe("1");
    expect(fs.lstatSync(link("a.md")).isDirectory()).toBe(true);
  });

  it("skips a link it can't create and restores the rest", async () => {
    fs.symlinkSync("b.md", link("l"));
    write("b.md", "1");
    const before = (await history.save("before"))!;
    fs.rmSync(link("l"));
    write("b.md", "2");
    const spy = vi.spyOn(fs.promises, "symlink").mockRejectedValue(Object.assign(new Error("EPERM"), { code: "EPERM" }));
    try {
      const { skipped } = await history.restoreReport(before, "undo");
      expect(skipped).toEqual(["l"]);
      expect(read("b.md")).toBe("1");
    } finally {
      spy.mockRestore();
    }
  });

  it("skips a file whose folder is swapped for a link right after it is made", async () => {
    write("d/x.md", "mine");
    const before = (await history.save("before"))!;
    fs.rmSync(link("d"), { recursive: true });
    const mkdir = fs.promises.mkdir.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, "mkdir").mockImplementation(async (dir, options) => {
      const made = await mkdir(dir, options);
      if (dir === link("d")) {
        fs.rmdirSync(link("d"));
        fs.symlinkSync(outside, link("d"));
      }
      return made;
    });
    try {
      const { skipped } = await history.restoreReport(before, "undo");
      expect(skipped).toEqual(["d/x.md"]);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("sees a changed link target as a change", async () => {
    fs.symlinkSync("a", link("l"));
    await history.save("before");
    fs.rmSync(link("l"));
    fs.symlinkSync("b", link("l"));
    expect(await history.save("after")).toMatch(/^[0-9a-f]{40}$/);
    expect(await history.save("again")).toBeNull();
  });
});
