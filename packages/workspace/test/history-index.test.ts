import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_INDEX_NAME, History, INDEX_WRITE_DELAY_MS, flushFileIndexes } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hidx-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const indexFile = () => path.join(gitdir, FILE_INDEX_NAME);

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
  await history.init();
});

describe("History's file index (file-timeline spec §3.3)", () => {
  it("each commit adds its changed paths; an approval adds the path it names", async () => {
    write("a.md", "1");
    write("b.md", "1");
    const s1 = (await history.save("Start"))!;
    write("a.md", "2");
    const s2 = (await history.save("Turn: edit", { task: "t1" }))!;
    write(".harness/reviews/a.md.json", "{}");
    const history2 = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/reviews/"]);
    const s3 = (await history2.save("Approved: a.md", { task: "t1" }))!;
    expect(await history2.fileCommits("a.md")).toEqual([s1, s2, s3]);
    expect(await history2.fileCommits("b.md")).toEqual([s1]);
    expect(await history2.fileCommits(".harness/reviews/a.md.json")).toEqual([s3]);
  });

  it("tells its listeners which paths each commit touched", async () => {
    const seen: { sha: string; paths: string[] }[] = [];
    const off = history.onCommit((c) => seen.push(c));
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    off();
    write("a.md", "2");
    await history.save("Turn: edit");
    expect(seen).toEqual([{ sha: s1, paths: ["a.md"] }]);
  });

  it("a failing listener neither fails the commit nor stops the others", async () => {
    const seen: string[] = [];
    history.onCommit(() => {
      throw new Error("boom");
    });
    history.onCommit((c) => seen.push(c.sha));
    write("a.md", "1");
    const s1 = await history.save("Start");
    expect(s1).not.toBeNull();
    expect(seen).toEqual([s1]);
  });

  it("rebuilds a missing index from the log", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    write("a.md", "2");
    const s2 = (await history.save("Turn: edit"))!;
    await history.flush();
    fs.rmSync(indexFile());
    const fresh = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    expect(await fresh.fileCommits("a.md")).toEqual([s1, s2]);
    await fresh.flush();
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  it("rebuilds an index that is not an index", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.writeFileSync(indexFile(), "not json");
    expect(await new History(folder, gitdir, [".harness/", "AGENTS.md"]).fileCommits("a.md")).toEqual([s1]);
  });

  it("a read after a commit sees it, even while a read started before the commit still runs", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.rmSync(indexFile(), { force: true });
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    await h.init();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = git.readCommit;
    const spy = vi.spyOn(git, "readCommit").mockImplementation(async (args) => {
      if (args.oid === s1) await gate;
      return real(args);
    });
    try {
      const before = h.fileCommits("a.md");
      await vi.waitFor(() => expect(spy.mock.calls.some(([a]) => a.oid === s1)).toBe(true));
      write("a.md", "2");
      const s2 = (await h.save("Turn: edit"))!;
      const after = h.fileCommits("a.md");
      release();
      expect(await before).toEqual([s1]);
      expect(await after).toEqual([s1, s2]);
    } finally {
      spy.mockRestore();
    }
  });

  it("an index file that can't be written fails no commit and costs one rebuild, not one per read", async () => {
    fs.mkdirSync(indexFile());
    write("a.md", "1");
    const s1 = await history.save("Start");
    expect(s1).not.toBeNull();
    write("a.md", "2");
    const s2 = await history.save("Turn: edit");
    expect(s2).not.toBeNull();
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    const spy = vi.spyOn(git, "readCommit");
    try {
      expect(await h.fileCommits("a.md")).toEqual([s1, s2]);
      const rebuild = spy.mock.calls.length;
      expect(rebuild).toBeGreaterThan(0);
      expect(await h.fileCommits("a.md")).toEqual([s1, s2]);
      // This History's own commits advance its index too.
      write("a.md", "3");
      const s3 = await h.save("Turn: again");
      spy.mockClear();
      expect(await h.fileCommits("a.md")).toEqual([s1, s2, s3]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("a rebuild indexes every changed path, whatever this History keeps", async () => {
    write("a.md", "1");
    await history.save("Start");
    write(".harness/reviews/a.md.json", "{}");
    const reviewing = new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/reviews/"]);
    const s2 = (await reviewing.save("Approved: a.md"))!;
    fs.rmSync(indexFile(), { force: true });
    expect(await new History(folder, gitdir, [".harness/", "AGENTS.md"]).fileCommits(".harness/reviews/a.md.json")).toEqual([s2]);
  });

  it("an async listener's rejection is caught; each listener gets its own paths", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const got: string[][] = [];
    history.onCommit(async (c) => {
      c.paths.push("changed.md");
      throw new Error("boom");
    });
    history.onCommit((c) => got.push(c.paths));
    write("a.md", "1");
    try {
      expect(await history.save("Start")).not.toBeNull();
      await vi.waitFor(() => expect(errors).toHaveBeenCalledWith("A commit listener failed", expect.any(Error)));
      expect(got).toEqual([["a.md"]]);
    } finally {
      errors.mockRestore();
    }
  });

  it("catches up on commits another History made on the same git data", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    const other = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    await other.init();
    write("a.md", "2");
    const s2 = (await other.save("Turn: edit"))!;
    // The index was written by `other` too: put back an index that stops at s1, as if `other` had failed to write it.
    fs.writeFileSync(indexFile(), JSON.stringify({ version: 1, head: s1, paths: { "a.md": [s1] } }));
    write("a.md", "3");
    const s3 = (await other.save("Turn: again"))!;
    expect(await history.fileCommits("a.md")).toEqual([s1, s2, s3]);
  });

  it("rebuilds when the index's head is not in this history (a history set aside after a move)", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.writeFileSync(indexFile(), JSON.stringify({ version: 1, head: "f".repeat(40), paths: { "a.md": ["f".repeat(40)] } }));
    expect(await history.fileCommits("a.md")).toEqual([s1]);
  });

  it("reads share one update; an empty history has no commits for any file", async () => {
    expect(await history.fileCommits("a.md")).toEqual([]);
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.rmSync(indexFile(), { force: true });
    const fresh = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    const [x, y] = await Promise.all([fresh.fileCommits("a.md"), fresh.fileCommits("a.md")]);
    expect(x).toEqual([s1]);
    expect(y).toEqual([s1]);
    expect(await history.fileCommits("__proto__")).toEqual([]);
  });

  it("D0: the index lives in the git data, never in the folder or in a commit; subjects stay as given", async () => {
    write("a.md", "1");
    await history.save("Start");
    write("a.md", "2");
    const sha = (await history.save("Turn: edit", { task: "t1" }))!;
    expect(fs.readdirSync(folder)).toEqual(["a.md"]);
    expect(await git.listFiles({ fs, gitdir, ref: sha })).toEqual(["a.md"]);
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha });
    expect(commit.message.trim()).toBe("Turn: edit\n\nTask: t1");
    await history.flush();
    expect(fs.existsSync(indexFile())).toBe(true);
    expect(fs.readdirSync(folder)).toEqual(["a.md"]);
  });

  it("a commit never waits for the index file: it is written later, in one go, or at once by flush", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    write("a.md", "2");
    const s2 = (await history.save("Turn: edit"))!;
    expect(fs.existsSync(indexFile())).toBe(false);
    // Reads use the index this History holds.
    expect(await history.fileCommits("a.md")).toEqual([s1, s2]);
    await vi.waitFor(() => expect(fs.existsSync(indexFile())).toBe(true), { timeout: INDEX_WRITE_DELAY_MS + 2000 });
    expect(JSON.parse(fs.readFileSync(indexFile(), "utf8"))).toEqual({ version: 1, head: s2, paths: { "a.md": [s1, s2] } });
    write("a.md", "3");
    const s3 = (await history.save("Turn: again"))!;
    await history.flush();
    expect(JSON.parse(fs.readFileSync(indexFile(), "utf8")).head).toBe(s3);
  });

  it("flushFileIndexes writes every History's pending index (the app quits, a folder moves)", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    expect(fs.existsSync(indexFile())).toBe(false);
    await flushFileIndexes();
    expect(JSON.parse(fs.readFileSync(indexFile(), "utf8")).head).toBe(s1);
  });

  it("an index rebuilt by a read is written off the read too, and a later History starts from it", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    await history.flush();
    fs.rmSync(indexFile());
    const h = new History(folder, gitdir, [".harness/", "AGENTS.md"]);
    expect(await h.fileCommits("a.md")).toEqual([s1]);
    await h.flush();
    const spy = vi.spyOn(git, "readCommit");
    try {
      expect(await new History(folder, gitdir, [".harness/", "AGENTS.md"]).fileCommits("a.md")).toEqual([s1]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("tracks() is the history's own rule", () => {
    expect(history.tracks("a.md")).toBe(true);
    expect(history.tracks(".harness/tasks.json")).toBe(false);
    expect(history.tracks("AGENTS.md")).toBe(false);
  });
});
