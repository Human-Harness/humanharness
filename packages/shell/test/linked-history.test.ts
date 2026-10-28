import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { LINKED_KEEP_DAYS, linkedHistoryDir, markRelinked, markUnlinked, pruneUnlinked } from "../src/main/linked-history";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-lh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
const day = 86_400_000;

describe("linked histories (hatches spec §3.2, Decision 5)", () => {
  it("one gitdir per real path, under linked-history/", () => {
    const a = linkedHistoryDir(root, "/Users/me/notes");
    expect(path.dirname(a)).toBe(path.join(root, "linked-history"));
    expect(path.basename(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(linkedHistoryDir(root, "/Users/me/notes")).toBe(a);
    expect(linkedHistoryDir(root, "/Users/me/other")).not.toBe(a);
  });

  it("an unlink marks the history; a relink clears the mark", async () => {
    const dir = linkedHistoryDir(root, "/x");
    fs.mkdirSync(dir, { recursive: true });
    await markUnlinked(dir, new Date("2026-10-01T00:00:00Z"));
    expect(fs.readFileSync(path.join(dir, "unlinked-at"), "utf8")).toBe("2026-10-01T00:00:00.000Z");
    await markRelinked(dir);
    expect(fs.existsSync(path.join(dir, "unlinked-at"))).toBe(false);
  });

  it("unlinking a folder that never had a history creates nothing", async () => {
    const dir = linkedHistoryDir(root, "/never-tracked");
    await markUnlinked(dir, new Date());
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("prunes histories unlinked more than 30 days ago, keeps the others", async () => {
    const now = new Date("2026-11-30T00:00:00Z");
    const old = linkedHistoryDir(root, "/old");
    const fresh = linkedHistoryDir(root, "/fresh");
    const live = linkedHistoryDir(root, "/live");
    for (const d of [old, fresh, live]) fs.mkdirSync(d, { recursive: true });
    await markUnlinked(old, new Date(now.getTime() - (LINKED_KEEP_DAYS + 1) * day));
    await markUnlinked(fresh, new Date(now.getTime() - 2 * day));
    const trashed: string[] = [];
    await pruneUnlinked(root, now, async (p) => void trashed.push(p));
    expect(trashed).toEqual([old]);
  });

  it("a mark that isn't a date is left alone and logged, never pruned", async () => {
    const d = linkedHistoryDir(root, "/weird");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "unlinked-at"), "not a date");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const trashed: string[] = [];
    await pruneUnlinked(root, new Date(), async (p) => void trashed.push(p));
    expect(trashed).not.toContain(d);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(d));
  });

  it("a history the Trash refuses is kept and the failure logged", async () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), "hh-lh-trash-"));
    const d = linkedHistoryDir(own, "/stuck");
    fs.mkdirSync(d, { recursive: true });
    await markUnlinked(d, new Date("2026-01-01T00:00:00Z"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      pruneUnlinked(own, new Date("2026-11-30T00:00:00Z"), async () => {
        throw new Error("trash failed");
      }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(d)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(d), expect.any(Error));
    fs.rmSync(own, { recursive: true, force: true });
  });

  it("without a linked-history folder there is nothing to prune", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hh-lh-empty-"));
    const trash = vi.fn(async () => {});
    await pruneUnlinked(empty, new Date(), trash);
    expect(trash).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(empty, "linked-history"))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
