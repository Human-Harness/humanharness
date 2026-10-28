import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import { type LinkedFolderEntry, type ScopeEntry, ScopeStore, scopesFile } from "@humanharness/workspace";
import { type LinkSigning, linkedSigning, registerLinkedIpc } from "../src/main/linked-ipc";
import { LinkedInstructions, checkGitChanges, createScopeAccess, linkedLines, linkedSection, scopeAccessFor } from "../src/main/scope-access";
import { folderProblem } from "../src/main/validate";

const entries: ScopeEntry[] = [
  {
    id: "app",
    title: "App",
    createdAt: "",
    archived: false,
    linked: [
      { key: "repos", path: "/code/app", mode: "write" as const, tracked: false },
      { key: "notes", path: "/notes", mode: "write" as const, tracked: true, gitChanged: true as const },
    ],
  },
  { id: "other", title: "Other", createdAt: "", archived: false, linked: [{ key: "repos", path: "/code/other", mode: "write" as const, tracked: false }] },
];
const decl: Record<string, LinkedFolderDecl> = {
  repos: { label: "Repos", mode: "write", history: "auto", many: true },
  notes: { label: "Notes", mode: "write", history: "auto", many: false },
};

describe("scopeAccessFor (L5)", () => {
  it("only the turn's scope's folders", () => {
    expect(scopeAccessFor(entries, "app", decl)).toEqual({
      linked: [
        { path: "/code/app", mode: "write", tracked: false },
        { path: "/notes", mode: "write", tracked: true },
      ],
    });
  });
  it("_app, an unknown scope and no links give undefined (no TurnScope at all)", () => {
    expect(scopeAccessFor(entries, "_app", decl)).toBeUndefined();
    expect(scopeAccessFor(entries, "nope", decl)).toBeUndefined();
    expect(scopeAccessFor([{ id: "x", title: "X", createdAt: "", archived: false }], "x", decl)).toBeUndefined();
  });
  it("a key the manifest no longer declares is left out", () => {
    expect(scopeAccessFor(entries, "app", { repos: decl.repos })?.linked.map((l) => l.path)).toEqual(["/code/app"]);
  });
  it("the mode comes from the manifest now, not the stored entry; a read folder is never tracked", () => {
    const now = { ...decl, notes: { ...decl.notes, mode: "read" as const } };
    expect(scopeAccessFor(entries, "app", now)?.linked[1]).toEqual({ path: "/notes", mode: "read", tracked: false });
  });
  it("an archived scope gives undefined", () => {
    expect(scopeAccessFor([{ ...entries[0], archived: true }], "app", decl)).toBeUndefined();
  });
});

describe("linkedLines", () => {
  it("the managed section's lines, with the manifest's labels", () => {
    expect(linkedLines(entries, "app", decl)).toEqual([
      { key: "repos", label: "Repos", path: "/code/app", mode: "write" },
      { key: "notes", label: "Notes", path: "/notes", mode: "write" },
    ]);
    expect(linkedLines(entries, null, decl)).toEqual([]);
  });
  it("linkedSection prints the managed section's part; nothing for no lines", () => {
    const text = linkedSection(linkedLines(entries, "app", decl));
    expect(text.split("\n")[0]).toBe("### Folders of this scope");
    expect(text).toContain("- `repos` (Repos, read and write): `/code/app`");
    expect(linkedSection([])).toBe("");
  });
});

