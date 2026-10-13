import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ConfigStore, historyDir } from "../src/main/config";
import { EngineGuards } from "../src/main/engine-guards";
import { type MoveDeps, type MoveOps, MoveFailed, failureOf, guardedMove, moveFolder, sameContents } from "../src/main/move-folder";
import { RestoreGuard } from "../src/main/restore-guard";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const errno = (code: string) => Object.assign(new Error(code), { code });
const OLD_TIME = new Date("2026-01-02T03:04:05Z");

/** A folder with files, a note naming its absolute path, a history and a config pointing at it. */
async function setup(ops: Partial<MoveOps> = {}, extra: Partial<MoveDeps> = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const from = path.join(base, "home", "Documents", "Work");
  const to = path.join(base, "home", "Drive", "Work");
  const userData = path.join(base, "userData");
  fs.mkdirSync(path.join(from, "sub"), { recursive: true });
  fs.mkdirSync(path.join(from, ".harness", "notes"), { recursive: true });
  fs.mkdirSync(path.join(base, "home", "Drive"), { recursive: true });
  fs.writeFileSync(path.join(from, "a.md"), "1");
  fs.utimesSync(path.join(from, "a.md"), OLD_TIME, OLD_TIME);
  fs.writeFileSync(path.join(from, "sub", "b.md"), "b");
  fs.writeFileSync(path.join(from, ".harness", "notes", "n.md"), `---\ntitle: "N"\nfiles: ["${from}/a.md"]\n---\n`);
  fs.writeFileSync(path.join(from, ".harness", "tasks.json"), "{}");
  const oldHistory = historyDir(userData, from);
  const newHistory = historyDir(userData, to);
  fs.mkdirSync(oldHistory, { recursive: true });
  fs.writeFileSync(path.join(oldHistory, "HEAD"), "ref: refs/heads/main\n");
  const config = new ConfigStore(userData);
  await config.save({ folder: from, language: "es" });
  const deps: MoveDeps = {
    check: async () => null,
    tracked: async () => ["a.md", "sub/b.md", ".harness/notes/n.md"],
    saveFolder: async (folder) => void (await config.replaceFolder(folder)),
    historyDir: (folder) => historyDir(userData, folder),
    ops,
    now: () => 1234,
    ...extra,
  };
  return { from, to, config, oldHistory, newHistory, deps };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof MoveFailed ? err.code : `not a MoveFailed: ${String(err)}`;
  }
  return "no error";
};

/** Nothing changed: `from` and its history are where they were, `to` doesn't exist, the config names `from`. */
async function untouched(t: Awaited<ReturnType<typeof setup>>) {
  expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
  expect(fs.existsSync(t.to)).toBe(false);
  expect(fs.existsSync(path.join(t.oldHistory, "HEAD"))).toBe(true);
  expect((await t.config.load()).folder).toBe(t.from);
}

