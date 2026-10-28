import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { folderProblem } from "../src/main/validate";
import { checkLink, isGitRepo, linkRefusal } from "../src/main/linked-folders";

// On macOS the temporary folder is under /private, a system folder every link would be refused in: the tree goes
// under the package's node_modules (ignored by git) when that happens.
const tmpBase = (() => {
  const t = fs.realpathSync(os.tmpdir());
  if (folderProblem(path.join(t, "x"), path.join(t, "home")) === null) return t;
  const cache = path.resolve(__dirname, "../node_modules/.cache");
  fs.mkdirSync(cache, { recursive: true });
  return fs.realpathSync(cache);
})();
const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, "hh-link-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const home = path.join(root, "home");
const work = path.join(home, "Documents", "Work");
const mk = (p: string) => (fs.mkdirSync(p, { recursive: true }), p);
mk(work);
const ctx = (over: Partial<Parameters<typeof linkRefusal>[1]> = {}) => ({
  home, folder: work, root: undefined, sameScope: [], otherScopesWrite: [], mode: "write" as const, history: "auto" as const, isGit: false, ...over,
});

describe("linkRefusal (hatches spec §3.2)", () => {
  it.each([
    ["~/.claude", path.join(home, ".claude"), "engine-home"],
    ["inside ~/.codex", path.join(home, ".codex", "x"), "engine-home"],
    ["~/.gemini", path.join(home, ".gemini"), "engine-home"],
    ["~/.config/opencode", path.join(home, ".config", "opencode"), "engine-home"],
    ["a dot folder in home (~/.ssh)", path.join(home, ".ssh"), "engine-home"],
    ["the home folder", home, "home"],
    ["the main folder", work, "main-folder"],
    ["inside the main folder", path.join(work, "sub"), "main-folder"],
    ["a folder that contains the main folder", path.join(home, "Documents"), "too-broad"],
    ["a folder above the main folder", path.join(home, "Documents", "x", ".."), "too-broad"],
    ["/", "/", "system"],
    ["/usr", "/usr/local/x", "system"],
    ["/System", "/System/Library", "system"],
    ["/Applications", "/Applications/X.app", "system"],
    ["a comma in the path", path.join(home, "code", "a,b"), "comma"],
  ])("refuses %s", (_n, p, why) => {
    expect(linkRefusal(p, ctx())).toBe(why);
  });

  it("refuses a folder that contains the main folder but is not a standard one", () => {
    expect(linkRefusal(path.join(home, "code"), ctx({ folder: path.join(home, "proj", "Work") }))).toBeNull();
    expect(linkRefusal(path.join(home, "proj"), ctx({ folder: path.join(home, "proj", "Work") }))).toBe("main-folder");
  });

  it("refuses another scope's write folder, but not its read folder", () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(repo, ctx({ otherScopesWrite: [repo] }))).toBe("other-scope-write");
    expect(linkRefusal(repo, ctx())).toBeNull();
  });

  it("refuses nesting with a link of the same scope, both ways", () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(path.join(repo, "pkg"), ctx({ sameScope: [repo] }))).toBe("nested");
    expect(linkRefusal(path.join(home, "code"), ctx({ sameScope: [repo] }))).toBe("nested");
    expect(linkRefusal(repo, ctx({ sameScope: [repo] }))).toBe("already-linked");
  });

  it("refuses with profiles a folder inside the app root", () => {
    expect(linkRefusal(path.join(home, "Documents", "App", "ana"), ctx({ folder: path.join(home, "Documents", "App", "bo"), root: path.join(home, "Documents", "App") }))).toBe("main-folder");
  });

  it('history "own" needs git', () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(repo, ctx({ history: "own" }))).toBe("not-git");
    expect(linkRefusal(repo, ctx({ history: "own", isGit: true }))).toBeNull();
  });

  it("compares without case (macOS file systems)", () => {
    expect(linkRefusal(path.join(home, ".CLAUDE"), ctx())).toBe("engine-home");
    expect(linkRefusal(work.toUpperCase(), ctx())).toBe("main-folder");
  });
});