describe("checkGitChanges (Decision 13)", () => {
  const fake = (linked: LinkedFolderEntry[]) => {
    const marked: string[] = [];
    return {
      marked,
      store: {
        list: async (): Promise<ScopeEntry[]> => [{ id: "app", title: "App", createdAt: "", archived: false, linked }],
        markGitChanged: async (_id: string, _key: string, folder: string) => {
          marked.push(folder);
          return { id: "app", title: "App", createdAt: "", archived: false };
        },
      },
    };
  };
  const all = (s: ScopeEntry) => s.linked ?? [];

  it("a tracked write folder that now has git gets gitChanged; one already marked and a read one are left alone", async () => {
    const f = fake([
      { key: "repos", path: "/a", mode: "write", tracked: true },
      { key: "repos", path: "/b", mode: "write", tracked: true, gitChanged: true },
      { key: "docs", path: "/c", mode: "read", tracked: false },
      { key: "repos", path: "/d", mode: "write", tracked: false },
    ]);
    const isGit = vi.fn(async (dir: string) => dir !== "/e");
    expect(await checkGitChanges(f.store, "app", isGit, all)).toBe(true);
    expect(f.marked).toEqual(["/a"]);
    expect(isGit.mock.calls.map((c) => c[0])).toEqual(["/a", "/d"]);
  });

  it("a git folder that lost its git gets gitChanged", async () => {
    const f = fake([{ key: "repos", path: "/d", mode: "write", tracked: false }]);
    expect(await checkGitChanges(f.store, "app", async () => false, all)).toBe(true);
    expect(f.marked).toEqual(["/d"]);
  });

  it("only signed links are looked at: a hand-written path is never read", async () => {
    const f = fake([{ key: "repos", path: "/home/me/.claude", mode: "write", tracked: true }]);
    const isGit = vi.fn(async () => true);
    expect(await checkGitChanges(f.store, "app", isGit, () => [])).toBe(false);
    expect(isGit).not.toHaveBeenCalled();
  });
});

// As linked-ipc.test.ts: on macOS the temporary folder is under /private, where every link is refused.
const tmpBase = (() => {
  const t = fs.realpathSync(os.tmpdir());
  if (folderProblem(path.join(t, "x"), path.join(t, "home")) === null) return t;
  const cache = path.resolve(__dirname, "../node_modules/.cache");
  fs.mkdirSync(cache, { recursive: true });
  return fs.realpathSync(cache);
})();
const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, "hh-scopeaccess-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const mk = (p: string) => (fs.mkdirSync(p, { recursive: true }), p);

const DECLS: Record<string, LinkedFolderDecl> = {
  repos: { label: "Repositories", mode: "write", history: "auto", many: true },
  docs: { label: "Docs", mode: "read", history: "auto", many: false },
};

let n = 0;
/** One app: links made through the real IPC (picker answers `picks`), read back through `createScopeAccess`. */
function setup(over: { references?: string[]; other?: { profile: string; store: ScopeStore }[] } = {}) {
  const t = mk(path.join(root, `t${n++}`));
  const home = mk(path.join(t, "home"));
  const work = mk(path.join(home, "Documents", "Work"));
  const userData = mk(path.join(t, "userData"));
  const code = mk(path.join(home, "code"));
  const store = new ScopeStore(work, () => new Date("2026-10-28T10:00:00.000Z"));
  const app = linkedSigning(userData);
  const secret = vi.fn((create: boolean) => app.secret(create));
  const signing: LinkSigning = { secret, live: app.live };
  const picks: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const references = { list: over.references ?? [] };
  const base = {
    linkedFolders: DECLS,
    store: async () => store,
    profile: async () => "",
    otherStores: vi.fn(async () => over.other ?? []),
    context: async () => ({ home, folder: work }),
    references: async () => references.list,
    signing,
  };
  registerLinkedIpc((ch, fn) => void handlers.set(ch, fn as (...args: unknown[]) => unknown), {
    ...base,
    pick: async () => picks.shift() ?? null,
    userData,
    now: () => new Date("2026-10-28T10:00:00.000Z"),
    ready: Promise.resolve(),
    changed: async () => {},
    unsupported: () => false,
  });
  const log = vi.fn();
  const access = createScopeAccess({ ...base, log });
  const link = async (scope: string, key: string, folder: string) => {
    picks.push(folder);
    return handlers.get("hh:scopeLinkFolder")!(scope, key);
  };
  const unlink = (scope: string, key: string, folder: string) => handlers.get("hh:scopeUnlinkFolder")!(scope, key, folder);
  const readFile = () => ({ scopes: JSON.parse(fs.readFileSync(scopesFile(work), "utf8")) as ScopeEntry[] });
  const writeFile = (v: { scopes: ScopeEntry[] }) => fs.writeFileSync(scopesFile(work), JSON.stringify(v.scopes));
  return { t, home, work, code, store, secret, access, log, link, unlink, readFile, writeFile, references, otherStores: base.otherStores };
}

