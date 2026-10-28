import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TaskSummary } from "@humanharness/ui/client";
import { EventEmitter } from "node:events";
import { keepNotification, TaskAttention, type TaskAttentionDeps, WAITING_BODY } from "../src/main/task-attention";

function fakeStore() {
  const items = new Map<string, { title: string }>();
  return {
    items,
    raise: vi.fn(async (o: { kind: string; id: string }, input: { key: string; title: string }) => void items.set(`${o.id}/${input.key}`, input)),
    resolve: vi.fn(async (o: { kind: string; id: string }, key: string) => void items.delete(`${o.id}/${key}`)),
  };
}

const task = (id: string, state: TaskSummary["state"], label = "Intro"): TaskSummary => ({
  id,
  scope: "main",
  action: null,
  label,
  state,
  startedAt: "2026-10-28T10:00:00.000Z",
  tokens: 0,
});

function attention(over: Partial<TaskAttentionDeps> = {}) {
  const store = fakeStore();
  const badge = vi.fn<(n: number) => void>();
  const notify = vi.fn<TaskAttentionDeps["notify"]>();
  const d: TaskAttentionDeps = { store: async () => store as never, badge, notify, notifyOn: () => false, windowFocused: () => true, log: () => {}, ...over };
  return { a: new TaskAttention(d), store, badge, notify };
}