describe("moveFolder", () => {
  it("moves the folder with its history and makes the notes' old paths relative", async () => {
    const t = await setup();
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true });
    expect(fs.existsSync(t.from)).toBe(false);
    expect(fs.readFileSync(path.join(t.to, "sub", "b.md"), "utf8")).toBe("b");
    expect(fs.statSync(path.join(t.to, "a.md")).mtime.getTime()).toBe(OLD_TIME.getTime());
    expect(fs.readFileSync(path.join(t.to, ".harness", "notes", "n.md"), "utf8")).toContain('files: ["a.md"]');
    expect(fs.existsSync(path.join(t.to, ".harness", "tasks.json"))).toBe(true);
    expect(await t.config.load()).toEqual({ folder: t.to, language: "es" });
    expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
    expect(fs.existsSync(t.oldHistory)).toBe(false);
  });

  it("refuses a place inside the folder, or one the folder is inside", async () => {
    const t = await setup();
    expect(await code(moveFolder(t.from, path.join(t.from, "Inner"), t.deps))).toBe("inside");
    expect(await code(moveFolder(t.from, path.dirname(t.from), t.deps))).toBe("inside");
    await untouched(t);
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

  it("refuses when there isn't enough space, before copying anything", async () => {
    const t = await setup({ freeBytes: async () => 1 });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("no-space");
    await untouched(t);
  });

  it("removes a half-made copy when copying fails", async () => {
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

  it("removes the copy when it doesn't match", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        fs.writeFileSync(path.join(String(dest), "a.md"), "X");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("mismatch");
    await untouched(t);
  });

  it("removes the copy when the config can't be saved", async () => {
    const t = await setup({}, { saveFolder: async () => Promise.reject(errno("EACCES")) });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("puts the config back and removes the copy when the history can't follow", async () => {
    const t = await setup({ rename: async () => Promise.reject(errno("EPERM")) });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("sets a stale history of the new place aside, and puts it back on a rollback", async () => {
    const t = await setup();
    fs.mkdirSync(t.newHistory, { recursive: true });
    fs.writeFileSync(path.join(t.newHistory, "stale"), "x");
    let renames = 0;
    const failing = await setup({
      rename: async (a, b) => {
        if (++renames === 2) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    fs.mkdirSync(failing.newHistory, { recursive: true });
    fs.writeFileSync(path.join(failing.newHistory, "stale"), "x");
    expect(await code(moveFolder(failing.from, failing.to, failing.deps))).toBe("failed");
    expect(fs.readFileSync(path.join(failing.newHistory, "stale"), "utf8")).toBe("x");
    await untouched(failing);

    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true });
    expect(fs.existsSync(path.join(`${t.newHistory}.replaced-1234`, "stale"))).toBe(true);
    expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
  });

  it("still succeeds when the old folder can't be removed", async () => {
    const t = await setup({
      rm: async (p, opts) => {
        if (String(p) === t.from) throw errno("EBUSY");
        return fs.promises.rm(p, opts);
      },
    });
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false });
    expect((await t.config.load()).folder).toBe(t.to);
    expect(fs.existsSync(path.join(t.to, "a.md"))).toBe(true);
    expect(fs.existsSync(path.join(t.from, "a.md"))).toBe(true);
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
  function wiring(move: () => Promise<{ oldRemoved: boolean }> = async () => ({ oldRemoved: true }), checkpoint: () => Promise<void> = async () => {}) {
    const flags = { turn: false };
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
      move: async () => {
        steps.push("move");
        return move();
      },
    };
    return { flags, steps, guards, restores, deps };
  }

  it("closes the runtime, moves, and keeps the open task to continue from its notes", async () => {
    const w = wiring();
    expect(await guardedMove(w.deps)).toEqual({ ok: true, done: { oldRemoved: true } });
    expect(w.steps).toEqual(["checkpoint", "flush", "close", "settled", "move", "resume"]);
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
    const w = wiring(() => new Promise((r) => (finish = () => r({ oldRemoved: false }))));
    const moving = guardedMove(w.deps);
    await vi.waitFor(() => expect(w.steps).toContain("move"));
    expect(w.guards.turnBlocked()).not.toBeNull();
    await expect(w.restores.run(async () => "h", async () => undefined)).rejects.toThrow("A turn is running");
    finish();
    expect(await moving).toEqual({ ok: true, done: { oldRemoved: false } });
    expect(w.guards.turnBlocked()).toBeNull();
  });

  it("answers why a move failed, and still keeps the open task (its session is gone)", async () => {
    const w = wiring(async () => Promise.reject(new MoveFailed("no-space")));
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "no-space" });
    expect(w.steps).toEqual(["checkpoint", "flush", "close", "settled", "move", "resume"]);
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
    expect(await guardedMove(w.deps)).toEqual({ ok: true, done: { oldRemoved: true } });
    expect(heldDuringCheckpoint).toBeNull();
    expect(w.steps).toEqual(["checkpoint", "flush", "close", "settled", "move", "resume"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("is refused when a turn started while the checkpoint ran", async () => {
    const w = wiring(undefined, async () => {
      w.flags.turn = true;
    });
    expect(await guardedMove(w.deps)).toEqual({ ok: false, error: "busy" });
    expect(w.steps).toEqual(["checkpoint"]);
    expect(w.guards.turnBlocked()).toBeNull();
  });
});
