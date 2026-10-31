import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitIgnore } from "@humanharness/search";
import { statPaths, walkRoot } from "../src/main/search/walk";

let root: string;
let outside: string;
const put = (rel: string, text = "x") => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-walk-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-out-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const rels = async (o = {}) => (await walkRoot(root, { max: 1000, ...o })).entries.map((e) => e.rel).sort();

describe("walkRoot (§8.1)", () => {
  it("leaves out denied paths and keeps notes, reviews and the person's files", async () => {
    for (const p of ["docs/a.md", ".env", "id_rsa", ".git/config", ".claude/x.md", ".harness/tasks.json", ".harness/notes/n.md", ".harness/reviews/docs/a.md.json", ".harness/data/main/t.json", "AGENTS.md", "CLAUDE.md"]) put(p);
    expect(await rels({ extraDenied: ["CLAUDE.md"] })).toEqual([".harness/notes/n.md", ".harness/reviews/docs/a.md.json", "docs/a.md"]);
  });

  it("skips the folders it is told to (the chats, indexed on their own)", async () => {
    put(".harness/chats/main.jsonl");
    put(".harness/notes/n.md");
    expect(await rels({ skipDirs: [".harness/chats"] })).toEqual([".harness/notes/n.md"]);
  });

  it("follows the root and nested .gitignore files", async () => {
    put(".gitignore", "*.log\nout/\n");
    put("sub/.gitignore", "local.txt\n");
    for (const p of ["a.log", "out/b.md", "keep.md", "sub/local.txt", "sub/other.txt", "node_modules/x/index.js"]) put(p);
    expect(await rels()).toEqual([".gitignore", "keep.md", "node_modules/x/index.js", "sub/.gitignore", "sub/other.txt"]);
  });

  it("uses the default list only when the root has no .gitignore", async () => {
    for (const p of ["node_modules/x/index.js", "dist/a.js", "src/a.ts"]) put(p);
    expect(await rels()).toEqual(["src/a.ts"]);
  });

  it("never follows a link: a link to a file is a name only, a link to a folder is not walked", async () => {
    fs.writeFileSync(path.join(outside, "secret.md"), "OUTSIDE");
    fs.mkdirSync(path.join(outside, "dir"));
    fs.writeFileSync(path.join(outside, "dir", "inner.md"), "OUTSIDE");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "link.md"));
    fs.symlinkSync(path.join(outside, "dir"), path.join(root, "linkdir"));
    const { entries } = await walkRoot(root, { max: 1000 });
    expect(entries.map((e) => [e.rel, e.link])).toEqual([
      ["link.md", true],
      ["linkdir", true],
    ]);
  });

  it("stops at the cap and says so", async () => {
    for (const p of ["a", "b", "c"]) put(p);
    const r = await walkRoot(root, { max: 2 });
    expect(r.entries).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});

describe("statPaths (a commit's paths)", () => {
  it("answers the files still there and allowed; the rest are missing", async () => {
    put(".gitignore", "*.log\n");
    put("a.md");
    put("b.log");
    put(".env");
    const { entries, missing } = await statPaths(root, ["a.md", "b.log", ".env", "gone.md", "../x"], {});
    expect(entries.map((e) => e.rel)).toEqual(["a.md"]);
    expect(missing.sort()).toEqual([".env", "b.log", "gone.md"]);
  });
});

describe("walkRoot, fail closed", () => {
  it("keeps the default list when only a nested folder has a .gitignore", async () => {
    put("sub/.gitignore", "local.txt\n");
    for (const p of ["node_modules/x/index.js", "sub/local.txt", "sub/dist/a.js", "src/a.ts"]) put(p);
    expect(await rels()).toEqual(["src/a.ts", "sub/.gitignore"]);
  });

  it("leaves a path out when the .gitignore check throws", async () => {
    put(".gitignore", "*.log\n");
    put("a.md");
    const spy = vi.spyOn(GitIgnore.prototype, "ignored").mockImplementation(() => {
      throw new RangeError("path should be a `path.relative()`d string");
    });
    try {
      expect(await rels()).toEqual([]);
      expect((await statPaths(root, ["a.md"], {})).missing).toEqual(["a.md"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("never walks the home folder, a dot-folder in it, or a link to one", async () => {
    const home = root;
    put(".ssh/id_x", "KEY");
    put(".claude/settings.json", "SECRET");
    put(".config/opencode/auth.json", "SECRET");
    put("work/a.md");
    fs.symlinkSync(path.join(home, ".claude"), path.join(outside, "claude-link"));
    for (const r of [home, path.join(home, ".ssh"), path.join(home, ".claude"), path.join(home, ".config", "opencode"), path.join(outside, "claude-link")]) {
      expect((await walkRoot(r, { max: 1000, home })).entries).toEqual([]);
    }
    expect((await statPaths(path.join(home, ".claude"), ["settings.json"], { home })).entries).toEqual([]);
    expect((await walkRoot(path.join(home, "work"), { max: 1000, home })).entries.map((e) => e.rel)).toEqual(["a.md"]);
  });
});
