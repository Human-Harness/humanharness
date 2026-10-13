import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ConfigStore, historyDir } from "../src/main/config";
import { EngineGuards } from "../src/main/engine-guards";
import {
  type MoveDeps,
  type MoveDone,
  type MoveOps,
  MoveFailed,
  failureOf,
  guardedMove,
  hashFile,
  moveFolder,
  pruneReplaced,
  recoverMove,
  sameContents,
} from "../src/main/move-folder";
import { RestoreGuard } from "../src/main/restore-guard";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const errno = (code: string) => Object.assign(new Error(code), { code });
const OLD_TIME = new Date("2026-01-02T03:04:05Z");
/** A step that never finishes: the app was closed or crashed right there. */
const DONE: MoveDone = { oldRemoved: true, historyMoved: true };
const hang = () => new Promise<never>(() => {});

/** A folder with files, a note naming its absolute path, a history and a config pointing at it. */
async function setup(ops: Partial<MoveOps> = {}, extra: Partial<MoveDeps> = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const from = path.join(base, "home", "Documents", "Work");
  const to = path.join(base, "home", "Drive", "Work");
  const userData = path.join(base, "userData");
  const trashDir = path.join(base, "Trash");
  fs.mkdirSync(trashDir);
  fs.mkdirSync(path.join(from, "sub"), { recursive: true });
  fs.mkdirSync(path.join(from, ".harness", "notes"), { recursive: true });
  fs.mkdirSync(path.join(base, "home", "Drive"), { recursive: true });
  fs.writeFileSync(path.join(from, "a.md"), "1");
  fs.utimesSync(path.join(from, "a.md"), OLD_TIME, OLD_TIME);
  fs.writeFileSync(path.join(from, "sub", "b.md"), "b");
  fs.writeFileSync(path.join(from, "untracked.bin"), "AAAA");
  fs.writeFileSync(path.join(from, ".harness", "notes", "n.md"), `---\ntitle: "N"\nfiles: ["${from}/a.md"]\n---\n`);
  fs.writeFileSync(path.join(from, ".harness", "tasks.json"), "{}");
  const oldHistory = historyDir(userData, from);
  const newHistory = historyDir(userData, to);
  fs.mkdirSync(oldHistory, { recursive: true });
  fs.writeFileSync(path.join(oldHistory, "HEAD"), "ref: refs/heads/main\n");
  const config = new ConfigStore(userData);
  await config.save({ folder: from, language: "es" });
  const journal = path.join(userData, "move-journal.json");
  const trashed: string[] = [];
  const deps: MoveDeps = {
    check: async () => null,
    tracked: async () => ["a.md", "sub/b.md", ".harness/notes/n.md"],
    saveFolder: async (folder) => void (await config.replaceFolder(folder)),
    historyDir: (folder) => historyDir(userData, folder),
    journal,
    ops: {
      trash: async (p) => {
        trashed.push(p);
        await fs.promises.rename(p, path.join(trashDir, path.basename(p)));
      },
      ...ops,
    },
    now: () => 1234,
    ...extra,
  };
  const recoverDeps = { journal, currentFolder: async () => (await config.load()).folder, historyDir: deps.historyDir, now: () => 5678 };
  return { base, from, to, userData, config, oldHistory, newHistory, journal, trashed, trashDir, deps, recoverDeps };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof MoveFailed ? err.code : `not a MoveFailed: ${String(err)}`;
  }
  return "no error";
};

/** What is next to `to`: the temporary copies (`<to>.hh-moving-…`) must never stay behind. */
const siblings = (t: Setup) => fs.readdirSync(path.dirname(t.to)).filter((n) => n.startsWith(path.basename(t.to)));

