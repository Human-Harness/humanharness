import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SecretStore } from "../src/main/plugin-secrets";

/** A reversible fake of safeStorage (never the real Keychain): never the plaintext on disk. */
const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => {
    const s = b.toString();
    if (!s.startsWith("enc:")) throw new Error("bad");
    return Buffer.from(s.slice(4), "hex").toString();
  },
};
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-sec-"));

describe("SecretStore (plugins spec §7 keys, D5, B6)", () => {
  it("stores encrypted, 0600, and reads back in main only", async () => {
    const dir = path.join(await tmp(), "secrets");
    const s = new SecretStore(dir, crypto);
    expect(await s.set("oncall", "jira", "  tok-123456789  ")).toEqual({ ok: true });
    const file = path.join(dir, "oncall", "jira.bin");
    expect((await fs.readFile(file)).toString()).not.toContain("tok-123456789");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(dir, "oncall"))).mode & 0o777).toBe(0o700);
    expect(await s.stored("oncall")).toEqual(["jira"]);
    expect(await s.values("oncall", ["jira"])).toEqual({ jira: "tok-123456789" });
    expect(await fs.readdir(path.join(dir, "oncall"))).toEqual(["jira.bin"]);
  });

  it("D0: no folder until the first key", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "secrets"), crypto);
    expect(await s.stored("oncall")).toEqual([]);
    expect(await s.values("oncall", ["jira"])).toEqual({});
    await s.delete("oncall", "jira");
    await s.deleteAll("oncall");
    await expect(fs.access(path.join(root, "secrets"))).rejects.toThrow();
  });

  it("refuses short, long, multi-line values and bad ids", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), crypto);
    expect(await s.set("oncall", "jira", "  short  ")).toEqual({ ok: false, message: "A key is at least 8 characters" });
    expect(await s.set("oncall", "jira", "x".repeat(8193))).toEqual({ ok: false, message: "A key is at most 8192 characters" });
    expect(await s.set("oncall", "jira", "abc\ndefghij")).toEqual({ ok: false, message: "A key is one line" });
    expect(await s.set("oncall", "jira", "abc\u0000defghij")).toMatchObject({ ok: false });
    expect(await s.set("oncall", "jira", "abc\u007fdefghij")).toMatchObject({ ok: false });
    for (const [plugin, id] of [["../x", "jira"], ["oncall", "../../x"], ["oncall", "__proto__"], ["Oncall", "jira"], ["oncall", "a/b"], ["", "jira"]]) {
      expect(await s.set(plugin, id, "tok-123456789")).toMatchObject({ ok: false });
    }
    expect(await s.set("oncall", "jira", 42 as unknown as string)).toMatchObject({ ok: false });
    await expect(fs.access(path.join(root, "s"))).rejects.toThrow();
    expect(await s.stored("../x")).toEqual([]);
    expect(await s.values("oncall", ["../../x"])).toEqual({});
  });

  it("refuses to store when the computer can't encrypt, and creates nothing", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), { ...crypto, available: () => false });
    expect(await s.set("oncall", "jira", "tok-123456789")).toEqual({ ok: false, message: "This computer can't encrypt keys for this app" });
    await expect(fs.access(path.join(root, "s"))).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("an encryption failure is a refusal that never carries the value, and creates nothing", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), {
      ...crypto,
      encrypt: (t: string) => {
        throw new Error(`boom ${t}`);
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await s.set("oncall", "jira", "tok-123456789");
    expect(r).toEqual({ ok: false, message: "This computer can't encrypt keys for this app" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("tok-123456789");
    await expect(fs.access(path.join(root, "s"))).rejects.toThrow();
    warn.mockRestore();
  });

  it("replaces a stored key", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    await s.set("a", "x", "tok-123456789");
    await s.set("a", "x", "tok-987654321");
    expect(await s.values("a", ["x"])).toEqual({ x: "tok-987654321" });
  });

  it("delete and deleteAll", async () => {
    const dir = path.join(await tmp(), "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await s.set("a", "y", "tok-123456789");
    await s.set("b", "x", "tok-123456789");
    await s.delete("a", "x");
    expect(await s.stored("a")).toEqual(["y"]);
    await s.deleteAll("a");
    expect(await s.stored("a")).toEqual([]);
    await expect(fs.access(path.join(dir, "a"))).rejects.toThrow();
    expect(await s.stored("b")).toEqual(["x"]);
  });

  it("deleteAll also removes the temp files a crashed write left", async () => {
    const dir = path.join(await tmp(), "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await fs.writeFile(path.join(dir, "a", ".x.bin.0b9a3f4e-6c1d-4e2a-9f8b-7a6c5d4e3f21.tmp"), "half");
    await fs.writeFile(path.join(dir, "a", ".gone.bin.1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f.tmp"), "half");
    expect(await s.stored("a")).toEqual(["x"]);
    await s.deleteAll("a");
    await expect(fs.access(path.join(dir, "a"))).rejects.toThrow();
  });

  it("a key folder that can't be looked at reads as no keys (logged), and nothing rejects", async () => {
    if (process.getuid?.() === 0) return; // root reads through 0000
    const dir = path.join(await tmp(), "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await fs.chmod(dir, 0o000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await s.stored("a")).toEqual([]);
      expect(await s.values("a", ["x"])).toEqual({});
      await s.delete("a", "x");
      await s.deleteAll("a");
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("tok-123456789");
    } finally {
      await fs.chmod(dir, 0o700);
      warn.mockRestore();
    }
    expect(await s.values("a", ["x"])).toEqual({ x: "tok-123456789" });
  });

  it("refuses a hard-linked key file", async () => {
    const root = await tmp();
    const dir = path.join(root, "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await fs.link(path.join(dir, "a", "x.bin"), path.join(root, "copy.bin"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await s.values("a", ["x"])).toEqual({});
    expect(JSON.stringify(warn.mock.calls)).toContain("hard-linked");
    warn.mockRestore();
    await fs.rm(path.join(root, "copy.bin"));
    expect(await s.values("a", ["x"])).toEqual({ x: "tok-123456789" });
  });

  it("refuses a key file over 64 KB", async () => {
    const dir = path.join(await tmp(), "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await s.set("a", "y", "tok-987654321");
    // A valid encryption padded past the cap: the size alone refuses it, before decrypting.
    const big = Buffer.concat([crypto.encrypt("tok-123456789"), Buffer.alloc(64 * 1024 + 1 - crypto.encrypt("tok-123456789").length, 0x30)]);
    await fs.writeFile(path.join(dir, "a", "x.bin"), big);
    const exact = Buffer.alloc(64 * 1024, 0x30);
    await fs.writeFile(path.join(dir, "a", "y.bin"), exact);
    const decrypt = vi.fn(crypto.decrypt);
    const watched = new SecretStore(dir, { ...crypto, decrypt });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await watched.values("a", ["x", "y"])).toEqual({});
    expect(JSON.stringify(warn.mock.calls)).toContain("too large");
    // Only the file at the cap reached decrypt.
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0][0].length).toBe(64 * 1024);
    warn.mockRestore();
  });

  it("values returns only the ids asked for, of that plugin only", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    await s.set("a", "x", "tok-aaaaaaaaa");
    await s.set("a", "y", "tok-bbbbbbbbb");
    await s.set("b", "z", "tok-ccccccccc");
    expect(await s.values("a", ["x", "z"])).toEqual({ x: "tok-aaaaaaaaa" });
  });

  it("a value that no longer decrypts reads as missing (logged), never as garbage", async () => {
    const dir = path.join(await tmp(), "s");
    const s = new SecretStore(dir, crypto);
    await s.set("a", "x", "tok-123456789");
    await s.set("a", "y", "tok-987654321");
    await fs.writeFile(path.join(dir, "a", "x.bin"), "garbage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await s.values("a", ["x", "y"])).toEqual({ y: "tok-987654321" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const broken = new SecretStore(dir, {
      ...crypto,
      decrypt: () => {
        throw new Error("bad");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await broken.values("a", ["y"])).toEqual({});
    vi.restoreAllMocks();
  });

  it("never reads or writes through a link", async () => {
    const root = await tmp();
    const dir = path.join(root, "s");
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "x.bin"), crypto.encrypt("tok-planted00"));
    const s = new SecretStore(dir, crypto);
    await s.set("b", "x", "tok-123456789");
    // A plugin folder that is a link to elsewhere.
    await fs.symlink(outside, path.join(dir, "a"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await s.values("a", ["x"])).toEqual({});
    expect(await s.stored("a")).toEqual([]);
    expect(await s.set("a", "y", "tok-123456789")).toMatchObject({ ok: false });
    await expect(fs.access(path.join(outside, "y.bin"))).rejects.toThrow();
    await s.deleteAll("a");
    expect(await fs.readdir(outside)).toEqual(["x.bin"]);
    // A key file that is a link.
    await fs.symlink(path.join(outside, "x.bin"), path.join(dir, "b", "y.bin"));
    expect(await s.values("b", ["y"])).toEqual({});
    vi.restoreAllMocks();
  });
});
