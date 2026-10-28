import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FILE_INDEX_NAME, History } from "../src";

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
    fs.rmSync(indexFile());
    expect(await new History(folder, gitdir, [".harness/", "AGENTS.md"]).fileCommits("a.md")).toEqual([s1, s2]);
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  it("rebuilds an index that is not an index", async () => {
    write("a.md", "1");
    const s1 = (await history.save("Start"))!;
    fs.writeFileSync(indexFile(), "not json");
    expect(await history.fileCommits("a.md")).toEqual([s1]);
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
    fs.rmSync(indexFile());
    const [x, y] = await Promise.all([history.fileCommits("a.md"), history.fileCommits("a.md")]);
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
    expect(fs.existsSync(indexFile())).toBe(true);
  });

  it("tracks() is the history's own rule", () => {
    expect(history.tracks("a.md")).toBe(true);
    expect(history.tracks(".harness/tasks.json")).toBe(false);
    expect(history.tracks("AGENTS.md")).toBe(false);
  });
});