describe("checkLink (real paths)", () => {
  it("refuses through a symlink: a link to ~/.claude is refused as ~/.claude", async () => {
    mk(path.join(home, ".claude"));
    const link = path.join(home, "innocent");
    fs.symlinkSync(path.join(home, ".claude"), link);
    expect(await checkLink(link, { ...ctx(), mode: "write", history: "auto" })).toEqual({ refused: "engine-home" });
  });

  it("refuses through a symlink into the main folder", async () => {
    const link = path.join(home, "shortcut");
    fs.symlinkSync(work, link);
    expect(await checkLink(link, ctx())).toEqual({ refused: "main-folder" });
  });

  it("refuses through a symlink to another link of the same scope", async () => {
    const repo = mk(path.join(home, "code", "linked"));
    const link = path.join(home, "linked-alias");
    fs.symlinkSync(repo, link);
    expect(await checkLink(link, ctx({ sameScope: [repo] }))).toEqual({ refused: "already-linked" });
  });

  it("accepts a plain folder, stores its real path and tracks it (write, no git)", async () => {
    const plain = mk(path.join(home, "notes"));
    const link = path.join(home, "notes-link");
    fs.symlinkSync(plain, link);
    expect(await checkLink(link, ctx())).toEqual({ path: plain, tracked: true });
  });

  it("does not track a git folder, nor a read folder", async () => {
    const repo = mk(path.join(home, "code", "repo"));
    mk(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await checkLink(repo, ctx())).toEqual({ path: repo, tracked: false });
    expect(await checkLink(mk(path.join(home, "plain2")), ctx({ mode: "read" }))).toEqual({ path: path.join(home, "plain2"), tracked: false });
  });

  it('history "own" accepts a git folder and refuses a plain one, judged on the real folder', async () => {
    const repo = mk(path.join(home, "code", "own"));
    mk(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await checkLink(repo, ctx({ history: "own" }))).toEqual({ path: repo, tracked: false });
    expect(await checkLink(mk(path.join(home, "plain3")), ctx({ history: "own" }))).toEqual({ refused: "not-git" });
  });

  it("refuses a file, a missing folder and a relative path", async () => {
    const f = path.join(home, "file.txt");
    fs.writeFileSync(f, "x");
    expect(await checkLink(f, ctx())).toEqual({ refused: "not-folder" });
    expect(await checkLink(path.join(home, "missing"), ctx())).toEqual({ refused: "not-folder" });
    expect(await checkLink("notes", ctx())).toEqual({ refused: "not-folder" });
  });
});

describe("isGitRepo (Decision 3)", () => {
  it("a .git folder with HEAD, or a gitdir file, is git; a link at .git is not; nothing else is read", async () => {
    const a = mk(path.join(root, "g1"));
    mk(path.join(a, ".git"));
    fs.writeFileSync(path.join(a, ".git", "HEAD"), "ref: refs/heads/main\n");
    const b = mk(path.join(root, "g2"));
    fs.writeFileSync(path.join(b, ".git"), "gitdir: /elsewhere/.git/worktrees/b\n");
    const c = mk(path.join(root, "g3"));
    fs.symlinkSync(path.join(a, ".git"), path.join(c, ".git"));
    const d = mk(path.join(root, "g4"));
    mk(path.join(d, ".git"));
    const e = mk(path.join(root, "g5"));
    fs.writeFileSync(path.join(e, ".git"), "not a gitdir line\n");
    expect([await isGitRepo(a), await isGitRepo(b), await isGitRepo(c), await isGitRepo(d), await isGitRepo(e)]).toEqual([true, true, false, false, false]);
  });
});

describe("compliance (L8)", () => {
  it("the module never builds a path into an engine home to read it", async () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/main/linked-folders.ts"), "utf8");
    expect(src).not.toMatch(/readFile[^)]*\.(claude|codex)/);
    expect(src).not.toMatch(/homedir\(\)/);
  });
});
