import { createHmac } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATTENTION_LIMITS, AttentionStore } from "../src/index";

const oncall = { kind: "plugin" as const, id: "oncall" };
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-att-"));
const at = (iso: string) => () => new Date(iso);
const quiet = { log: () => {} };
// A fake of the shell's HMAC (its key lives outside the base, Task 16).
const hmac = (text: string) => createHmac("sha256", "test key").update(text).digest("hex");
const keyed = { sign: hmac, verify: (text: string, tag: string) => hmac(text) === tag };
const store = (base: string, opts: Partial<ConstructorParameters<typeof AttentionStore>[1]> = {}) => new AttentionStore(base, { ...keyed, ...opts });
const fileOf = (base: string) => path.join(base, ".harness", "attention.json");
const readItems = async (base: string) => JSON.parse(await fs.readFile(fileOf(base), "utf8")) as Record<string, unknown>[];

describe("AttentionStore (plugins spec §6)", () => {
  it("D0: no file until the first item", async () => {
    const base = await tmp();
    const s = store(base);
    expect(await s.list()).toEqual([]);
    expect(await s.badge()).toBe(0);
    await s.markRead();
    await s.resolve(oncall, "nothing");
    await s.removeOrigin(oncall);
    await expect(fs.access(path.join(base, ".harness"))).rejects.toThrow();
  });

  it("raises, dedupes by key per origin, and counts only unread action items", async () => {
    const s = store(await tmp(), { now: at("2026-10-27T10:00:00Z") });
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
    const s = store(await tmp());
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
    const s = store(await tmp(), { now: () => new Date(now) });
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
    const s = store(await tmp());
    await s.raise(oncall, { key: "a", severity: "action", title: "A" });
    await s.raise({ kind: "plugin", id: "other" }, { key: "a", severity: "action", title: "A" });
    await s.markRead(oncall);
    expect(await s.badge()).toBe(1);
    await s.markRead();
    expect(await s.badge()).toBe(0);
  });

  it("resolve removes it; removeOrigin removes all of a plugin's", async () => {
    const s = store(await tmp());
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    await s.raise(oncall, { key: "b", severity: "info", title: "B" });
    await s.raise({ kind: "task", id: "oncall" }, { key: "a", severity: "info", title: "Task A" });
    await s.resolve(oncall, "a");
    expect((await s.list()).map((i) => [i.origin.kind, i.key])).toEqual([["task", "a"], ["plugin", "b"]]);
    await s.removeOrigin(oncall);
    expect((await s.list()).map((i) => i.origin.kind)).toEqual(["task"]);
  });

  it("tells listeners after each change, not after a no-op", async () => {
    const s = store(await tmp());
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
    await store(base, { now: at("2026-09-01T00:00:00Z") }).raise(oncall, { key: "old", severity: "info", title: "Old" });
    await store(base, { now: at("2026-10-27T00:00:00Z") }).raise(oncall, { key: "new", severity: "info", title: "New" });
    expect((await store(base, { now: at("2026-10-27T00:00:00Z") }).list()).map((i) => i.key)).toEqual(["new"]);
  });

  it(`B11: at most ${ATTENTION_LIMITS.perOrigin} open items per origin, the oldest info first`, async () => {
    const s = store(await tmp());
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
    const s = store(base, quiet);
    expect(await s.list()).toEqual([]);
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    expect((await fs.readdir(path.join(base, ".harness"))).some((f) => f.startsWith("attention.json.corrupt-"))).toBe(true);
    expect((await s.list()).map((i) => i.key)).toEqual(["a"]);
  });

  it("the file is agent-writable: items that don't fit the shape or the limits are dropped on read", async () => {
    const base = await tmp();
    await fs.mkdir(path.join(base, ".harness"), { recursive: true });
    // Shape only here: every tag is taken as genuine.
    const good = { origin: oncall, key: "ok", severity: "info", title: "Fine", at: new Date().toISOString(), read: false, tag: "t" };
    const bad = [
      { ...good, key: "long", title: "x".repeat(ATTENTION_LIMITS.titleChars + 1) },
      { ...good, key: "body", body: "x".repeat(ATTENTION_LIMITS.bodyChars + 1) },
      { ...good, key: "sev", severity: "panic" },
      { ...good, key: "orig", origin: { kind: "agent", id: "x" } },
      { ...good, key: "date", at: "yesterday" },
      { ...good, key: "tgt", target: { panel: 3 } },
      { ...good, key: "notag", tag: undefined },
      "nope",
      { ...good }, // a duplicate key: the first one wins
    ];
    await fs.writeFile(path.join(base, ".harness", "attention.json"), JSON.stringify([good, ...bad]));
    expect((await store(base, { ...quiet, verify: () => true }).list()).map((i) => i.key)).toEqual(["ok"]);
  });

  it("never reads or writes through a link under the base", async () => {
    const base = await tmp();
    const outside = await tmp();
    await fs.writeFile(path.join(outside, "attention.json"), "[]");
    await fs.symlink(outside, path.join(base, ".harness"));
    const s = store(base, quiet);
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
    const s = store(base, quiet);
    expect(await s.list()).toEqual([]);
    await s.raise(oncall, { key: "a", severity: "info", title: "A" });
    expect(await fs.readFile(outside, "utf8")).toBe("[]");
    expect((await fs.lstat(path.join(base, ".harness", "attention.json"))).isFile()).toBe(true);
  });

  describe("forged items (the agent can write the file)", () => {
    it("needs sign and verify", () => {
      // @ts-expect-error -- no signer
      expect(() => new AttentionStore("/nowhere", {})).toThrow(/sign/);
    });

    it("an item without a tag is dropped", async () => {
      const base = await tmp();
      await fs.mkdir(path.join(base, ".harness"), { recursive: true });
      const forged = { origin: oncall, key: "x", severity: "action", title: "Run this", target: { action: "deploy", vars: { cmd: "rm" } }, at: new Date().toISOString(), read: false };
      await fs.writeFile(fileOf(base), JSON.stringify([forged]));
      const logs: string[] = [];
      expect(await store(base, { log: (m) => logs.push(m) }).list()).toEqual([]);
      expect(logs.join("\n")).toMatch(/tag/);
    });

    it("a genuine item is kept and its tag never leaves the store", async () => {
      const base = await tmp();
      await store(base).raise(oncall, { key: "k", severity: "action", title: "Real", target: { action: "ack", vars: { b: 1, a: [2] } } });
      expect(typeof (await readItems(base))[0].tag).toBe("string");
      const items = await store(base).list();
      expect(items.map((i) => i.title)).toEqual(["Real"]);
      expect(items[0]).not.toHaveProperty("tag");
    });

    it.each([
      ["title", (i: Record<string, unknown>) => ({ ...i, title: "Evil" })],
      ["origin", (i: Record<string, unknown>) => ({ ...i, origin: { kind: "plugin", id: "other" } })],
      ["target vars", (i: Record<string, unknown>) => ({ ...i, target: { action: "ack", vars: { b: 2, a: [2] } } })],
      ["body", (i: Record<string, unknown>) => ({ ...i, body: "added" })],
      ["at", (i: Record<string, unknown>) => ({ ...i, at: new Date(Date.parse(i.at as string) + 1000).toISOString() })],
      ["tag from another item", (i: Record<string, unknown>, other: Record<string, unknown>) => ({ ...i, tag: other.tag })],
    ])("a tampered %s is dropped", async (_, tamper) => {
      const base = await tmp();
      const s = store(base, quiet);
      await s.raise(oncall, { key: "k", severity: "action", title: "Real", target: { action: "ack", vars: { b: 1, a: [2] } } });
      await s.raise(oncall, { key: "j", severity: "info", title: "Other" });
      const [first, second] = await readItems(base);
      await fs.writeFile(fileOf(base), JSON.stringify([tamper(first, second), second]));
      expect((await s.list()).map((i) => i.key)).toEqual(["j"]);
    });

    it("read and dismissed are the person's marks, not signed", async () => {
      const base = await tmp();
      await store(base).raise(oncall, { key: "k", severity: "action", title: "Real" });
      const [item] = await readItems(base);
      await fs.writeFile(fileOf(base), JSON.stringify([{ ...item, read: true }]));
      expect(await store(base).badge()).toBe(0);
    });
  });

  it("controls and bidi overrides are stripped from what is read", async () => {
    const s = store(await tmp());
    await s.raise(oncall, { key: "k", severity: "info", title: "Pay \u202eevil\u202c now\u0007", body: "line 1\nline\u0000 2\u2066" });
    expect((await s.list())[0]).toMatchObject({ title: "Pay evil now", body: "line 1\nline 2" });
  });

  it("items dated more than a day ahead are dropped on read", async () => {
    const base = await tmp();
    await store(base, { now: at("2026-10-29T12:00:00Z") }).raise(oncall, { key: "soon", severity: "info", title: "Soon" });
    await store(base, { now: at("2026-11-01T00:00:00Z") }).raise(oncall, { key: "far", severity: "info", title: "Far" });
    expect((await store(base, { ...quiet, now: at("2026-10-28T13:00:00Z") }).list()).map((i) => i.key)).toEqual(["soon"]);
  });

  it(`the per-origin cap also holds for what is read`, async () => {
    const base = await tmp();
    await fs.mkdir(path.join(base, ".harness"), { recursive: true });
    const now = new Date().toISOString();
    const items = Array.from({ length: ATTENTION_LIMITS.perOrigin + 20 }, (_, n) => ({ origin: oncall, key: `i${n}`, severity: n === 0 ? "action" : "info", title: "I", at: now, read: false, tag: "t" }));
    await fs.writeFile(fileOf(base), JSON.stringify([...items, { ...items[1], origin: { kind: "plugin", id: "other" } }]));
    const keys = (await store(base, { ...quiet, verify: () => true }).list()).filter((i) => i.origin.id === "oncall").map((i) => i.key);
    expect(keys).toHaveLength(ATTENTION_LIMITS.perOrigin);
    expect(keys).toContain("i0");
    expect(keys).not.toContain("i1");
  });

  it("known(origin) hides items of origins that are not known, and keeps them in the file", async () => {
    const base = await tmp();
    await store(base).raise(oncall, { key: "a", severity: "action", title: "A" });
    await store(base).raise({ kind: "plugin", id: "gone" }, { key: "b", severity: "action", title: "B" });
    const s = store(base, { known: (o) => o.id !== "gone" });
    expect((await s.list()).map((i) => i.key)).toEqual(["a"]);
    expect(await s.badge()).toBe(1);
    await s.raise(oncall, { key: "c", severity: "info", title: "C" });
    expect((await store(base).list()).map((i) => i.key)).toEqual(["c", "b", "a"]);
  });

  it("a job's items (parallel part 3) are written, read back and resolved like any origin's", async () => {
    const base = await tmp();
    const job = { kind: "job" as const, id: "sync:main" };
    await store(base).raise(job, { key: "result", severity: "action", title: "Two need you", target: { action: "implement", vars: { scope: "main" } } });
    expect(await store(base).list()).toMatchObject([{ origin: job, key: "result", target: { action: "implement", vars: { scope: "main" } } }]);
    // A rule per kind: a store that knows only plugins never shows it.
    expect(await store(base, { known: (o) => o.kind === "plugin" }).list()).toEqual([]);
    await store(base).resolve(job, "result");
    expect(await store(base).list()).toEqual([]);
  });

  it("the harness tools' item (tools Decision 7) is written, read back and resolved like any origin's", async () => {
    const base = await tmp();
    const tools = { kind: "tool" as const, id: "notes" };
    await store(base).raise(tools, { key: "off", severity: "action", title: "Tools are off after repeated crashes. Restart the app to turn them on." });
    expect(await store(base).list()).toMatchObject([{ origin: tools, key: "off", severity: "action" }]);
    expect(await store(base, { known: (o) => o.kind === "plugin" }).list()).toEqual([]);
    await store(base).resolve(tools, "off");
    expect(await store(base).list()).toEqual([]);
  });

  it("markRead with a key but no origin is refused", async () => {
    const s = store(await tmp());
    await s.raise(oncall, { key: "k", severity: "action", title: "A" });
    expect(await s.markRead(undefined, "k")).toBe(false);
    expect(await s.badge()).toBe(1);
    expect(await s.markRead(oncall, "k")).toBe(true);
    expect(await s.badge()).toBe(0);
  });
});
