import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import type { LinkedHistoryView } from "@humanharness/ui/client";
import { ScopeStore, scopesFile } from "@humanharness/workspace";
import { type LinkSigning, linkTag, linkTagValid, linkedSigning, registerLinkedIpc, signedLinks } from "../src/main/linked-ipc";
import { linkedHistoryDir } from "../src/main/linked-history";
import { folderProblem } from "../src/main/validate";

// As linked-folders.test.ts: on macOS the temporary folder is under /private, where every link is refused.
const tmpBase = (() => {
  const t = fs.realpathSync(os.tmpdir());
  if (folderProblem(path.join(t, "x"), path.join(t, "home")) === null) return t;
  const cache = path.resolve(__dirname, "../node_modules/.cache");
  fs.mkdirSync(cache, { recursive: true });
  return fs.realpathSync(cache);
})();
const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, "hh-linkipc-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const mk = (p: string) => (fs.mkdirSync(p, { recursive: true }), p);

const DECLS: Record<string, LinkedFolderDecl> = {
  repos: { label: "Repositories", mode: "write", history: "auto", many: true },
  docs: { label: "Docs", mode: "read", history: "auto", many: false },
  site: { label: "Site", mode: "write", history: "auto", many: false },
  mirror: { label: "Mirror", mode: "read", history: "own", many: false },
  vendor: { label: "Vendor", mode: "write", history: "own", many: false },
};

let n = 0;
type Other = { profile: string; store: ScopeStore };
/** One base of an app; `userData` shared means the same app (another profile), `profile` its id ("" without). */
function setup(
  over: {
    picks?: (string | null)[];
    references?: string[];
    unsupported?: boolean;
    other?: Other[];
    userData?: string;
    profile?: string;
    checkGit?: (scope: string) => Promise<unknown>;
    linkedHistory?: () => Promise<LinkedHistoryView>;
  } = {},
) {
  const t = mk(path.join(root, `t${n++}`));
  const home = mk(path.join(t, "home"));
  const work = mk(path.join(home, "Documents", "Work"));
  const userData = over.userData ?? mk(path.join(t, "userData"));
  const code = mk(path.join(home, "code"));
  const store = new ScopeStore(work, () => new Date("2026-10-28T10:00:00.000Z"));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const picks = [...(over.picks ?? [])];
  const pick = vi.fn(async () => (picks.length > 0 ? picks.shift()! : null));
  const changed = vi.fn(async () => {});
  const app = linkedSigning(userData);
  const secret = vi.fn((create: boolean) => app.secret(create));
  const signing: LinkSigning = { secret, live: app.live };
  const profile = over.profile ?? "";
  registerLinkedIpc((ch, fn) => void handlers.set(ch, fn as (...args: unknown[]) => unknown), {
    linkedFolders: DECLS,
    store: async () => store,
    profile: async () => profile,
    otherStores: async () => over.other ?? [],
    context: async () => ({ home, folder: work }),
    references: async () => over.references ?? [],
    pick,
    userData,
    signing,
    now: () => new Date("2026-10-28T10:00:00.000Z"),
    ready: Promise.resolve(),
    changed,
    unsupported: () => over.unsupported ?? false,
    ...(over.checkGit ? { checkGit: over.checkGit } : {}),
    ...(over.linkedHistory ? { linkedHistory: over.linkedHistory } : {}),
  });
  const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!(...args));
  const raw = () => fs.readFileSync(scopesFile(work), "utf8");
  return { t, home, work, userData, code, store, handlers, pick, changed, secret, signing, profile, call, raw };
}

