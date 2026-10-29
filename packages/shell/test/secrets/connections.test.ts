import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectionsController, missingSecretMessage } from "../../src/main/secrets/connections";
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
