import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectionsController, connectTests, missingSecretMessage } from "../../src/main/secrets/connections";
import { SecretStore } from "../../src/main/secrets/secret-store";

/** Reversible, never the Keychain. */
const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString(),
};
const secrets = [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com." }, { id: "gh", label: "GitHub token" }];
async function ctl() {
  const store = new SecretStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), "hh-conn-")), "s"), crypto);
  const changes: unknown[] = [];
  const logs: unknown[][] = [];
  const c = new ConnectionsController({ secrets, store, changed: (v) => changes.push(v), log: (...a) => void logs.push(a) });
  return { c, store, changes, logs };
}

describe("ConnectionsController (tools spec §9: Settings › Connections)", () => {
  it("lists every declared secret in manifest order, not set", async () => {
    const { c } = await ctl();
    expect(await c.view()).toEqual({
      connections: [
        { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com.", set: false },
        { id: "gh", label: "GitHub token", set: false },
      ],
    });
  });

  it("set and delete change only the state, push the view, and no value in the view or any answer", async () => {
    const { c, changes, logs } = await ctl();
    const r = await c.set("jira", "tok-SECRET-123456");
    expect(r).toEqual({ ok: true });
    const view = await c.view();
    expect(view.connections[0].set).toBe(true);
    expect(view.connections[1].set).toBe(false);
    expect(await c.delete("jira")).toEqual({ ok: true });
    expect((await c.view()).connections[0].set).toBe(false);
    expect(changes).toHaveLength(2);
    expect((changes[0] as { connections: { set: boolean }[] }).connections[0].set).toBe(true);
    expect((changes[1] as { connections: { set: boolean }[] }).connections[0].set).toBe(false);
    expect(JSON.stringify([view, r, changes, logs])).not.toContain("tok-SECRET-123456");
  });

  it("an undeclared id is refused and stores nothing", async () => {
    const { c, store, changes } = await ctl();
    expect(await c.set("other", "tok-123456789")).toEqual({ ok: false, message: "This harness declares no such key" });
    expect(await c.delete("other")).toEqual({ ok: false, message: "This harness declares no such key" });
    // A name from Object.prototype is no declared key either.
    expect(await c.set("constructor", "tok-123456789")).toEqual({ ok: false, message: "This harness declares no such key" });
    expect(await store.storedHarness()).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("a store refusal comes back as its message (short, multi-line, no encryption)", async () => {
    const { c, changes } = await ctl();
    expect(await c.set("jira", "short")).toEqual({ ok: false, message: "A key is at least 8 characters" });
    expect(changes).toEqual([]);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-conn-"));
    const plain = new ConnectionsController({
      secrets,
      store: new SecretStore(path.join(dir, "s"), { ...crypto, available: () => false }),
      changed: () => {},
      log: () => {},
    });
    const refused = await plain.set("jira", "tok-123456789");
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain("tok-123456789");
    expect((await plain.view()).connections[0].set).toBe(false);
  });

  it("a store that throws answers a fixed refusal and logs without the value", async () => {
    const logs: unknown[][] = [];
    const c = new ConnectionsController({
      secrets,
      store: {
        storedHarness: async () => [],
        setHarness: async () => {
          throw new Error("disk full");
        },
        deleteHarness: async () => {},
      },
      changed: () => {},
      log: (...a) => void logs.push(a),
    });
    expect(await c.set("jira", "tok-123456789")).toEqual({ ok: false, message: "This key can't be stored" });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs.map(([m]) => m))).not.toContain("tok-123456789");
  });

  it("a store that can't list reads as no key set", async () => {
    const c = new ConnectionsController({
      secrets,
      store: {
        storedHarness: async () => {
          throw new Error("unreadable");
        },
        setHarness: async () => ({ ok: true }),
        deleteHarness: async () => {},
      },
      changed: () => {},
    });
    expect((await c.view()).connections.map((x) => x.set)).toEqual([false, false]);
    expect(await c.allSet(["jira"])).toBe(false);
  });

  it("allSet tells whether every listed id is stored", async () => {
    const { c } = await ctl();
    await c.set("jira", "tok-123456789");
    expect(await c.allSet(["jira"])).toBe(true);
    expect(await c.allSet(["jira", "gh"])).toBe(false);
  });

  it("allSet of an empty list is false (a step that names no key is never complete)", async () => {
    const { c } = await ctl();
    await c.set("jira", "tok-123456789");
    expect(await c.allSet([])).toBe(false);
  });

  it("missingSecretMessage names the label and where to set it", () => {
    expect(missingSecretMessage("Jira API token")).toBe("Jira API token is not set — Settings › Connections");
  });
});

describe("Test connection (tools spec §9, slice 2)", () => {
  type Answer = { ok: true; result: unknown } | { ok: false; error: string };
  async function testing(answer: (tool: string) => Promise<Answer>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-conn-"));
    const store = new SecretStore(path.join(dir, "secrets"), crypto);
    const file = path.join(dir, "connections.json");
    const runs: string[] = [];
    const changes: { connections: Record<string, unknown>[] }[] = [];
    const logs: unknown[][] = [];
    const c = new ConnectionsController({
      secrets,
      store,
      changed: (v) => changes.push(v as never),
      log: (...a) => void logs.push(a),
      test: {
        steps: [{ secrets: ["jira"], tool: "jira-check" }],
        file,
        run: (tool) => (runs.push(tool), answer(tool)),
        now: () => new Date("2026-10-29T10:00:00.000Z"),
      },
    });
    return { c, store, file, runs, changes, logs };
  }

  it("connectTests lists each connect step that names a test, and nothing else", () => {
    expect(
      connectTests([
        { kind: "form", id: "a" },
        { kind: "connect", id: "b", secrets: ["jira"], test: "jira-check" },
        { kind: "connect", id: "c", secrets: ["gh"] },
      ] as never),
    ).toEqual([{ secrets: ["jira"], tool: "jira-check" }]);
    expect(connectTests(undefined)).toEqual([]);
  });

  it("test runs the tool as ui with {} and keeps { at, ok, message? } per secret in connections.json (0600), never a value", async () => {
    const t = await testing(async () => ({ ok: true, result: { user: "me" } }));
    await t.c.set("jira", "tok-SECRET-123456");
    expect(await t.c.test("jira")).toEqual({ ok: true });
    expect(t.runs).toEqual(["jira-check"]);
    expect(JSON.parse(await fs.readFile(t.file, "utf8"))).toEqual({ tests: { jira: { at: "2026-10-29T10:00:00.000Z", ok: true } } });
    expect((await fs.stat(t.file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(t.file, "utf8")).not.toContain("tok-SECRET-123456");

    // A failure keeps the tool's error, with every stored key hidden and cut to 300 characters.
    const failing = await testing(async () => ({ ok: false, error: `401 for tok-SECRET-123456 ${"x".repeat(400)}` }));
    await failing.c.set("jira", "tok-SECRET-123456");
    const answer = await failing.c.test("jira");
    expect(answer.ok).toBe(false);
    const stored = JSON.parse(await fs.readFile(failing.file, "utf8")).tests.jira;
    expect(stored.ok).toBe(false);
    expect([...stored.message].length).toBeLessThanOrEqual(300);
    expect(stored.message).toMatch(/^401 for /);
    expect(answer).toEqual({ ok: false, message: stored.message });
    const all = JSON.stringify([answer, stored, failing.changes, failing.logs, await fs.readFile(failing.file, "utf8")]);
    expect(all).not.toContain("tok-SECRET-123456");
  });

  it("a stored key that crosses the 300th character is hidden before the cut: no start of it survives", async () => {
    const key = "tok-SECRET-123456";
    const t = await testing(async () => ({ ok: false, error: `${"x".repeat(295)}${key} and more` }));
    await t.c.set("jira", key);
    const answer = await t.c.test("jira");
    expect(answer.ok).toBe(false);
    const file = await fs.readFile(t.file, "utf8");
    for (const seen of [JSON.stringify(answer), file, JSON.stringify(t.changes)]) {
      expect(seen).not.toContain(key.slice(0, 5));
      expect(seen).not.toContain("tok-");
    }
    expect([...JSON.parse(file).tests.jira.message].length).toBe(300);
  });

  it("a test overlapping a set or delete of its key keeps nothing and says to test again", async () => {
    for (const change of ["set", "delete"] as const) {
      let release!: (a: Answer) => void;
      const t = await testing(() => new Promise<Answer>((resolve) => (release = resolve)));
      await t.c.set("jira", "tok-OLD-123456789");
      const running = t.c.test("jira");
      await new Promise((r) => setTimeout(r, 10));
      if (change === "set") await t.c.set("jira", "tok-NEW-123456789");
      else await t.c.delete("jira");
      release({ ok: true, result: null });
      expect(await running).toEqual({ ok: false, message: "The key changed during the test: test again" });
      expect((await t.c.view()).connections[0]).not.toHaveProperty("lastTest");
      // The next test, with no change in between, is kept.
      const again = t.c.test("jira");
      await new Promise((r) => setTimeout(r, 10));
      release({ ok: true, result: null });
      expect(await again).toEqual({ ok: true });
      expect((await t.c.view()).connections[0]).toHaveProperty("lastTest");
    }
  });

  it("a run that throws keeps a fixed text, logged, never its error", async () => {
    const t = await testing(async () => {
      throw new Error("at /Users/me/secret/path.ts:1");
    });
    expect(await t.c.test("jira")).toEqual({ ok: false, message: "The test couldn't run" });
    expect(JSON.parse(await fs.readFile(t.file, "utf8")).tests.jira).toMatchObject({ ok: false, message: "The test couldn't run" });
    expect(t.logs).toHaveLength(1);
  });

  it("a secret's test state shows in the view as lastTest", async () => {
    const t = await testing(async () => ({ ok: false, error: "Jira API token is not set — Settings › Connections" }));
    expect((await t.c.view()).connections).toEqual([
      { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com.", set: false, test: true },
      { id: "gh", label: "GitHub token", set: false },
    ]);
    await t.c.test("jira");
    const lastTest = { at: "2026-10-29T10:00:00.000Z", ok: false, message: "Jira API token is not set — Settings › Connections" };
    expect((await t.c.view()).connections[0]).toMatchObject({ test: true, lastTest });
    // Pushed to the window.
    expect(t.changes.at(-1)!.connections[0]).toMatchObject({ lastTest });
    // Kept across a new controller (the file is the record).
    const again = new ConnectionsController({
      secrets,
      store: t.store,
      changed: () => {},
      test: { steps: [{ secrets: ["jira"], tool: "jira-check" }], file: t.file, run: async () => ({ ok: true, result: null }) },
    });
    expect((await again.view()).connections[0]).toMatchObject({ lastTest });
  });

  it("storing or deleting the key forgets its last test", async () => {
    const t = await testing(async () => ({ ok: true, result: null }));
    await t.c.test("jira");
    expect((await t.c.view()).connections[0]).toHaveProperty("lastTest");
    await t.c.set("jira", "tok-123456789");
    expect((await t.c.view()).connections[0]).not.toHaveProperty("lastTest");
    await t.c.test("jira");
    await t.c.delete("jira");
    expect((await t.c.view()).connections[0]).not.toHaveProperty("lastTest");
  });

  it("a key with no test, an undeclared key or a prototype name is refused and runs nothing", async () => {
    const t = await testing(async () => ({ ok: true, result: null }));
    expect(await t.c.test("gh")).toEqual({ ok: false, message: "This key has no test" });
    expect(await t.c.test("other")).toEqual({ ok: false, message: "This harness declares no such key" });
    expect(await t.c.test("constructor")).toEqual({ ok: false, message: "This harness declares no such key" });
    expect(t.runs).toEqual([]);
    await expect(fs.stat(t.file)).rejects.toThrow();
  });

  it("a connections.json that is not ours (bad JSON, a link, undeclared ids, bad fields) reads as no tests", async () => {
    const t = await testing(async () => ({ ok: true, result: null }));
    await fs.writeFile(t.file, "{nope");
    expect((await t.c.view()).connections[0]).not.toHaveProperty("lastTest");
    await fs.writeFile(t.file, '{"tests":{"gh":{"at":"x","ok":true},"jira":{"at":1,"ok":"yes"},"__proto__":{"at":"x","ok":true}}}');
    expect((await t.c.view()).connections.map((c) => "lastTest" in c)).toEqual([false, false]);
    await fs.rm(t.file);
    const elsewhere = path.join(path.dirname(t.file), "elsewhere.json");
    await fs.writeFile(elsewhere, JSON.stringify({ tests: { jira: { at: "2026-10-29T10:00:00.000Z", ok: true } } }));
    await fs.symlink(elsewhere, t.file);
    expect((await t.c.view()).connections[0]).not.toHaveProperty("lastTest");
    // Nor is it written through.
    await t.c.test("jira");
    expect(JSON.parse(await fs.readFile(elsewhere, "utf8")).tests.jira.at).toBe("2026-10-29T10:00:00.000Z");
  });

  it("D0: without a test tool there is no Test and no connections.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-conn-"));
    const store = new SecretStore(path.join(dir, "secrets"), crypto);
    for (const test of [undefined, { steps: [], file: path.join(dir, "connections.json"), run: async () => ({ ok: true as const, result: null }) }]) {
      const c = new ConnectionsController({ secrets, store, changed: () => {}, ...(test ? { test } : {}) });
      expect(c.testable).toBe(false);
      await c.set("jira", "tok-123456789");
      await c.delete("jira");
      expect((await c.view()).connections).toEqual([
        { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com.", set: false },
        { id: "gh", label: "GitHub token", set: false },
      ]);
      expect(await c.test("jira")).toEqual({ ok: false, message: "This key has no test" });
    }
    expect(await fs.readdir(dir)).toEqual(["secrets"]);
  });
});