describe("createScopeAccess: only signed, live, still valid links (L1, L2, L5)", () => {
  it("D0: a scope without links reads no key, no other profile and no folder", async () => {
    const s = setup();
    await s.store.create("App");
    expect(await s.access.access("app")).toBeUndefined();
    expect(await s.access.lines("app")).toEqual([]);
    expect(await s.access.section("app")).toBe("");
    expect(await s.access.checkGit("app")).toBe(false);
    expect(s.secret).not.toHaveBeenCalled();
    expect(s.otherStores).not.toHaveBeenCalled();
  });

  it("a signed link reaches the turn, the lines and the section", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    const docs = fs.realpathSync.native(mk(path.join(s.code, "docs")));
    await s.link("app", "repos", repo);
    await s.link("app", "docs", docs);
    expect(await s.access.access("app")).toEqual({
      linked: [
        { path: repo, mode: "write", tracked: true },
        { path: docs, mode: "read", tracked: false },
      ],
    });
    expect(await s.access.lines("app")).toEqual([
      { key: "repos", label: "Repositories", path: repo, mode: "write" },
      { key: "docs", label: "Docs", path: docs, mode: "read" },
    ]);
    expect(await s.access.section("app")).toContain(`- \`docs\` (Docs, read only): \`${docs}\``);
    expect(s.secret.mock.calls.every(([create]) => create === true || create === false)).toBe(true);
    expect(s.log).not.toHaveBeenCalled();
  });

  it("L5: another scope's folders never reach this scope's turn; no scope or _app gives none", async () => {
    const s = setup();
    await s.store.create("App");
    await s.store.create("Other");
    const other = fs.realpathSync.native(mk(path.join(s.code, "other")));
    await s.link("other", "repos", other);
    expect(await s.access.access("app")).toBeUndefined();
    expect(await s.access.access("_app")).toBeUndefined();
    expect(await s.access.lines(null)).toEqual([]);
    expect((await s.access.access("other"))?.linked.map((l) => l.path)).toEqual([other]);
  });

  it("a hand-added link (no tag, ~/.claude, a comma path) never reaches the turn, and reads none of them", async () => {
    const s = setup();
    await s.store.create("App");
    const claude = mk(path.join(s.home, ".claude"));
    const comma = mk(path.join(s.code, "a,b"));
    const file = s.readFile();
    file.scopes[0].linked = [
      { key: "repos", path: claude, mode: "write", tracked: false },
      { key: "repos", path: comma, mode: "write", tracked: false, tag: "0".repeat(64), nonce: "1".repeat(32) },
    ];
    s.writeFile(file);
    expect(await s.access.access("app")).toBeUndefined();
    expect(await s.access.lines("app")).toEqual([]);
    expect(await s.access.checkGit("app")).toBe(false);
  });

  it("a signed entry copied into another scope, or pasted back after its unlink, never counts (L1)", async () => {
    const s = setup();
    await s.store.create("App");
    await s.store.create("Other");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    await s.link("app", "repos", repo);
    const signed = s.readFile().scopes[0].linked![0];
    // Copied into another scope: the tag binds the scope.
    const copied = s.readFile();
    copied.scopes[1].linked = [signed];
    s.writeFile(copied);
    expect(await s.access.access("other")).toBeUndefined();
    // Unlinked, then pasted back: its nonce is no longer live.
    await s.unlink("app", "repos", repo);
    const pasted = s.readFile();
    pasted.scopes[0].linked = [signed];
    s.writeFile(pasted);
    expect(await s.access.access("app")).toBeUndefined();
  });

  it("a missing folder is dropped with one log line, never a throw, and the others stay", async () => {
    const s = setup();
    await s.store.create("App");
    const gone = fs.realpathSync.native(mk(path.join(s.code, "gone")));
    const kept = fs.realpathSync.native(mk(path.join(s.code, "kept")));
    await s.link("app", "repos", gone);
    await s.link("app", "repos", kept);
    fs.rmSync(gone, { recursive: true });
    expect((await s.access.access("app"))?.linked.map((l) => l.path)).toEqual([kept]);
    expect((await s.access.lines("app")).map((l) => l.path)).toEqual([kept]);
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.log.mock.calls[0][0]).toContain(gone);
  });

  it("a folder swapped for a link since it was linked is dropped (it no longer resolves to the stored path)", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    const elsewhere = mk(path.join(s.code, "elsewhere"));
    await s.link("app", "repos", repo);
    fs.rmSync(repo, { recursive: true });
    fs.symlinkSync(elsewhere, repo);
    expect(await s.access.access("app")).toBeUndefined();
    expect(s.log.mock.calls[0][0]).toMatch(/moved/);
  });

  it("a folder swapped for a link into ~/.claude is refused again (L2)", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    const claude = mk(path.join(s.home, ".claude"));
    await s.link("app", "repos", repo);
    fs.rmSync(repo, { recursive: true });
    fs.symlinkSync(claude, repo);
    expect(await s.access.access("app")).toBeUndefined();
    expect(s.log.mock.calls[0][0]).toMatch(/engine-home/);
  });

  it("a write folder now inside a reference is dropped (its rules would be read only)", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    await s.link("app", "repos", repo);
    s.references.list = [s.code];
    expect(await s.access.access("app")).toBeUndefined();
    expect(s.log.mock.calls[0][0]).toMatch(/reference/);
  });

  it("the log line is said once per folder and reason", async () => {
    const s = setup();
    await s.store.create("App");
    const gone = fs.realpathSync.native(mk(path.join(s.code, "gone")));
    await s.link("app", "repos", gone);
    fs.rmSync(gone, { recursive: true });
    await s.access.access("app");
    await s.access.access("app");
    await s.access.lines("app");
    expect(s.log).toHaveBeenCalledTimes(1);
  });

  it("checkGit marks a tracked signed folder that gained git", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = fs.realpathSync.native(mk(path.join(s.code, "app")));
    await s.link("app", "repos", repo);
    mk(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await s.access.checkGit("app")).toBe(true);
    expect(s.readFile().scopes[0].linked![0].gitChanged).toBe(true);
    // Still signed (gitChanged is not part of the tag): the turn keeps it, tracked until the person confirms.
    expect(await s.access.access("app")).toEqual({ linked: [{ path: repo, mode: "write", tracked: true }] });
  });
});

