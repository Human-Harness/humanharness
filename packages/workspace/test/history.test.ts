import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

let folder: string;
let gitdir: string;
let history: History;

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
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
});
