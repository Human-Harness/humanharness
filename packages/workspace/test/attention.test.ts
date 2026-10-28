import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATTENTION_LIMITS, AttentionStore } from "../src/index";

const oncall = { kind: "plugin" as const, id: "oncall" };
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-att-"));
const at = (iso: string) => () => new Date(iso);
const quiet = { log: () => {} };

describe("AttentionStore (plugins spec §6)", () => {
  it("D0: no file until the first item", async () => {
    const base = await tmp();
    const s = new AttentionStore(base);
    expect(await s.list()).toEqual([]);
    expect(await s.badge()).toBe(0);
    await s.markRead();
    await s.resolve(oncall, "nothing");
    await s.removeOrigin(oncall);
    await expect(fs.access(path.join(base, ".harness"))).rejects.toThrow();
  });

  it("raises, dedupes by key per origin, and counts only unread action items", async () => {
    const s = new AttentionStore(await tmp(), { now: at("2026-10-27T10:00:00Z") });
    expect(await s.raise(oncall, { key: "sla:1", severity: "action", title: "SLA breach" })).toEqual({ shown: true, notify: true });
    expect(await s.raise(oncall, { key: "sla:1", severity: "action", title: "SLA breach", body: "now 2 h" })).toEqual({ shown: true, notify: false });
    await s.raise(oncall, { key: "info:1", severity: "info", title: "Synced" });
    await s.raise({ kind: "plugin", id: "other" }, { key: "sla:1", severity: "warn", title: "Other" });
    expect((await s.list()).map((i) => [i.origin.id, i.key])).toEqual([["other", "sla:1"], ["oncall", "info:1"], ["oncall", "sla:1"]]);
    expect((await s.list()).find((i) => i.origin.id === "oncall" && i.key === "sla:1")?.body).toBe("now 2 h");
    expect(await s.badge()).toBe(1);
    await s.markRead(oncall, "sla:1");
    expect(await s.badge()).toBe(0);
  });

  it("a dismissed item raised again stays hidden until its severity or title changes", async () => {
    const s = new AttentionStore(await tmp());
    await s.raise(oncall, { key: "k", severity: "warn", title: "Stale PR" });
    await s.dismiss(oncall, "k");
    expect(await s.list()).toEqual([]);
    expect(await s.raise(oncall, { key: "k", severity: "warn", title: "Stale PR", body: "changed body" })).toEqual({ shown: false, notify: false });
    expect(await s.list()).toEqual([]);
    expect(await s.raise(oncall, { key: "k", severity: "action", title: "Stale PR" })).toEqual({ shown: true, notify: true });
    expect((await s.list())[0]).toMatchObject({ key: "k", severity: "action", read: false });
    expect((await s.list())[0]).not.toHaveProperty("dismissed");
  });

  it("a change of severity or title makes a read item unread again", async () => {
    let now = "2026-10-27T10:00:00Z";
    const s = new AttentionStore(await tmp(), { now: () => new Date(now) });
    await s.raise(oncall, { key: "k", severity: "action", title: "A" });
    await s.markRead(oncall, "k");
    now = "2026-10-27T11:00:00Z";
    expect(await s.raise(oncall, { key: "k", severity: "action", title: "A", body: "more" })).toEqual({ shown: true, notify: false });
    expect((await s.list())[0]).toMatchObject({ read: true, at: "2026-10-27T10:00:00.000Z" });
    expect(await s.raise(oncall, { key: "k", severity: "action", title: "B" })).toEqual({ shown: true, notify: true });
    expect(await s.badge()).toBe(1);
    expect((await s.list())[0].at).toBe("2026-10-27T11:00:00.000Z");
  });

  it("markRead with no arguments reads everything; with an origin only its items", async () => {
    const s = new AttentionStore(await tmp());
    await s.raise(oncall, { key: "a", severity: "action", title: "A" });
    await s.raise({ kind: "plugin", id: "other" }, { key: "a", severity: "action", title: "A" });
    await s.markRead(oncall);
    expect(await s.badge()).toBe(1);
    await s.markRead();
    expect(await s.badge()).toBe(0);
  });

  it("resolve removes it; removeOrigin removes all of a plugin's", async () => {
    const s = new AttentionStore(await tmp());
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    await s.raise(oncall, { key: "b", severity: "info", title: "B" });
    await s.raise({ kind: "task", id: "oncall" }, { key: "a", severity: "info", title: "Task A" });
    await s.resolve(oncall, "a");
    expect((await s.list()).map((i) => [i.origin.kind, i.key])).toEqual([["task", "a"], ["plugin", "b"]]);
    await s.removeOrigin(oncall);
    expect((await s.list()).map((i) => i.origin.kind)).toEqual(["task"]);
  });

  it("tells listeners after each change, not after a no-op", async () => {
    const s = new AttentionStore(await tmp());
    let calls = 0;
    const off = s.onChange(() => calls++);
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    await s.resolve(oncall, "missing");
    expect(calls).toBe(1);
    off();
    await s.resolve(oncall, "a");
    expect(calls).toBe(1);
  });

  it("purges items older than 30 days on load", async () => {
    const base = await tmp();
    await new AttentionStore(base, { now: at("2026-09-01T00:00:00Z") }).raise(oncall, { key: "old", severity: "info", title: "Old" });
    await new AttentionStore(base, { now: at("2026-10-27T00:00:00Z") }).raise(oncall, { key: "new", severity: "info", title: "New" });
    expect((await new AttentionStore(base, { now: at("2026-10-27T00:00:00Z") }).list()).map((i) => i.key)).toEqual(["new"]);
  });

  it(`B11: at most ${ATTENTION_LIMITS.perOrigin} open items per origin, the oldest info first`, async () => {
    const s = new AttentionStore(await tmp());
    await s.raise(oncall, { key: "act", severity: "action", title: "Keep" });
    for (let i = 0; i < ATTENTION_LIMITS.perOrigin; i++) await s.raise(oncall, { key: `i${i}`, severity: "info", title: `I${i}` });
    const keys = (await s.list()).map((i) => i.key);
    expect(keys).toHaveLength(ATTENTION_LIMITS.perOrigin);
    expect(keys).toContain("act");
    expect(keys).not.toContain("i0");
  });

  it("a broken file reads as empty and is set aside on the next write", async () => {
    const base = await tmp();
    await fs.mkdir(path.join(base, ".harness"), { recursive: true });
    await fs.writeFile(path.join(base, ".harness", "attention.json"), "{");
    const s = new AttentionStore(base, quiet);
    expect(await s.list()).toEqual([]);
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    expect((await fs.readdir(path.join(base, ".harness"))).some((f) => f.startsWith("attention.json.corrupt-"))).toBe(true);
    expect((await s.list()).map((i) => i.key)).toEqual(["a"]);
  });

  it("the file is agent-writable: items that don't fit the shape or the limits are dropped on read", async () => {
    const base = await tmp();
    await fs.mkdir(path.join(base, ".harness"), { recursive: true });
    const good = { origin: oncall, key: "ok", severity: "info", title: "Fine", at: new Date().toISOString(), read: false };
    const bad = [
      { ...good, key: "long", title: "x".repeat(ATTENTION_LIMITS.titleChars + 1) },
      { ...good, key: "body", body: "x".repeat(ATTENTION_LIMITS.bodyChars + 1) },
      { ...good, key: "sev", severity: "panic" },
      { ...good, key: "orig", origin: { kind: "agent", id: "x" } },
      { ...good, key: "date", at: "yesterday" },
      { ...good, key: "tgt", target: { panel: 3 } },
      "nope",
      { ...good }, // a duplicate key: the first one wins
    ];
    await fs.writeFile(path.join(base, ".harness", "attention.json"), JSON.stringify([good, ...bad]));
    expect((await new AttentionStore(base, quiet).list()).map((i) => i.key)).toEqual(["ok"]);
  });

  it("never reads or writes through a link under the base", async () => {
    const base = await tmp();
    const outside = await tmp();
    await fs.writeFile(path.join(outside, "attention.json"), "[]");
    await fs.symlink(outside, path.join(base, ".harness"));
    const s = new AttentionStore(base, quiet);
    expect(await s.list()).toEqual([]);
    await expect(s.raise(oncall, { key: "a", severity: "info", title: "A" })).rejects.toThrow(/plain folder/);
    expect(await fs.readFile(path.join(outside, "attention.json"), "utf8")).toBe("[]");
  });

  it("a link in place of the file is set aside, never followed", async () => {
    const base = await tmp();
    const outside = path.join(await tmp(), "target.json");
    await fs.writeFile(outside, "[]");
    await fs.mkdir(path.join(base, ".harness"));
    await fs.symlink(outside, path.join(base, ".harness", "attention.json"));
    const s = new AttentionStore(base, quiet);
    expect(await s.list()).toEqual([]);
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    expect(await fs.readFile(outside, "utf8")).toBe("[]");
    expect((await fs.lstat(path.join(base, ".harness", "attention.json"))).isFile()).toBe(true);
  });
});