describe("TaskAttention (parallel spec §9.2, Decision 10, P4)", () => {
  it("a waiting task raises one action item; leaving waiting resolves it", async () => {
    const { a, store, badge } = attention();
    await a.update([task("t1", "waiting")]);
    expect(store.raise).toHaveBeenCalledWith(
      { kind: "task", id: "t1" },
      expect.objectContaining({ key: "waiting", severity: "action", title: "Intro", target: { panel: "task", focus: "t1" } }),
    );
    expect(badge).toHaveBeenLastCalledWith(1);
    // Still waiting: nothing raised again.
    await a.update([task("t1", "waiting")]);
    expect(store.raise).toHaveBeenCalledTimes(1);
    await a.update([task("t1", "running")]);
    expect(store.resolve).toHaveBeenCalledWith({ kind: "task", id: "t1" }, "waiting");
    expect(store.items.size).toBe(0);
    expect(badge).toHaveBeenLastCalledWith(0);
  });

  it("a waiting task that closes (gone from the open tasks) is resolved too", async () => {
    const { a, store, badge } = attention();
    await a.update([task("t1", "waiting"), task("t2", "waiting", "Other")]);
    expect(badge).toHaveBeenLastCalledWith(2);
    await a.update([task("t2", "waiting", "Other")]);
    expect(store.resolve).toHaveBeenCalledTimes(1);
    expect(store.resolve).toHaveBeenCalledWith({ kind: "task", id: "t1" }, "waiting");
    expect([...store.items.keys()]).toEqual(["t2/waiting"]);
    expect(badge).toHaveBeenLastCalledWith(1);
  });

  it("queued, running, closing and checkpoint tasks raise nothing and never set the badge", async () => {
    const { a, store, badge } = attention();
    await a.update([task("t1", "running"), task("t2", "queued"), task("t3", "closing"), task("t4", "checkpoint")]);
    expect(store.raise).not.toHaveBeenCalled();
    expect(badge).not.toHaveBeenCalled();
  });

  it("an OS notification only when on and the window isn't focused; label only", async () => {
    const notify = vi.fn<TaskAttentionDeps["notify"]>();
    const { a } = attention({ notify, notifyOn: () => true, windowFocused: () => false });
    await a.update([task("t1", "waiting")]);
    expect(notify).toHaveBeenCalledWith({ title: "Intro", body: WAITING_BODY }, "t1");
    await a.update([task("t1", "waiting")]);
    expect(notify).toHaveBeenCalledTimes(1);
    // Waiting again after a turn: one more.
    await a.update([task("t1", "running")]);
    await a.update([task("t1", "waiting")]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("no notification while the window is focused, or with the setting off (the default)", async () => {
    const focused = attention({ notifyOn: () => true, windowFocused: () => true });
    await focused.a.update([task("t1", "waiting")]);
    expect(focused.notify).not.toHaveBeenCalled();
    const off = attention({ notifyOn: async () => false, windowFocused: () => false });
    await off.a.update([task("t1", "waiting")]);
    expect(off.notify).not.toHaveBeenCalled();
    // A setting that can't be read counts as off.
    const broken = attention({ notifyOn: () => Promise.reject(new Error("no config")), windowFocused: () => false });
    await broken.a.update([task("t1", "waiting")]);
    expect(broken.notify).not.toHaveBeenCalled();
    expect(broken.store.raise).toHaveBeenCalledTimes(1);
  });

  it("P4: the item and the notification carry the label, cut to the item's title limit; the badge a count", async () => {
    const long = "x".repeat(300);
    const { a, store, notify, badge } = attention({ notifyOn: () => true, windowFocused: () => false });
    await a.update([task("t1", "waiting", long)]);
    const input = store.raise.mock.calls[0][1] as { title: string; body?: string };
    expect(input.title).toBe("x".repeat(120));
    expect(input.body).toBeUndefined();
    expect(notify.mock.calls[0][0]).toEqual({ title: "x".repeat(120), body: WAITING_BODY });
    expect(badge.mock.calls.every(([n]) => typeof n === "number")).toBe(true);
  });

  it("the badge adds other sources' count; refreshBadge shows a change of theirs", async () => {
    let other = 2;
    const { a, badge } = attention({ otherCount: () => other });
    await a.update([task("t1", "waiting")]);
    expect(badge).toHaveBeenLastCalledWith(3);
    other = 0;
    a.refreshBadge();
    expect(badge).toHaveBeenLastCalledWith(1);
    a.refreshBadge();
    expect(badge).toHaveBeenCalledTimes(2);
  });

  it("updates run one at a time: two at once raise once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = fakeStore();
    const slow = { raise: vi.fn(async (o: { kind: string; id: string }, i: { key: string; title: string }) => (await gate, store.raise(o, i))), resolve: store.resolve };
    const { a } = attention({ store: async () => slow as never });
    const one = a.update([task("t1", "waiting")]);
    const two = a.update([task("t1", "waiting")]);
    release();
    await Promise.all([one, two]);
    expect(slow.raise).toHaveBeenCalledTimes(1);
  });

  it("no store (the app isn't set up) or a store that fails: the badge still counts, nothing throws", async () => {
    const none = attention({ store: async () => null });
    await none.a.update([task("t1", "waiting")]);
    expect(none.badge).toHaveBeenLastCalledWith(1);
    const failing = attention({ store: async () => ({ raise: () => Promise.reject(new Error("disk")), resolve: () => Promise.reject(new Error("disk")) }) as never });
    await failing.a.update([task("t1", "waiting")]);
    await failing.a.update([]);
    expect(failing.badge).toHaveBeenLastCalledWith(0);
  });

  it("a raise that failed (no store yet, or the store refused) is tried again on the next update", async () => {
    const store = fakeStore();
    let ready = false;
    const { a, badge } = attention({ store: async () => (ready ? (store as never) : null) });
    await a.update([task("t1", "waiting")]);
    expect(badge).toHaveBeenLastCalledWith(1);
    expect(store.items.size).toBe(0);
    ready = true;
    await a.update([task("t1", "waiting")]);
    expect([...store.items.keys()]).toEqual(["t1/waiting"]);
    // Raised once it worked, not again after.
    await a.update([task("t1", "waiting")]);
    expect(store.raise).toHaveBeenCalledTimes(1);

    let fail = true;
    const flaky = fakeStore();
    const raise = flaky.raise;
    flaky.raise = vi.fn((o: { kind: string; id: string }, i: { key: string; title: string }) => (fail ? Promise.reject(new Error("disk")) : raise(o, i)));
    const second = attention({ store: async () => flaky as never });
    await second.a.update([task("t2", "waiting")]);
    expect(flaky.items.size).toBe(0);
    fail = false;
    await second.a.update([task("t2", "waiting")]);
    expect([...flaky.items.keys()]).toEqual(["t2/waiting"]);
  });

  it("a resolve that failed is tried again on the next update; the notification still comes once per wait", async () => {
    const store = fakeStore();
    let fail = true;
    const resolve = store.resolve;
    store.resolve = vi.fn((o: { kind: string; id: string }, key: string) => (fail ? Promise.reject(new Error("disk")) : resolve(o, key)));
    const { a, notify } = attention({ store: async () => store as never, notifyOn: () => true, windowFocused: () => false });
    await a.update([task("t1", "waiting")]);
    await a.update([]);
    expect(store.items.size).toBe(1);
    fail = false;
    await a.update([]);
    expect(store.items.size).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a badge that throws is logged and never reaches the caller (plugins' attentionChanged)", async () => {
    const log = vi.fn();
    let other = 0;
    const { a } = attention({ badge: () => { throw new Error("no dock"); }, otherCount: () => other, log });
    other = 1;
    expect(() => a.refreshBadge()).not.toThrow();
    expect(log).toHaveBeenCalledWith("Could not set the Dock badge", expect.any(Error));
    await expect(a.update([task("t1", "waiting")])).resolves.toBeUndefined();
  });

  it("the notification body is the window's parallel.waitingBody in English", () => {
    const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../i18n/src/locales/en.json"), "utf8")) as { parallel: Record<string, string> };
    expect(en.parallel.waitingBody).toBe(WAITING_BODY);
  });
});

describe("keepNotification: a shown notification stays referenced until clicked or closed", () => {
  it("is held until its click, close or failure, and at most `max` are held (oldest let go)", () => {
    const kept = new Set<EventEmitter>();
    const a = keepNotification(new EventEmitter(), kept);
    const b = keepNotification(new EventEmitter(), kept);
    const c = keepNotification(new EventEmitter(), kept);
    expect(kept.size).toBe(3);
    a.emit("click");
    b.emit("close");
    c.emit("failed", "no permission");
    expect(kept.size).toBe(0);
    const many = Array.from({ length: 5 }, () => keepNotification(new EventEmitter(), kept, 3));
    expect([...kept]).toEqual(many.slice(2));
  });

  it("index.ts holds the waiting task's notification through it", () => {
    const index = fs.readFileSync(path.resolve(__dirname, "../src/main/index.ts"), "utf8");
    expect(index).toMatch(/const n = keepNotification\(new Notification\(\{ title, body \}\), notifications\);/);
  });
});

describe("D0: plain mode never sets the Dock badge, raises a task item or shares the store", () => {
  const main = path.resolve(__dirname, "../src/main");
  const index = fs.readFileSync(path.join(main, "index.ts"), "utf8");
  const files = fs.readdirSync(main).filter((f) => f.endsWith(".ts"));
  const naming = (re: RegExp) => files.filter((f) => re.test(fs.readFileSync(path.join(main, f), "utf8"))).sort();

  it("the Dock badge is set in one place, the task attention that only the board host gets", () => {
    expect(naming(/\.setBadge\(/)).toEqual(["index.ts"]);
    expect([...index.matchAll(/\.setBadge\(/g)]).toHaveLength(1);
    expect(naming(/new TaskAttention\(/)).toEqual(["index.ts"]);
    // Built only by buildTaskAttention, which only buildBoardHost calls (and that only in board mode, board-host.test.ts).
    expect([...index.matchAll(/\bbuildTaskAttention\(/g)]).toHaveLength(2);
    expect(index).toMatch(/function buildTaskAttention\(\): TaskAttention \{\n\s*const attention = new TaskAttention\(/);
    expect(index).toMatch(/\n\s*attention: buildTaskAttention\(\),\n\s*\},\n\s*\{ engineId: c\.engineId, parallel: c\.parallel \},/);
  });

  it("the shared stores exist only in board mode; plain mode's plugins build their own", () => {
    expect([...index.matchAll(/\bsharedAttention = /g)]).toHaveLength(1);
    expect(index).toMatch(/if \(hostMode\(harness\) === "board"\) \{\n\s*const stores = attentionStores\(/);
    expect(index).toMatch(/\.\.\.\(attentionShared\n\s*\? \{\n\s*attentionStoreFor:/);
  });
});
