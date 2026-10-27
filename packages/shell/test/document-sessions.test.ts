import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DocumentSessions, type WatcherPool } from "../src/main/document-sessions";
import { DocumentWatchers, MAX_WATCHES } from "../src/main/documents";

/** A pool that hands out ids and records what is still open. */
function fakePool() {
  let next = 1;
  const open = new Set<number>();
  let resolveNext: ((id: number | null) => void) | null = null;
  const pool: WatcherPool & { open: Set<number>; hold: boolean; release(): void } = {
    open,
    hold: false,
    watch: (rel) => {
      if (typeof rel !== "string" || rel.startsWith("../")) return Promise.resolve(null);
      const id = next++;
      open.add(id);
      if (!pool.hold) return Promise.resolve(id);
      return new Promise((resolve) => {
        resolveNext = () => resolve(id);
      });
    },
    unwatch: (id) => void open.delete(id as number),
    closeAll: () => open.clear(),
    release: () => resolveNext?.(null),
  };
  return pool;
}

const roots = ["/work", "/ref"];

describe("DocumentSessions (document-reader spec §5.3)", () => {
  it("lets a window unwatch only its own ids", async () => {
    const pool = fakePool();
    const s = new DocumentSessions(pool);
    const a = await s.watch(1, "a.md", roots);
    const b = await s.watch(2, "b.md", roots);
    expect(a).not.toBeNull();
    expect(s.ownerOf(a!)).toBe(1);
    s.unwatch(2, a);
    expect(pool.open.has(a!)).toBe(true);
    s.unwatch(1, a);
    expect(pool.open.has(a!)).toBe(false);
    expect(s.ownerOf(a!)).toBeNull();
    expect(pool.open.has(b!)).toBe(true);
  });

  it("ignores ids that are not numbers", async () => {
    const pool = fakePool();
    const s = new DocumentSessions(pool);
    const a = await s.watch(1, "a.md", roots);
    for (const bad of ["1", null, undefined, { id: a }]) s.unwatch(1, bad);
    expect(pool.open.has(a!)).toBe(true);
  });

  it("answers null for a refused path and records nothing", async () => {
    const s = new DocumentSessions(fakePool());
    expect(await s.watch(1, "../x.md", roots)).toBeNull();
  });

  it("closes one window's watches when it closes or reloads, not another's", async () => {
    const pool = fakePool();
    const s = new DocumentSessions(pool);
    const a1 = await s.watch(1, "a.md", roots);
    const a2 = await s.watch(1, "c.md", roots);
    const b = await s.watch(2, "b.md", roots);
    s.closeOwner(1);
    expect([...pool.open]).toEqual([b]);
    expect(s.ownerOf(a1!)).toBeNull();
    expect(s.ownerOf(a2!)).toBeNull();
  });

  it("closes every watch when the folder or the reference folders change", async () => {
    const pool = fakePool();
    const s = new DocumentSessions(pool);
    const a = await s.watch(1, "a.md", roots);
    const b = await s.watch(1, "b.md", ["/other", "/ref"]);
    expect(pool.open.has(a!)).toBe(false);
    expect(s.ownerOf(a!)).toBeNull();
    expect([...pool.open]).toEqual([b]);
    s.closeAll();
    expect(pool.open.size).toBe(0);
  });

  it("closes a watch that was being made when everything closed", async () => {
    const pool = fakePool();
    const s = new DocumentSessions(pool);
    pool.hold = true;
    const pending = s.watch(1, "a.md", roots);
    s.closeAll();
    pool.release();
    expect(await pending).toBeNull();
    expect(pool.open.size).toBe(0);
  });
});

describe("DocumentSessions with DocumentWatchers", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-doc-sessions-")));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.md"), "# A\n");

  it("tells only the owner of a live watch, and nothing after its window closed", async () => {
    const heard: [number | null, number][] = [];
    const watchers = new DocumentWatchers((id) => heard.push([sessions.ownerOf(id), id]), 20);
    const sessions = new DocumentSessions(watchers);
    const id = await sessions.watch(7, "a.md", [root]);
    expect(id).not.toBeNull();
    fs.writeFileSync(path.join(root, "a.md"), "# A2\n");
    // Under load macOS may also deliver the file's creation late: one or more reports, all to the owner.
    await vi.waitFor(() => expect(heard).toContainEqual([7, id]), { timeout: 2000 });
    expect(heard.every(([owner, w]) => owner === 7 && w === id)).toBe(true);
    sessions.closeOwner(7);
    const before = heard.length;
    fs.writeFileSync(path.join(root, "a.md"), "# A3\n");
    await new Promise((r) => setTimeout(r, 150));
    expect(heard).toHaveLength(before);
  });

  it("drops the owner of a watch the pool closed to make room", async () => {
    const watchers = new DocumentWatchers(() => {}, 20);
    const sessions = new DocumentSessions(watchers);
    const first = await sessions.watch(1, "a.md", [root]);
    for (let i = 0; i < MAX_WATCHES; i++) await sessions.watch(2, "a.md", [root]);
    expect(first).not.toBeNull();
    expect(sessions.ownerOf(first as number)).toBeNull();
    expect(watchers.size).toBe(MAX_WATCHES);
    sessions.closeAll();
  });
});
