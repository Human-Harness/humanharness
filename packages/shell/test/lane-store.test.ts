import { describe, expect, it } from "vitest";
import { LaneStore } from "../src/main/lane-store";
import type { TasksFile } from "../src/main/task-store";

function memory(initial: TasksFile) {
  let file = structuredClone(initial);
  let saves = 0;
  return {
    load: async () => structuredClone(file),
    save: async (s: TasksFile) => {
      // A save that yields first, so two saves that weren't serialized would interleave.
      await new Promise((r) => setTimeout(r, 1));
      file = structuredClone(s);
      saves += 1;
    },
    peek: () => file,
    saves: () => saves,
  };
}
const task = (id: string, extra: object = {}) => ({ id, status: "waiting" as const, startedAt: "2026-10-28T10:00:00Z", turns: 0, ...extra });

describe("LaneStore (Decision 3)", () => {
  it("a lane sees its task as current; saving writes it back into lanes", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a"), task("b")], focus: "b" });
    const a = new LaneStore(m, "a");
    const seen = await a.load();
    expect(seen.current?.id).toBe("a");
    expect("lanes" in seen).toBe(false);
    expect("focus" in seen).toBe(false);
    await a.save({ ...seen, current: { ...seen.current!, turns: 2 } });
    expect(m.peek().lanes?.map((l) => [l.id, l.turns])).toEqual([["a", 2], ["b", 0]]);
    expect(m.peek().current).toBeNull();
    // Another lane's focus is the board's, never the lane's.
    expect(m.peek().focus).toBe("b");
  });

  it("a lane whose task ended is removed; a new task is added", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a")] });
    await new LaneStore(m, "a").save({ version: 1, current: null, actions: { intro: "done" } });
    expect(m.peek().lanes).toEqual([]);
    expect(m.peek().actions).toEqual({ intro: "done" });
    const n = new LaneStore(m, "n");
    const s = await n.load();
    expect(s.current).toBeNull();
    await n.save({ ...s, current: task("n") });
    expect(m.peek().lanes?.map((l) => l.id)).toEqual(["n"]);
  });

  it("a lane never writes another task as its current", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("b")] });
    const a = new LaneStore(m, "a");
    await a.save({ ...(await a.load()), current: task("b", { turns: 9 }) });
    expect(m.peek().lanes).toEqual([task("b")]);
  });

  it("two lanes' changes to actions both survive (three-way merge)", async () => {
    const m = memory({ version: 1, current: null, actions: { x: "done" }, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    await a.save({ ...sa, actions: { ...sa.actions, one: "done" } });
    await b.save({ ...sb, actions: { ...sb.actions, two: "unfinished" } });
    expect(m.peek().actions).toEqual({ x: "done", one: "done", two: "unfinished" });
  });

  it("a key a lane removed is removed; one it left alone keeps the other lane's change", async () => {
    const m = memory({ version: 1, current: null, actions: { x: "done", y: "unfinished" }, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    await a.save({ ...sa, actions: { y: "unfinished" } });
    await b.save({ ...sb, actions: { ...sb.actions, y: "done" } });
    expect(m.peek().actions).toEqual({ y: "done" });
  });

  it("scopes and open merge the same way; engine follows the last writer", async () => {
    const m = memory({ version: 1, current: null, actions: {}, open: "s1", scopes: { s1: {} }, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    await a.save({ ...sa, scopes: { s1: { one: "done" } } });
    await b.save({ ...sb, scopes: { s1: {}, s2: { two: "done" } }, engine: "claude" });
    expect(m.peek().scopes).toEqual({ s1: { one: "done" }, s2: { two: "done" } });
    expect(m.peek().engine).toBe("claude");
    expect(m.peek().open).toBe("s1");
  });

  it("a lane that clears open or engine removes the key; one that didn't keeps another lane's value", async () => {
    const m = memory({ version: 1, current: null, actions: {}, open: "s1", engine: "codex", lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    const { open: _o, engine: _e, ...cleared } = sa;
    await a.save(cleared);
    expect(m.peek()).not.toHaveProperty("open");
    expect(m.peek()).not.toHaveProperty("engine");
    await b.save({ ...sb, open: "s2" });
    expect(m.peek().open).toBe("s2");
    expect(m.peek()).not.toHaveProperty("engine");
  });

  it("saves from several lanes at once are serialized: none is lost", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a"), task("b"), task("c")] });
    const stores = ["a", "b", "c"].map((id) => new LaneStore(m, id));
    const views = await Promise.all(stores.map((s) => s.load()));
    await Promise.all(stores.map((s, i) => s.save({ ...views[i], actions: { [s.id]: "done" }, current: { ...views[i].current!, turns: i + 1 } })));
    expect(m.peek().actions).toEqual({ a: "done", b: "done", c: "done" });
    expect(m.peek().lanes?.map((l) => [l.id, l.turns])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    expect(m.saves()).toBe(3);
  });

  it("a failed save doesn't block the next one", async () => {
    let fail = true;
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a")] });
    const store = {
      load: m.load,
      save: async (s: TasksFile) => {
        if (fail) throw new Error("disk full");
        await m.save(s);
      },
    };
    const a = new LaneStore(store, "a");
    const s = await a.load();
    await expect(a.save({ ...s, actions: { one: "done" } })).rejects.toThrow("disk full");
    fail = false;
    await a.save({ ...s, actions: { two: "done" } });
    expect(m.peek().actions).toEqual({ two: "done" });
  });
});
