import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_SECRETS_OWNER, SecretStore, secretName } from "../../src/main/secrets/secret-store";

/** Reversible, never the Keychain. */
const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString(),
};
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-sec-"));

describe("SecretStore: the harness's keys (tools spec §9)", () => {
  it("logical names: <id> for the harness, plugin.<plugin>.<id> for a plugin", () => {
    expect(secretName("harness", "jira")).toBe("jira");
    expect(secretName({ plugin: "oncall" }, "jira")).toBe("plugin.oncall.jira");
  });

  it("stores under _harness/<id>.bin, encrypted, 0600 in a 0700 folder, and reads back", async () => {
    const dir = path.join(await tmp(), "secrets");
    const s = new SecretStore(dir, crypto);
    expect(await s.setHarness("jira", "  tok-123456789  ")).toEqual({ ok: true });
    const file = path.join(dir, HARNESS_SECRETS_OWNER, "jira.bin");
    expect((await fs.readFile(file)).toString()).not.toContain("tok-123456789");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.join(dir, HARNESS_SECRETS_OWNER))).mode & 0o777).toBe(0o700);
    expect(await s.storedHarness()).toEqual(["jira"]);
    expect(await s.harnessValues(["jira", "nope"])).toEqual({ jira: "tok-123456789" });
  });

  it("a plugin can't read the harness's keys, nor the other way", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    await s.setHarness("jira", "tok-HARNESS-1");
    await s.set("oncall", "jira", "tok-PLUGIN-22");
    expect(await s.values("oncall", ["jira"])).toEqual({ jira: "tok-PLUGIN-22" });
    expect(await s.harnessValues(["jira"])).toEqual({ jira: "tok-HARNESS-1" });
    expect(await s.stored("_harness")).toEqual([]);
    expect(await s.values("_harness", ["jira"])).toEqual({});
    expect(await s.set("_harness", "jira", "tok-PLUGIN-22")).toMatchObject({ ok: false });
    expect(await s.harnessValues(["jira"])).toEqual({ jira: "tok-HARNESS-1" });
  });

  it("a plugin's delete and deleteAll never reach the harness's folder", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    await s.setHarness("jira", "tok-HARNESS-1");
    await s.delete("_harness", "jira");
    await s.deleteAll("_harness");
    expect(await s.storedHarness()).toEqual(["jira"]);
  });

  it("harness keys refuse to store without encryption, and create nothing", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), { ...crypto, available: () => false });
    expect(await s.setHarness("jira", "tok-123456789")).toEqual({ ok: false, message: "This computer can't encrypt keys for this app" });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("refuses bad ids and values as plugin keys do", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    for (const id of ["../x", "__proto__", "Jira", "a/b", ""]) expect(await s.setHarness(id, "tok-123456789")).toMatchObject({ ok: false });
    expect(await s.setHarness("jira", "short")).toEqual({ ok: false, message: "A key is at least 8 characters" });
    expect(await s.setHarness("jira", "tok-123\n456789")).toEqual({ ok: false, message: "A key is one line" });
    expect(await s.storedHarness()).toEqual([]);
  });

  it("deleteHarness removes one key; D0: nothing is created before the first key", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), crypto);
    expect(await s.storedHarness()).toEqual([]);
    expect(await s.harnessValues(["jira"])).toEqual({});
    await s.deleteHarness("jira");
    await expect(fs.access(path.join(root, "s"))).rejects.toThrow();
    await s.setHarness("jira", "tok-123456789");
    await s.setHarness("linear", "tok-987654321");
    await s.deleteHarness("jira");
    expect(await s.storedHarness()).toEqual(["linear"]);
  });

  it("a linked _harness folder reads as no keys and is never written through", async () => {
    const root = await tmp();
    const dir = path.join(root, "s");
    await fs.mkdir(dir, { mode: 0o700 });
    const elsewhere = path.join(root, "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(dir, HARNESS_SECRETS_OWNER));
    const s = new SecretStore(dir, crypto);
    expect(await s.storedHarness()).toEqual([]);
    expect(await s.setHarness("jira", "tok-123456789")).toMatchObject({ ok: false });
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });
});