describe("linked folders IPC (hatches spec §3.2)", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(async () => {
    s = setup();
    await s.store.create("App");
    await s.store.create("Other");
  });

  it("registers exactly the five channels and reads no key while registering", () => {
    expect([...s.handlers.keys()].sort()).toEqual(["hh:linkedHistory", "hh:scopeConfirmGit", "hh:scopeLinkFolder", "hh:scopeLinked", "hh:scopeUnlinkFolder"]);
    expect(s.secret).not.toHaveBeenCalled();
  });

  it("a path argument is ignored; the picker always opens (L1)", async () => {
    const repo = mk(path.join(s.code, "app"));
    const t = setup({ picks: [repo] });
    await t.store.create("App");
    const got = await t.call("hh:scopeLinkFolder", "app", "repos", "/etc");
    expect(t.pick).toHaveBeenCalledTimes(1);
    expect(got).toEqual({ linked: { key: "repos", label: "Repositories", path: fs.realpathSync.native(repo), mode: "write", tracked: true } });
  });

  it("refuses an undeclared key, an unknown or archived scope, a too-long id (L9)", async () => {
    await s.store.setArchived("other", true);
    await expect(s.call("hh:scopeLinkFolder", "app", "nope")).rejects.toThrow(/Unknown linked folder kind/);
    await expect(s.call("hh:scopeLinkFolder", "app", "__proto__")).rejects.toThrow(/Unknown linked folder kind/);
    await expect(s.call("hh:scopeLinkFolder", "app", "constructor")).rejects.toThrow(/Unknown linked folder kind/);
    await expect(s.call("hh:scopeLinkFolder", "app", "r".repeat(65))).rejects.toThrow(/Unknown linked folder kind/);
    await expect(s.call("hh:scopeLinkFolder", "x".repeat(65), "repos")).rejects.toThrow(/Unknown scope/);
    await expect(s.call("hh:scopeLinkFolder", "missing", "repos")).rejects.toThrow(/Unknown scope/);
    await expect(s.call("hh:scopeLinkFolder", "other", "repos")).rejects.toThrow(/Unknown scope/);
    await expect(s.call("hh:scopeLinked", { id: "app" })).rejects.toThrow(/Unknown scope/);
    expect(s.pick).not.toHaveBeenCalled();
  });

  it("answers the refusal reason, linking nothing", async () => {
    const before = s.raw();
    s.pick.mockImplementationOnce(async () => mk(path.join(s.home, ".claude")));
    expect(await s.call("hh:scopeLinkFolder", "app", "repos")).toEqual({ refused: "engine-home" });
    expect(s.raw()).toBe(before);
    expect(s.changed).not.toHaveBeenCalled();
  });

  it("a cancelled picker links nothing and answers null", async () => {
    const before = s.raw();
    expect(await s.call("hh:scopeLinkFolder", "app", "repos")).toBeNull();
    expect(s.raw()).toBe(before);
    expect(s.changed).not.toHaveBeenCalled();
  });

  it("one folder per key unless many: refused 'one-only' before the picker opens", async () => {
    const a = mk(path.join(s.code, "site-a"));
    s.pick.mockImplementationOnce(async () => a);
    expect(await s.call("hh:scopeLinkFolder", "app", "site")).toMatchObject({ linked: { key: "site" } });
    expect(await s.call("hh:scopeLinkFolder", "app", "site")).toEqual({ refused: "one-only" });
    expect(s.pick).toHaveBeenCalledTimes(1);
  });

  it("links: stores { key, path (real), mode, tracked, tag }, relinks an old history, calls changed()", async () => {
    const repo = mk(path.join(s.code, "app"));
    const dir = mk(linkedHistoryDir(s.userData, fs.realpathSync.native(repo)));
    fs.writeFileSync(path.join(dir, "unlinked-at"), "2026-10-01T00:00:00.000Z");
    // Picked through a link: the stored path is where it really is.
    const via = path.join(s.code, "via");
    fs.symlinkSync(repo, via);
    s.pick.mockImplementationOnce(async () => via);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    const [stored] = (await s.store.list())[0].linked ?? [];
    expect(stored).toMatchObject({ key: "repos", path: fs.realpathSync.native(repo), mode: "write", tracked: true });
    expect(stored.tag).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(dir, "unlinked-at"))).toBe(false);
    expect(s.changed).toHaveBeenCalledTimes(1);
  });

  it("a git folder is linked untracked; history 'own' refuses a folder without git", async () => {
    const git = mk(path.join(s.code, "withgit"));
    execFileSync("git", ["init", "-q", git]);
    s.pick.mockImplementationOnce(async () => git);
    expect(await s.call("hh:scopeLinkFolder", "app", "repos")).toMatchObject({ linked: { tracked: false } });
    s.pick.mockImplementationOnce(async () => mk(path.join(s.code, "plain")));
    expect(await s.call("hh:scopeLinkFolder", "app", "mirror")).toEqual({ refused: "not-git" });
  });

  it("other scopes' write folders are refused; their read folders are not", async () => {
    const w = mk(path.join(s.code, "w"));
    const r = mk(path.join(s.code, "r"));
    s.pick.mockImplementationOnce(async () => w);
    await s.call("hh:scopeLinkFolder", "other", "repos");
    s.pick.mockImplementationOnce(async () => r);
    await s.call("hh:scopeLinkFolder", "other", "docs");
    s.pick.mockImplementationOnce(async () => w);
    expect(await s.call("hh:scopeLinkFolder", "app", "repos")).toEqual({ refused: "other-scope-write" });
    s.pick.mockImplementationOnce(async () => r);
    expect(await s.call("hh:scopeLinkFolder", "app", "repos")).toMatchObject({ linked: { key: "repos" } });
  });

  it("another profile's write folder, or one inside or around it, is refused too", async () => {
    const x = setup({ profile: "ana" });
    await x.store.create("App");
    const w = mk(path.join(x.code, "w"));
    x.pick.mockImplementationOnce(async () => w);
    await x.call("hh:scopeLinkFolder", "app", "repos");
    // The same app (userData): the other profile's links were signed with this app's key, for profile "ana".
    const y = setup({ profile: "bo", userData: x.userData, other: [{ profile: "ana", store: x.store }] });
    await y.store.create("App");
    y.pick.mockImplementationOnce(async () => w);
    expect(await y.call("hh:scopeLinkFolder", "app", "repos")).toEqual({ refused: "other-scope-write" });
    y.pick.mockImplementationOnce(async () => mk(path.join(w, "inner")));
    expect(await y.call("hh:scopeLinkFolder", "app", "repos")).toEqual({ refused: "other-scope-write" });
    // Read links may overlap.
    y.pick.mockImplementationOnce(async () => mk(path.join(w, "inner")));
    expect(await y.call("hh:scopeLinkFolder", "app", "docs")).toMatchObject({ linked: { key: "docs" } });
  });

  it("refuses a write link equal to or inside a reference folder; a read link there is fine", async () => {
    const ref = mk(path.join(s.code, "ref"));
    const t = setup({ references: [ref] });
    await t.store.create("App");
    t.pick.mockImplementation(async () => mk(path.join(ref, "inner")));
    expect(await t.call("hh:scopeLinkFolder", "app", "repos")).toEqual({ refused: "reference" });
    t.pick.mockImplementation(async () => ref);
    expect(await t.call("hh:scopeLinkFolder", "app", "site")).toEqual({ refused: "reference" });
    expect(await t.call("hh:scopeLinkFolder", "app", "docs")).toMatchObject({ linked: { key: "docs", mode: "read" } });
  });

  it("unlink removes only a stored entry, marks its history unlinked, never touches the folder", async () => {
    const repo = mk(path.join(s.code, "app"));
    fs.writeFileSync(path.join(repo, "file.txt"), "kept");
    const real = fs.realpathSync.native(repo);
    const dir = mk(linkedHistoryDir(s.userData, real));
    s.pick.mockImplementationOnce(async () => repo);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    await expect(s.call("hh:scopeUnlinkFolder", "app", "repos", path.join(s.code, "nope"))).rejects.toThrow(/Unknown linked folder/);
    await expect(s.call("hh:scopeUnlinkFolder", "app", "docs", real)).rejects.toThrow(/Unknown linked folder/);
    await s.call("hh:scopeUnlinkFolder", "app", "repos", real);
    expect("linked" in (await s.store.list())[0]).toBe(false);
    expect(fs.readFileSync(path.join(dir, "unlinked-at"), "utf8")).toBe("2026-10-28T10:00:00.000Z");
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf8")).toBe("kept");
  });

  it("unlink marks the history only when no other tracked link to the folder remains, in any profile", async () => {
    const repo = mk(path.join(s.code, "shared"));
    const real = fs.realpathSync.native(repo);
    const mark = path.join(mk(linkedHistoryDir(s.userData, real)), "unlinked-at");
    // Read in one scope, tracked in another: the read link doesn't keep the history.
    s.pick.mockImplementation(async () => repo);
    await s.call("hh:scopeLinkFolder", "other", "docs");
    await s.call("hh:scopeLinkFolder", "app", "repos");
    await s.call("hh:scopeUnlinkFolder", "app", "repos", real);
    expect(fs.existsSync(mark)).toBe(true);
    // Tracked here and in another profile of the same app (made before the picker refused it): unlinking there leaves it.
    fs.rmSync(mark);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    const t = setup({ userData: s.userData, profile: "bo", other: [{ profile: "", store: s.store }] });
    await t.store.create("App");
    const key = (await t.signing.secret(false))!;
    const e = { key: "repos", path: real, mode: "write" as const, tracked: true, nonce: "c".repeat(32) };
    await t.signing.live.change([JSON.stringify(["bo", "app", e.nonce])], []);
    await t.store.link("app", { ...e, tag: linkTag("bo", "app", e, key) });
    await t.call("hh:scopeUnlinkFolder", "app", "repos", real);
    expect(fs.existsSync(mark)).toBe(false);
  });

  it("link, unlink and confirm run one at a time: an unlink and a relink elsewhere never interleave", async () => {
    const repo = mk(path.join(s.code, "moved"));
    const real = fs.realpathSync.native(repo);
    const mark = path.join(mk(linkedHistoryDir(s.userData, real)), "unlinked-at");
    s.pick.mockImplementation(async () => repo);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    // Sent together: the unlink lands first, then the other scope links (and relinks) the folder.
    const [, linked] = await Promise.all([s.call("hh:scopeUnlinkFolder", "app", "repos", real), s.call("hh:scopeLinkFolder", "other", "repos")]);
    expect(linked).toMatchObject({ linked: { key: "repos", tracked: true } });
    expect(fs.existsSync(mark)).toBe(false);
  });

  it("confirmGit sets tracked as the person chose, re-signs, clears gitChanged; never tracked with git", async () => {
    const repo = mk(path.join(s.code, "app"));
    const real = fs.realpathSync.native(repo);
    s.pick.mockImplementationOnce(async () => repo);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    await s.store.markGitChanged("app", "repos", real);
    execFileSync("git", ["init", "-q", repo]);
    await expect(s.call("hh:scopeConfirmGit", "app", "repos", real, true)).rejects.toThrow(/can't be tracked/);
    await s.call("hh:scopeConfirmGit", "app", "repos", real, false);
    expect(await s.call("hh:scopeLinked", "app")).toEqual({
      folders: [{ key: "repos", label: "Repositories", path: real, mode: "write", tracked: false }],
      unsupported: false,
    });
    expect(fs.existsSync(path.join(linkedHistoryDir(s.userData, real), "unlinked-at"))).toBe(false); // no history dir: nothing marked
    fs.rmSync(path.join(repo, ".git"), { recursive: true });
    await s.call("hh:scopeConfirmGit", "app", "repos", real, true);
    expect((await s.call("hh:scopeLinked", "app")) as { folders: { tracked: boolean }[] }).toMatchObject({ folders: [{ tracked: true }] });
    await expect(s.call("hh:scopeConfirmGit", "app", "repos", real, "yes")).rejects.toThrow(/Invalid/);
  });

  it("confirmGit never tracks a folder of a history 'own' key, even once it lost its git", async () => {
    const repo = mk(path.join(s.code, "vendored"));
    execFileSync("git", ["init", "-q", repo]);
    const real = fs.realpathSync.native(repo);
    s.pick.mockImplementationOnce(async () => repo);
    expect(await s.call("hh:scopeLinkFolder", "app", "vendor")).toMatchObject({ linked: { tracked: false } });
    fs.rmSync(path.join(repo, ".git"), { recursive: true });
    await s.store.markGitChanged("app", "vendor", real);
    await expect(s.call("hh:scopeConfirmGit", "app", "vendor", real, true)).rejects.toThrow(/can't be tracked/);
    await s.call("hh:scopeConfirmGit", "app", "vendor", real, false);
    expect((await s.call("hh:scopeLinked", "app")) as { folders: unknown[] }).toMatchObject({ folders: [{ key: "vendor", tracked: false }] });
  });

  it("Scope settings opening runs the git check before listing, so a folder that gained git shows it (Decision 13)", async () => {
    const order: string[] = [];
    let store: ScopeStore | null = null;
    const t = setup({
      checkGit: async (scope) => {
        order.push(`check ${scope}`);
        const l = (await store!.list()).find((e) => e.id === scope)!.linked![0];
        await store!.markGitChanged(scope, l.key, l.path);
      },
    });
    store = t.store;
    await t.store.create("App");
    const repo = mk(path.join(t.code, "app"));
    t.pick.mockImplementationOnce(async () => repo);
    await t.call("hh:scopeLinkFolder", "app", "repos");
    expect(await t.call("hh:scopeLinked", "app")).toMatchObject({ folders: [{ key: "repos", gitChanged: true }] });
    expect(order).toEqual(["check app"]);
  });

  it("a failing git check still lists the links; an unknown scope never reaches the check (L9)", async () => {
    const checkGit = vi.fn(async () => {
      throw new Error("boom");
    });
    const t = setup({ checkGit });
    await t.store.create("App");
    expect(await t.call("hh:scopeLinked", "app")).toEqual({ folders: [], unsupported: false });
    await expect(t.call("hh:scopeLinked", "nope")).rejects.toThrow(/Unknown scope/);
    expect(checkGit).toHaveBeenCalledTimes(1);
  });

  it("hh:linkedHistory answers the open scope's view; nothing from the window is used", async () => {
    const view: LinkedHistoryView = { uncovered: [{ key: "repos", label: "Repositories" }], tasks: {} };
    const linkedHistory = vi.fn(async () => view);
    const t = setup({ linkedHistory });
    expect(await t.call("hh:linkedHistory", "other", "/etc")).toEqual(view);
    expect(linkedHistory).toHaveBeenCalledWith();
    expect(await s.call("hh:linkedHistory")).toEqual({ uncovered: [], tasks: {} });
  });

  it("hh:scopeLinked answers the scope's links, the declaration labels and the unsupported flag", async () => {
    const t = setup({ unsupported: true });
    await t.store.create("App");
    const d = mk(path.join(t.code, "d"));
    t.pick.mockImplementationOnce(async () => d);
    await t.call("hh:scopeLinkFolder", "app", "docs");
    expect(await t.call("hh:scopeLinked", "app")).toEqual({
      folders: [{ key: "docs", label: "Docs", path: fs.realpathSync.native(d), mode: "read", tracked: false }],
      unsupported: true,
    });
  });
});

