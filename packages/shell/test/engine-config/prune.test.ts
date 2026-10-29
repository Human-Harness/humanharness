import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type ScopeEntry, tasksFile } from "@humanharness/workspace";
import { pruneEngineSnapshots, snapshotsInUse } from "../../src/main/engine-config/prune";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-engine-prune-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = new Date("2026-10-28T12:00:00.000Z");
const H = (c: string) => c.repeat(64);
const scope = (id: string, hash?: string): ScopeEntry => ({
  id,
  title: id,
  createdAt: "2026-10-01T09:00:00.000Z",
  archived: false,
  ...(hash ? { engineApproval: { hash, at: "2026-09-01T09:00:00.000Z", tag: H("f") } } : {}),
});

let n = 0;
/** An app data folder with snapshots `names` (all 40 days old) and a base whose tasks.json is `tasks` (raw). */
function setup(names: string[], tasks?: string) {
  const at = path.join(root, `w${++n}`);
  const userData = path.join(at, "userData");
  const base = path.join(at, "folder");
  for (const name of names) {
    const d = path.join(userData, "engine-config", name);
    fs.mkdirSync(d, { recursive: true });
    const t = new Date(NOW.getTime() - 40 * DAY);
    fs.utimesSync(d, t, t);
  }
  if (tasks !== undefined) {
    fs.mkdirSync(path.dirname(tasksFile(base)), { recursive: true });
    fs.writeFileSync(tasksFile(base), tasks);
  }
  const left = () => fs.readdirSync(path.join(userData, "engine-config")).sort();
  return { userData, base, left };
}

const trashing = () => {
  const trash = vi.fn(async (d: string) => fs.rmSync(d, { recursive: true }));
  return trash;
};

describe("snapshotsInUse (Decision 13)", () => {
  it("every scope's approval and every live task's pin", () => {
    const tasks = { version: 1, current: { id: "t1", engineHash: H("b") }, lanes: [{ id: "t2", engineHash: H("c") }, { id: "t3" }], actions: {} };
    expect([...snapshotsInUse([{ scopes: [scope("a", H("a")), { ...scope("old", H("d")), archived: true }, scope("x")], tasks }])].sort()).toEqual([H("a"), H("b"), H("c"), H("d")]);
    // Shapes the app didn't write add nothing.
    expect([...snapshotsInUse([{ scopes: [], tasks: { current: { engineHash: "nope" }, lanes: "x" } }])]).toEqual([]);
    expect([...snapshotsInUse([{ scopes: [], tasks: null }])]).toEqual([]);
  });
});

describe("pruneEngineSnapshots (Decision 13)", () => {
  it("trashes old snapshots no approval and no live task names; never a pinned or approved one", async () => {
    const tasks = JSON.stringify({ version: 1, current: { id: "t1", engineHash: H("b") }, lanes: [{ id: "t2", engineHash: H("c") }], actions: {} });
    const w = setup([H("a"), H("b"), H("c"), H("d"), H("e")], tasks);
    const other = setup([], JSON.stringify({ version: 1, current: { id: "t9", engineHash: H("e") }, actions: {} }));
    const trash = trashing();
    await pruneEngineSnapshots(
      w.userData,
      [
        { base: w.base, scopes: { list: async () => [scope("intro", H("a"))] } },
        // Another profile's base: its pins count too.
        { base: other.base, scopes: { list: async () => [] } },
      ],
      NOW,
      trash,
    );
    expect(w.left()).toEqual([H("a"), H("b"), H("c"), H("e")]);
    expect(trash).toHaveBeenCalledTimes(1);
  });

  it("a scope that approves a snapshot after the first read keeps it", async () => {
    const w = setup([H("a")]);
    const list = vi.fn(async (): Promise<ScopeEntry[]> => []);
    list.mockResolvedValueOnce([]).mockResolvedValue([scope("intro", H("a"))]);
    await pruneEngineSnapshots(w.userData, [{ base: w.base, scopes: { list } }], NOW, trashing());
    expect(w.left()).toEqual([H("a")]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a base without tasks.json pins nothing; young snapshots stay", async () => {
    const w = setup([H("a")]);
    fs.mkdirSync(path.join(w.userData, "engine-config", H("b")));
    await pruneEngineSnapshots(w.userData, [{ base: w.base, scopes: { list: async () => [] } }], NOW, trashing());
    expect(w.left()).toEqual([H("b")]);
  });

  it("prunes nothing when a base can't be read (a pin it holds would be lost)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = setup([H("a")], "{ not json");
    const trash = trashing();
    await pruneEngineSnapshots(bad.userData, [{ base: bad.base, scopes: { list: async () => [] } }], NOW, trash);
    const failing = setup([H("a")]);
    await pruneEngineSnapshots(failing.userData, [{ base: failing.base, scopes: { list: async () => Promise.reject(new Error("EACCES")) } }], NOW, trash);
    expect(trash).not.toHaveBeenCalled();
    expect(bad.left()).toEqual([H("a")]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