describe("LinkedInstructions (AGENTS.md between tasks)", () => {
  const make = (o: { open?: string | null; refresh?: () => Promise<boolean>; noTask?: boolean } = {}) => {
    const state = { open: o.open ?? null };
    const refresh = vi.fn(o.refresh ?? (async () => true));
    const log = vi.fn();
    const li = new LinkedInstructions({
      whenNoTask: async (fn) => {
        if (o.noTask === false) return false;
        await fn();
        return true;
      },
      refresh,
      openScope: async () => state.open,
      log,
    });
    return { li, refresh, log, state };
  };

  it("a link change with no task open rewrites at once", async () => {
    const m = make();
    await m.li.changed();
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await m.li.betweenTasks();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("a change while a task is open waits for betweenTasks", async () => {
    const m = make({ noTask: false });
    await m.li.changed();
    expect(m.refresh).not.toHaveBeenCalled();
    await m.li.betweenTasks();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("a refresh a running turn refused stays stale and is retried between tasks", async () => {
    let refuse = true;
    const m = make({
      refresh: async () => {
        if (refuse) throw new Error("A turn is running");
        return true;
      },
    });
    await m.li.changed();
    expect(m.log).toHaveBeenCalledTimes(1);
    refuse = false;
    await m.li.betweenTasks();
    expect(m.refresh).toHaveBeenCalledTimes(2);
    await m.li.betweenTasks();
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("a scope switch since AGENTS.md was written rewrites it between tasks", async () => {
    const m = make({ open: "a" });
    m.li.wrote("a");
    await m.li.betweenTasks();
    expect(m.refresh).not.toHaveBeenCalled();
    m.state.open = "b";
    await m.li.betweenTasks();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("never rejects", async () => {
    const m = make({ refresh: async () => Promise.reject(new Error("boom")) });
    await expect(m.li.changed()).resolves.toBeUndefined();
    await expect(m.li.betweenTasks()).resolves.toBeUndefined();
  });
});