describe("links the app didn't sign (scopes.json is in the agent's folder)", () => {
  const forge = (work: string, linked: unknown[]) => {
    const file = scopesFile(work);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw[0].linked = [...(raw[0].linked ?? []), ...linked];
    fs.writeFileSync(file, JSON.stringify(raw));
  };

  it("a link added without a tag, or with another scope's/path's/mode's tag, is not listed; a signed one is", async () => {
    const s = setup();
    await s.store.create("App");
    const good = mk(path.join(s.code, "good"));
    s.pick.mockImplementationOnce(async () => good);
    await s.call("hh:scopeLinkFolder", "app", "docs");
    const key = (await s.signing.secret(false))!;
    const claude = path.join(s.home, ".claude");
    // Every forged entry carries a nonce the app holds live for "app": only the tag is wrong.
    const nonce = "d".repeat(32);
    await s.signing.live.change([JSON.stringify(["", "app", nonce]), JSON.stringify(["", "other", nonce])], []);
    type E = { key: string; path: string; mode: "read" | "write"; tracked: boolean };
    const signed = (scope: string, e: E, profile = "") => linkTag(profile, scope, { ...e, nonce }, key);
    forge(s.work, [
      { key: "repos", path: claude, mode: "write", tracked: false, nonce },
      { key: "repos", path: "/x1", mode: "write", tracked: false, nonce, tag: signed("other", { key: "repos", path: "/x1", mode: "write", tracked: false }) },
      { key: "repos", path: "/x2", mode: "write", tracked: false, nonce, tag: signed("app", { key: "repos", path: "/elsewhere", mode: "write", tracked: false }) },
      { key: "repos", path: "/x3", mode: "write", tracked: false, nonce, tag: signed("app", { key: "repos", path: "/x3", mode: "read", tracked: false }) },
      { key: "repos", path: "/x4", mode: "write", tracked: true, nonce, tag: signed("app", { key: "repos", path: "/x4", mode: "write", tracked: false }) },
      { key: "repos", path: "/x5", mode: "write", tracked: false, nonce, tag: "0".repeat(64) },
      { key: "repos", path: "/x6", mode: "write", tracked: false, nonce, tag: signed("app", { key: "repos", path: "/x6", mode: "write", tracked: false }, "ana") },
      { key: "repos", path: "/x7", mode: "write", tracked: false, tag: signed("app", { key: "repos", path: "/x7", mode: "write", tracked: false }) },
    ]);
    const listed = (await s.call("hh:scopeLinked", "app")) as { folders: { path: string }[] };
    expect(listed.folders.map((f) => f.path)).toEqual([fs.realpathSync.native(good)]);
  });

  it("an unsigned link never counts: no 'one-only', no 'already-linked', dropped when the person links", async () => {
    const s = setup();
    await s.store.create("App");
    const site = mk(path.join(s.code, "site"));
    forge(s.work, [{ key: "site", path: site, mode: "write", tracked: true }]);
    s.pick.mockImplementationOnce(async () => site);
    expect(await s.call("hh:scopeLinkFolder", "app", "site")).toMatchObject({ linked: { key: "site" } });
    const linked = (await s.store.list())[0].linked ?? [];
    expect(linked).toHaveLength(1);
    expect(linkTagValid(linked[0], "", "app", (await s.signing.secret(false))!, await s.signing.live.read())).toBe(true);
  });

  it("an unsigned link can't be unlinked or confirmed through the window (it isn't there)", async () => {
    const s = setup();
    await s.store.create("App");
    forge(s.work, [{ key: "repos", path: "/forged", mode: "write", tracked: true }]);
    await expect(s.call("hh:scopeUnlinkFolder", "app", "repos", "/forged")).rejects.toThrow(/Unknown linked folder/);
    await expect(s.call("hh:scopeConfirmGit", "app", "repos", "/forged", false)).rejects.toThrow(/Unknown linked folder/);
  });

  it("without a key nothing is valid, and listing never makes one", async () => {
    const s = setup();
    await s.store.create("App");
    forge(s.work, [{ key: "repos", path: "/forged", mode: "write", tracked: true, tag: "a".repeat(64) }]);
    expect(await s.call("hh:scopeLinked", "app")).toEqual({ folders: [], unsupported: false });
    expect(s.secret.mock.calls).toEqual([[false]]);
    expect(fs.existsSync(path.join(s.userData, "linked-key"))).toBe(false);
    expect(fs.existsSync(path.join(s.userData, "linked-live.json"))).toBe(false);
    expect(linkTagValid({ key: "repos", path: "/x", mode: "write", tracked: true, tag: "a", nonce: "a".repeat(32) }, "", "app", null, new Set())).toBe(false);
  });

  it("an unlinked entry pasted back is not listed: its nonce is no longer live (no replay)", async () => {
    const s = setup();
    await s.store.create("App");
    const repo = mk(path.join(s.code, "app"));
    s.pick.mockImplementationOnce(async () => repo);
    await s.call("hh:scopeLinkFolder", "app", "repos");
    const old = (await s.store.list())[0].linked ?? [];
    await s.call("hh:scopeUnlinkFolder", "app", "repos", old[0].path);
    forge(s.work, old);
    expect(await s.call("hh:scopeLinked", "app")).toEqual({ folders: [], unsupported: false });
    expect(await signedLinks((await s.store.list())[0], "", s.signing)).toEqual([]);
    // The live set is the app's own file, beside the key, owner-only.
    if (process.platform !== "win32") expect(fs.statSync(path.join(s.userData, "linked-live.json")).mode & 0o777).toBe(0o600);
  });

  it("a link signed in profile X, copied into profile Y's scopes.json under the same scope id, is not listed in Y", async () => {
    const x = setup({ profile: "ana" });
    await x.store.create("App");
    x.pick.mockImplementationOnce(async () => mk(path.join(x.code, "repo")));
    await x.call("hh:scopeLinkFolder", "app", "repos");
    const y = setup({ profile: "bo", userData: x.userData });
    await y.store.create("App");
    // Its nonce is live for (ana, app), and its tag is valid for ana: neither holds for bo.
    forge(y.work, (await x.store.list())[0].linked ?? []);
    expect(await y.call("hh:scopeLinked", "app")).toEqual({ folders: [], unsupported: false });
    expect((await x.call("hh:scopeLinked", "app")) as { folders: unknown[] }).toMatchObject({ folders: [{ key: "repos" }] });
  });
});
