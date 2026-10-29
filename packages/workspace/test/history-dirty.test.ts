import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("a file that vanishes mid-scan (another turn's temp file)", () => {
  afterEach(() => vi.restoreAllMocks());
  /** Lets statusMatrix list the folder, then deletes `rel` before History reads it. */
  const vanishAfterListing = (rel: string) => {
    const real = git.statusMatrix.bind(git);
    vi.spyOn(git, "statusMatrix").mockImplementation(async (args) => {
      const matrix = await real(args);
      fs.rmSync(path.join(folder, rel), { force: true });
      return matrix;
    });
  };

  it("a new file: reported as deleted by dirtyState and changedSince, no throw", async () => {
    write("tmp.md", "t");
    vanishAfterListing("tmp.md");
    expect((await history.dirtyState()).get("tmp.md")).toBeNull();
    write("tmp.md", "t");
    expect(await history.changedSince(null)).toEqual(["tmp.md"]);
  });

  it("a tracked file listed unchanged: reported as deleted, no throw", async () => {
    vanishAfterListing("a.md");
    const state = await history.dirtyState();
    expect(state.has("a.md")).toBe(true);
    expect(state.get("a.md")).toBeNull();
    write("a.md", "a0");
    expect(await history.changedSince(null)).toEqual(["a.md"]);
  });

  it("any other read error is still thrown", async () => {
    write("tmp.md", "t");
    const realOpen = fs.promises.open;
    vi.spyOn(fs.promises, "open").mockImplementation(((file: unknown, ...rest: unknown[]) =>
      String(file).endsWith("tmp.md")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : (realOpen as (...a: unknown[]) => Promise<unknown>)(file, ...rest)) as typeof fs.promises.open);
    await expect(history.dirtyState()).rejects.toThrow("denied");
  });
});

describe("a dirty file's blob id", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is git's, streamed: a file too large for readFile still hashes", async () => {
    const content = "x".repeat(200_000);
    write("big.md", content);
    // readFile refuses a file over 2 GB; stand in for one without writing it.
    const realRead = fs.promises.readFile;
    vi.spyOn(fs.promises, "readFile").mockImplementation(((file: unknown, ...rest: unknown[]) =>
      String(file).endsWith("big.md")
        ? Promise.reject(Object.assign(new Error("File size is greater than 2 GiB"), { code: "ERR_FS_FILE_TOO_LARGE" }))
        : (realRead as (...a: unknown[]) => Promise<unknown>)(file, ...rest)) as typeof fs.promises.readFile);
    const state = await history.dirtyState();
    expect(state.get("big.md")).toBe((await git.hashBlob({ object: content })).oid);
  });

  it("an empty file and a link hash as git hashes them", async () => {
    write("empty.md", "");
    fs.symlinkSync("a.md", path.join(folder, "l.md"));
    const state = await history.dirtyState();
    expect(state.get("empty.md")).toBe((await git.hashBlob({ object: "" })).oid);
    expect(state.get("l.md")).toBe((await git.hashBlob({ object: "a.md" })).oid);
  });
});

describe("save when a file vanishes between listing and staging", () => {
  afterEach(() => vi.restoreAllMocks());
  /** Lets statusMatrix list the folder, then runs `change` before History stages anything. */
  const afterListing = (change: () => void) => {
    const real = git.statusMatrix.bind(git);
    vi.spyOn(git, "statusMatrix").mockImplementationOnce(async (args) => {
      const matrix = await real(args);
      change();
      return matrix;
    });
  };

  it("a tracked file listed as modified: committed as deleted, no throw", async () => {
    write("a.md", "a1");
    write("b.md", "b1");
    afterListing(() => fs.rmSync(path.join(folder, "a.md")));
    const sha = await history.save("Turn");
    expect(sha).not.toBeNull();
    expect(await history.readFileAt(sha, "a.md")).toBeNull();
    expect(await history.readFileAt(sha, "b.md")).toBe("b1");
  });

  it("a new file: never committed; nothing else changed means no commit", async () => {
    const head = await history.last();
    write("tmp.md", "t");
    afterListing(() => fs.rmSync(path.join(folder, "tmp.md")));
    expect(await history.save("Turn")).toBeNull();
    expect(await history.last()).toBe(head);
  });

  it("a folder in its place: the file is committed as deleted, nothing under the folder is staged", async () => {
    write("a.md", "a1");
    afterListing(() => {
      fs.rmSync(path.join(folder, "a.md"));
      write("a.md/x.md", "x");
    });
    const sha = await history.save("Turn");
    expect(await history.readFileAt(sha, "a.md")).toBeNull();
    expect(await history.readFileAt(sha, "a.md/x.md")).toBeNull();
  });

  it("commitPaths too", async () => {
    write("a.md", "a1");
    afterListing(() => fs.rmSync(path.join(folder, "a.md")));
    const sha = await history.commitPaths(["a.md"], "Turn: own", { task: "t1" });
    expect(await history.readFileAt(sha, "a.md")).toBeNull();
  });
});