/** Nothing changed: `from` and its history are where they were, `to` and its temporary copy don't exist, the config names `from`. */
async function untouched(t: Setup) {
  expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
  expect(fs.readFileSync(path.join(t.from, ".harness", "notes", "n.md"), "utf8")).toContain(`${t.from}/a.md`);
  expect(fs.existsSync(t.to)).toBe(false);
  expect(siblings(t)).toEqual([]);
  expect(fs.existsSync(path.join(t.oldHistory, "HEAD"))).toBe(true);
  expect((await t.config.load()).folder).toBe(t.from);
  expect(fs.existsSync(t.journal)).toBe(false);
  expect(t.trashed).toEqual([]);
}

/** The move went through: the files and the history are at `to` and the config names it. */
async function moved(t: Setup) {
  expect(fs.readFileSync(path.join(t.to, "sub", "b.md"), "utf8")).toBe("b");
  expect((await t.config.load()).folder).toBe(t.to);
  expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
  expect(fs.existsSync(t.oldHistory)).toBe(false);
  expect(siblings(t)).toEqual(["Work"]);
}

describe("moveFolder", () => {
  it("moves the folder with its history, makes the notes' old paths relative and puts the old folder in the Trash", async () => {
    const t = await setup();
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true, historyMoved: true });
    await moved(t);
    expect(fs.existsSync(t.from)).toBe(false);
    expect(t.trashed).toEqual([t.from]);
    expect(fs.readFileSync(path.join(t.trashDir, "Work", "a.md"), "utf8")).toBe("1");
    expect(fs.statSync(path.join(t.to, "a.md")).mtime.getTime()).toBe(OLD_TIME.getTime());
    expect(fs.readFileSync(path.join(t.to, ".harness", "notes", "n.md"), "utf8")).toContain('files: ["a.md"]');
    expect(fs.existsSync(path.join(t.to, ".harness", "tasks.json"))).toBe(true);
    expect(await t.config.load()).toEqual({ folder: t.to, language: "es" });
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("copies the links inside the folder as links and leaves what they point to alone", async () => {
    const t = await setup();
    const outside = path.join(t.base, "outside.txt");
    fs.writeFileSync(outside, "keep me");
    fs.symlinkSync("a.md", path.join(t.from, "near"));
    fs.symlinkSync(outside, path.join(t.from, "far"));
    fs.symlinkSync("sub", path.join(t.from, "dirlink"));
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true, historyMoved: true });
    expect(fs.readlinkSync(path.join(t.to, "near"))).toBe("a.md");
    expect(fs.readlinkSync(path.join(t.to, "far"))).toBe(outside);
    expect(fs.readlinkSync(path.join(t.to, "dirlink"))).toBe("sub");
    expect(fs.readFileSync(outside, "utf8")).toBe("keep me");
  });

  it("refuses a place inside the folder, or one the folder is inside", async () => {
    const t = await setup();
    expect(await code(moveFolder(t.from, path.join(t.from, "Inner"), t.deps))).toBe("inside");
    expect(await code(moveFolder(t.from, path.dirname(t.from), t.deps))).toBe("inside");
    await untouched(t);
  });

  it("refuses a place that is inside the folder through a link", async () => {
    const t = await setup();
    const link = path.join(t.base, "home", "Shortcut");
    fs.symlinkSync(t.from, link);
    expect(await code(moveFolder(t.from, path.join(link, "Inner"), t.deps))).toBe("inside");
    await untouched(t);
  });

  it("refuses to move a folder that is itself a link", async () => {
    const t = await setup();
    const link = path.join(t.base, "home", "LinkedWork");
    fs.symlinkSync(t.from, link);
    expect(await code(moveFolder(link, t.to, t.deps))).toBe("failed");
    await untouched(t);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("refuses a place that already exists", async () => {
    const t = await setup();
    fs.mkdirSync(t.to);
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("exists");
    expect(fs.readdirSync(t.to)).toEqual([]);
    expect((await t.config.load()).folder).toBe(t.from);
  });

  it("refuses a place the folder can't be (the first-launch check)", async () => {
    const t = await setup({}, { check: async () => "protected" });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("unsuitable");
    await untouched(t);
  });

  it("refuses when there isn't enough space with some to spare, before copying anything", async () => {
    const t = await setup({ freeBytes: async () => 50 * 1024 * 1024 });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("no-space");
    await untouched(t);
  });

  it("refuses while an earlier move isn't settled (its journal is still there)", async () => {
    const t = await setup();
    fs.writeFileSync(t.journal, JSON.stringify({ from: t.from, to: t.to, temp: `${t.to}.hh-moving-x`, stage: "config-saved" }));
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    expect(fs.existsSync(t.to)).toBe(false);
    expect((await t.config.load()).folder).toBe(t.from);
  });

  it("copies into a temporary place next to the new one and renames it at the end", async () => {
    const seen: string[] = [];
    const t = await setup({
      cp: async (src, dest, opts) => {
        seen.push(String(dest));
        return fs.promises.cp(src, dest, opts);
      },
    });
    await moveFolder(t.from, t.to, t.deps);
    expect(seen).toHaveLength(1);
    expect(path.basename(seen[0])).toBe("Work");
    expect(path.dirname(seen[0]).startsWith(`${t.to}.hh-moving-`)).toBe(true);
    expect(path.dirname(path.dirname(seen[0]))).toBe(path.dirname(t.to));
  });

  it("removes its temporary copy when copying fails", async () => {
    for (const [errCode, expected] of [["ENOSPC", "no-space"], ["EACCES", "no-permission"], ["EIO", "failed"]] as const) {
      const t = await setup({
        cp: async (src, dest, opts) => {
          await fs.promises.cp(src, dest, opts);
          throw errno(errCode);
        },
      });
      expect(await code(moveFolder(t.from, t.to, t.deps))).toBe(expected);
      await untouched(t);
    }
  });

  it("reads a name clash partway through the copy as a failure, not as an existing place, and removes the copy", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(path.join(String(src), "sub"), path.join(String(dest), "sub"), { ...opts, recursive: true });
        throw errno("ERR_FS_CP_EEXIST");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("removes the parent folders it created when the move fails", async () => {
    const t = await setup({ cp: async () => Promise.reject(errno("EIO")) });
    const deep = path.join(t.base, "home", "New", "Deep", "Work");
    expect(await code(moveFolder(t.from, deep, t.deps))).toBe("failed");
    expect(fs.existsSync(path.join(t.base, "home", "New"))).toBe(false);
    expect((await t.config.load()).folder).toBe(t.from);
  });

  it("removes the copy when a tracked file doesn't match", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        fs.writeFileSync(path.join(String(dest), "a.md"), "X");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("mismatch");
    await untouched(t);
  });

  it("removes the copy when an untracked file came out a different size", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        fs.writeFileSync(path.join(String(dest), "untracked.bin"), "AAA");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("mismatch");
    await untouched(t);
  });

  it("reads a tracked file it can't read as a failure, not a mismatch", async () => {
    for (const errCode of ["EIO", "EACCES"]) {
      const t = await setup({ hash: async () => Promise.reject(errno(errCode)) });
      expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
      await untouched(t);
    }
  });

  it("refuses the copy when a file can't be read at all, touching nothing", async () => {
    const t = await setup();
    const locked = path.join(t.from, "sub", "b.md");
    fs.chmodSync(locked, 0o000);
    try {
      expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("no-permission");
      expect(fs.existsSync(t.to)).toBe(false);
      expect(siblings(t)).toEqual([]);
      expect((await t.config.load()).folder).toBe(t.from);
    } finally {
      fs.chmodSync(locked, 0o644);
    }
  });

  it("refuses to replace a place that appeared while copying, and removes only its own copy", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        fs.mkdirSync(t.to);
        fs.writeFileSync(path.join(t.to, "theirs.md"), "theirs");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("exists");
    expect(fs.readdirSync(t.to)).toEqual(["theirs.md"]);
    expect(siblings(t)).toEqual(["Work"]);
    expect((await t.config.load()).folder).toBe(t.from);
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("removes the copy when the config can't be saved", async () => {
    const t = await setup({}, { saveFolder: async () => Promise.reject(errno("EACCES")) });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("puts the config back and removes the copy when the history can't follow", async () => {
    let renames = 0;
    const t = await setup({
      rename: async (a, b) => {
        // The first rename puts the copy in place; the history's fails.
        if (++renames > 1) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("keeps the copy as the folder, and says so, when the config can't be put back", async () => {
    let renames = 0;
    let saves = 0;
    const t = await setup({
      rename: async (a, b) => {
        if (++renames > 1) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    const save = t.deps.saveFolder;
    t.deps.saveFolder = async (folder) => {
      if (++saves > 1) throw errno("EACCES");
      return save(folder);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false, historyMoved: false });
    expect((await t.config.load()).folder).toBe(t.to);
    expect(fs.readFileSync(path.join(t.to, "a.md"), "utf8")).toBe("1");
    expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
    expect(fs.existsSync(path.join(t.oldHistory, "HEAD"))).toBe(true);
    expect(t.trashed).toEqual([]);
    // The journal stays, so the next start moves the history after the folder.
    expect(fs.existsSync(t.journal)).toBe(true);
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.to, leftBehind: t.from });
    await moved(t);
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("sets a stale history of the new place aside, and puts it back on a rollback", async () => {
    const t = await setup();
    fs.mkdirSync(t.newHistory, { recursive: true });
    fs.writeFileSync(path.join(t.newHistory, "stale"), "x");
    let renames = 0;
    const failing = await setup({
      rename: async (a, b) => {
        // 1: the copy into place, 2: the stale history aside, 3: the history (fails).
        if (++renames === 3) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    fs.mkdirSync(failing.newHistory, { recursive: true });
    fs.writeFileSync(path.join(failing.newHistory, "stale"), "x");
    expect(await code(moveFolder(failing.from, failing.to, failing.deps))).toBe("failed");
    expect(fs.readFileSync(path.join(failing.newHistory, "stale"), "utf8")).toBe("x");
    await untouched(failing);

    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true, historyMoved: true });
    expect(fs.existsSync(path.join(`${t.newHistory}.replaced-1234`, "stale"))).toBe(true);
    expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
  });

  it("sets a stale history of the new place aside even when the folder has no history yet", async () => {
    const t = await setup();
    fs.rmSync(t.oldHistory, { recursive: true });
    fs.mkdirSync(t.newHistory, { recursive: true });
    fs.writeFileSync(path.join(t.newHistory, "stale"), "x");
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true, historyMoved: true });
    expect(fs.existsSync(t.newHistory)).toBe(false);
    expect(fs.existsSync(path.join(`${t.newHistory}.replaced-1234`, "stale"))).toBe(true);
  });

  it("keeps the old folder when something changed in it after the copy", async () => {
    const t = await setup();
    const save = t.deps.saveFolder;
    t.deps.saveFolder = async (folder) => {
      fs.writeFileSync(path.join(t.from, "late.md"), "written after the copy");
      return save(folder);
    };
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false, historyMoved: true });
    await moved(t);
    expect(fs.readFileSync(path.join(t.from, "late.md"), "utf8")).toBe("written after the copy");
    expect(t.trashed).toEqual([]);
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("keeps the old folder when a file in it was rewritten with the same size", async () => {
    const t = await setup();
    const save = t.deps.saveFolder;
    t.deps.saveFolder = async (folder) => {
      fs.writeFileSync(path.join(t.from, "a.md"), "2");
      return save(folder);
    };
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false, historyMoved: true });
    expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("2");
    expect(t.trashed).toEqual([]);
  });

  it("still succeeds when the old folder can't go to the Trash, and never deletes it instead", async () => {
    const rm = vi.fn(fs.promises.rm);
    const t = await setup({ trash: async () => Promise.reject(errno("EBUSY")), rm });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false, historyMoved: true });
    await moved(t);
    expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
    expect(rm.mock.calls.map(([p]) => String(p))).not.toContain(t.from);
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("prunes histories set aside long ago", async () => {
    const t = await setup({}, { now: () => Date.parse("2026-10-13T00:00:00Z") });
    const historyRoot = path.dirname(t.newHistory);
    const ancient = path.join(historyRoot, `abc.replaced-${Date.parse("2026-01-01T00:00:00Z")}`);
    const recent = path.join(historyRoot, `def.replaced-${Date.parse("2026-10-10T00:00:00Z")}`);
    fs.mkdirSync(ancient);
    fs.mkdirSync(recent);
    await moveFolder(t.from, t.to, t.deps);
    expect(fs.existsSync(ancient)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });
});

describe("recoverMove", () => {
  it("does nothing without a journal", async () => {
    const t = await setup();
    expect(await recoverMove(t.recoverDeps)).toBeNull();
    await untouched(t);
  });

  it("closed while copying: removes the temporary copy it names, and only that one", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        return hang();
      },
    });
    const stranger = `${t.to}.hh-moving-0000`;
    fs.mkdirSync(stranger);
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(siblings(t).length).toBe(2));
    const temp = siblings(t).map((n) => path.join(path.dirname(t.to), n)).find((p) => p !== stranger)!;
    await vi.waitFor(() => expect(fs.existsSync(path.join(temp, "Work", "a.md"))).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.from });
    expect(siblings(t)).toEqual([path.basename(stranger)]);
    fs.rmdirSync(stranger);
    await untouched(t);
  });

  it("closed while putting the copy in place: removes the copy", async () => {
    const t = await setup({
      rename: async (a, b) => {
        await fs.promises.rename(a, b);
        return hang();
      },
    });
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(fs.existsSync(t.to)).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.from });
    await untouched(t);
  });

  it("closed before the config was saved: removes the copy", async () => {
    let saving = false;
    const t = await setup({}, { saveFolder: async () => {
        saving = true;
        return hang();
      } });
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(saving).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.from });
    await untouched(t);
  });

  it("closed right after the config was saved: moves the history and keeps the old folder", async () => {
    const t = await setup();
    const save = t.deps.saveFolder;
    t.deps.saveFolder = async (folder) => {
      await save(folder);
      return hang();
    };
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(async () => expect((await t.config.load()).folder).toBe(t.to));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.to, leftBehind: t.from });
    await moved(t);
    expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("closed while the history moved: finishes it, keeping the stale history set aside", async () => {
    let renames = 0;
    let stuck = false;
    const t = await setup({
      rename: async (a, b) => {
        // 1: the copy into place, 2: the stale history aside, 3: the history (closed here).
        if (++renames === 3) {
          stuck = true;
          return hang();
        }
        return fs.promises.rename(a, b);
      },
    });
    fs.mkdirSync(t.newHistory, { recursive: true });
    fs.writeFileSync(path.join(t.newHistory, "stale"), "x");
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(stuck).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.to, leftBehind: t.from });
    await moved(t);
    expect(fs.existsSync(path.join(`${t.newHistory}.replaced-1234`, "stale"))).toBe(true);
  });

  it("closed while the old folder went to the Trash: keeps it", async () => {
    let trashing = false;
    const t = await setup({ trash: async () => {
        trashing = true;
        return hang();
      } });
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(trashing).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.to, leftBehind: t.from });
    await moved(t);
    expect(fs.existsSync(t.journal)).toBe(false);
  });

  it("closed while a rollback put the config back: removes the copy and keeps the history where it was", async () => {
    let renames = 0;
    let saves = 0;
    let stuck = false;
    const t = await setup({
      rename: async (a, b) => {
        if (++renames > 1) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    const save = t.deps.saveFolder;
    t.deps.saveFolder = async (folder) => {
      await save(folder);
      if (++saves > 1) {
        stuck = true;
        return hang();
      }
    };
    void moveFolder(t.from, t.to, t.deps);
    await vi.waitFor(() => expect(stuck).toBe(true));
    expect(await recoverMove(t.recoverDeps)).toEqual({ folder: t.from });
    await untouched(t);
  });

  it("drops a journal it can't read, touching nothing", async () => {
    const t = await setup();
    fs.writeFileSync(t.journal, "{not json");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recoverMove(t.recoverDeps)).toBeNull();
    await untouched(t);
  });
});

describe("pruneReplaced", () => {
  it("removes only set-aside histories older than the limit", async () => {
    const dir = fs.mkdtempSync(path.join(root, "p-"));
    for (const name of ["a.replaced-100", "b.replaced-900", "c", "d.replaced-x"]) fs.mkdirSync(path.join(dir, name));
    await pruneReplaced(dir, 1000, 500);
    expect(fs.readdirSync(dir).sort()).toEqual(["b.replaced-900", "c", "d.replaced-x"]);
    await pruneReplaced(path.join(dir, "missing"), 1000, 500);
  });
});

describe("sameContents", () => {
  it("compares names and sizes of every file, and the bytes of tracked ones", async () => {
    const base = fs.mkdtempSync(path.join(root, "s-"));
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    for (const d of [a, b]) {
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, "x.md"), "1");
      fs.writeFileSync(path.join(d, "big.bin"), "AAAA");
    }
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    fs.writeFileSync(path.join(b, "big.bin"), "BBBB");
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    expect(await sameContents(a, b, ["x.md", "big.bin"])).toBe(false);
    fs.writeFileSync(path.join(b, ".DS_Store"), "finder");
    fs.writeFileSync(path.join(b, "big.bin"), "AAAA");
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    fs.writeFileSync(path.join(b, "extra.md"), "");
    expect(await sameContents(a, b, [])).toBe(false);
  });

  it("hashes a tracked file the listing names differently (NFC/NFD) directly", async () => {
    const base = fs.mkdtempSync(path.join(root, "s-"));
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    const nfd = "café.md";
    for (const d of [a, b]) {
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, nfd), "1");
    }
    fs.writeFileSync(path.join(b, nfd), "2");
    const hashed: string[] = [];
    const hash = async (file: string) => {
      hashed.push(file);
      return hashFile(file);
    };
    // The history names it NFC; the folder lists it as written.
    expect(await sameContents(a, b, ["café.md"], hash)).toBe(false);
    expect(hashed).toHaveLength(2);
  });

  it("hashes a large file in pieces", async () => {
    const file = path.join(fs.mkdtempSync(path.join(root, "h-")), "big.bin");
    const bytes = Buffer.alloc(9 * 1024 * 1024 + 7, 7);
    fs.writeFileSync(file, bytes);
    expect(await hashFile(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(hashFile(`${file}.missing`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("names each failure", () => {
    expect(failureOf(errno("ENOSPC"))).toBe("no-space");
    expect(failureOf(errno("EDQUOT"))).toBe("no-space");
    expect(failureOf(errno("EROFS"))).toBe("no-permission");
    expect(failureOf(errno("ERR_FS_CP_EEXIST"))).toBe("exists");
    expect(failureOf(new Error("?"))).toBe("failed");
  });
});

describe("guardedMove", () => {
  /** The real guards of the main process, with a turn flag the test flips and every step logged. */
  function wiring(move: () => Promise<MoveDone> = async () => DONE, checkpoint: () => Promise<void> = async () => {}) {
    const flags = { turn: false, quitting: false };
    const steps: string[] = [];
    const guards = new EngineGuards();
    const restores = new RestoreGuard({ quitting: () => false, busy: () => flags.turn, turnBlocked: () => guards.turnBlocked() });
    const deps = {
      guards,
      isBusy: () => flags.turn || restores.turnBlocked() !== null,
      flush: async () => void steps.push("flush"),
      closeRuntime: async () => void steps.push("close"),
      restoresSettled: async () => void steps.push("settled"),
      resumeFromNotes: async () => void steps.push("resume"),
      checkpoint: async () => {
        steps.push("checkpoint");
        await checkpoint();
      },
      precheck: async () => void steps.push("precheck"),
      quitting: () => flags.quitting,
      move: async () => {
        steps.push("move");
        return move();
      },
    };
    return { flags, steps, guards, restores, deps };
  }

  it("closes the runtime, moves, and keeps the open task to continue from its notes", async () => {
    const w = wiring();
    expect(await guardedMove(w.deps)).toEqual({ ok: true, done: DONE });
    expect(w.steps).toEqual(["precheck", "checkpoint", "flush", "close", "settled", "move", "resume"]);
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("is refused while a turn runs, touching nothing", async () => {
    const w = wiring();
    w.flags.turn = true;
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    expect(w.steps).toEqual([]);
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("is refused while a restore runs", async () => {
    const w = wiring();
    let open!: (h: string) => void;
    const restore = w.restores.run(() => new Promise<string>((r) => (open = r)), async () => undefined);
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    open("h");
    await restore;
    expect(w.steps).toEqual([]);
  });

  it("refuses a restore and holds turns while it runs", async () => {
    let finish!: () => void;
    const w = wiring(() => new Promise((r) => (finish = () => r({ oldRemoved: false, historyMoved: true }))));
    const moving = guardedMove(w.deps);
    await vi.waitFor(() => expect(w.steps).toContain("move"));
    expect(w.guards.turnBlocked()).not.toBeNull();
    await expect(w.restores.run(async () => "h", async () => undefined)).rejects.toThrow("A turn is running");
    finish();
    expect(await moving).toEqual({ ok: true, done: { oldRemoved: false, historyMoved: true } });
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("answers why a move failed, and still keeps the open task (its session is gone)", async () => {
    const w = wiring(async () => Promise.reject(new MoveFailed("no-space")));
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "no-space" });
    expect(w.steps).toEqual(["precheck", "checkpoint", "flush", "close", "settled", "move", "resume"]);
    const other = wiring(async () => Promise.reject(new Error("boom")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await guardedMove(other.deps)).toEqual({ ok: false, error: "failed" });
    expect(other.guards.turnBlocked()).toBeNull();
  });

  it("saves the open task's checkpoint before holding turns, and moves even when it fails", async () => {
    let heldDuringCheckpoint: string | null = "unset";
    const w = wiring(undefined, async () => {
      heldDuringCheckpoint = w.guards.turnBlocked();
      throw new Error("A turn is already running");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await guardedMove(w.deps)).toEqual({ ok: true, done: DONE });
    expect(heldDuringCheckpoint).toBeNull();
    expect(w.steps).toEqual(["precheck", "checkpoint", "flush", "close", "settled", "move", "resume"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("is refused when a turn started while the checkpoint ran", async () => {
    const w = wiring(undefined, async () => {
      w.flags.turn = true;
    });
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    expect(w.steps).toEqual(["precheck", "checkpoint"]);
    expect(w.guards.turnBlocked()).toBeNull();
  });
  it("checks the new place before the checkpoint turn, and spends no turn on a place it refuses", async () => {
    const w = wiring();
    w.deps.precheck = async () => {
      w.steps.push("precheck");
      throw new MoveFailed("exists");
    };
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "exists" });
    expect(w.steps).toEqual(["precheck"]);
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("stops without copying when the app started quitting during the checkpoint", async () => {
    const w = wiring(undefined, async () => {
      w.flags.quitting = true;
    });
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    expect(w.steps).toEqual(["precheck", "checkpoint"]);
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("is refused when an engine update or sign-out started during the checkpoint", async () => {
    const w = wiring(undefined, async () => {
      w.guards.beginSetup({ engineId: "claude", step: "logout", current: true }, () => false);
    });
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    expect(w.steps).toEqual(["precheck", "checkpoint"]);
    w.guards.endSetup();
    expect(w.guards.turnBlocked()).toBeNull();
  });
});

