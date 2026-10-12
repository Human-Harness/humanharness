import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SharedConfigStore, noticeAccepted, sharedConfigDir } from "../src/main/shared-config";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const newDir = () => fs.mkdtempSync(path.join(root, "s-"));

describe("SharedConfigStore", () => {
  it("lives in ~/.humanharness", () => {
    expect(sharedConfigDir("/Users/me")).toBe("/Users/me/.humanharness");
  });

  it("starts empty and merges updates per engine", async () => {
    const dir = newDir();
    const store = new SharedConfigStore(dir);
    expect(await store.load()).toEqual({ version: 1, engines: {} });
    await store.update("claude", { binary: "/bin/claude", version: "2.1.296" });
    await store.update("claude", { verifiedAt: "2026-10-11T14:00:00.000Z" });
    await store.update("codex", { notice: { version: 1, acceptedAt: "t" } });
    expect(await store.engine("claude")).toEqual({ binary: "/bin/claude", version: "2.1.296", verifiedAt: "2026-10-11T14:00:00.000Z" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "engines.json"), "utf8")).engines.codex.notice.version).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(["engines.json"]);
  });

  it("keeps only known fields", async () => {
    const store = new SharedConfigStore(newDir());
    await store.update("claude", { version: "1.0.0", email: "someone@example.com", token: "x" } as never);
    expect(await store.engine("claude")).toEqual({ version: "1.0.0" });
  });

  it("re-reads the file before writing, so two apps don't drop each other's changes", async () => {
    const dir = newDir();
    const a = new SharedConfigStore(dir);
    const b = new SharedConfigStore(dir);
    await a.update("claude", { version: "2.1.296" });
    await b.update("codex", { version: "0.160.1" });
    await a.update("claude", { verifiedAt: "t" });
    expect(Object.keys((await b.load()).engines).sort()).toEqual(["claude", "codex"]);
  });

  it("treats a broken or unknown file as empty", async () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, "engines.json"), "{nope");
    expect(await new SharedConfigStore(dir).load()).toEqual({ version: 1, engines: {} });
    fs.writeFileSync(path.join(dir, "engines.json"), JSON.stringify({ version: 2, engines: { claude: {} } }));
    expect(await new SharedConfigStore(dir).load()).toEqual({ version: 1, engines: {} });
  });

  it("never overwrites a file of an unknown (e.g. newer) version", async () => {
    const dir = newDir();
    const file = path.join(dir, "engines.json");
    const newer = JSON.stringify({ version: 2, engines: { claude: { future: true } } });
    fs.writeFileSync(file, newer);
    await expect(new SharedConfigStore(dir).update("claude", { version: "2.1.296" })).rejects.toThrow(/version/);
    expect(fs.readFileSync(file, "utf8")).toBe(newer);
  });

  it("never overwrites a file it can't read or parse", async () => {
    const dir = newDir();
    const file = path.join(dir, "engines.json");
    fs.writeFileSync(file, "{nope");
    await expect(new SharedConfigStore(dir).update("claude", { version: "2.1.296" })).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{nope");
    const other = newDir();
    fs.mkdirSync(path.join(other, "engines.json"));
    await expect(new SharedConfigStore(other).update("claude", { version: "2.1.296" })).rejects.toThrow();
  });

  it("creates the file when there is none yet", async () => {
    const dir = path.join(newDir(), "nested");
    await new SharedConfigStore(dir).update("claude", { version: "2.1.296" });
    expect(await new SharedConfigStore(dir).engine("claude")).toEqual({ version: "2.1.296" });
  });

  it("loads only known, well-typed fields of plain-object records", async () => {
    const dir = newDir();
    fs.writeFileSync(
      path.join(dir, "engines.json"),
      JSON.stringify({
        version: 1,
        engines: {
          claude: { binary: "/bin/claude", version: 2, email: "someone@example.com", notice: { version: 1, acceptedAt: "t", extra: 1 }, verifiedAt: "t" },
          codex: { notice: { version: "1", acceptedAt: "t" } },
          broken: "nope",
          list: [1, 2],
        },
      }),
    );
    const store = new SharedConfigStore(dir);
    expect(await store.load()).toEqual({
      version: 1,
      engines: { claude: { binary: "/bin/claude", notice: { version: 1, acceptedAt: "t" }, verifiedAt: "t" }, codex: {} },
    });
  });

  it("keeps fields and engines it doesn't know when it writes (another app may use them)", async () => {
    const dir = newDir();
    const file = path.join(dir, "engines.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, engines: { claude: { binary: "/bin/claude", future: { a: 1 } }, other: "x" } }));
    const store = new SharedConfigStore(dir);
    await store.update("claude", { version: "2.1.296", future: 2 } as never);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.engines.claude).toEqual({ binary: "/bin/claude", future: { a: 1 }, version: "2.1.296" });
    expect(saved.engines.other).toBe("x");
    expect(await store.engine("claude")).toEqual({ binary: "/bin/claude", version: "2.1.296" });
  });

  it("deletes a field updated to null", async () => {
    const store = new SharedConfigStore(newDir());
    await store.update("codex", { binary: "/opt/homebrew/bin/codex", version: "0.160.1" });
    await store.update("codex", { binary: null, version: undefined });
    expect(await store.engine("codex")).toEqual({ version: "0.160.1" });
  });

  it("keeps the models an engine offered, cleaned, and never a flag", async () => {
    const store = new SharedConfigStore(newDir());
    await store.update("codex", {
      models: [{ id: "gpt-5.5", name: "GPT-5.5", description: "Frontier" }, { id: "--x" } as never],
      efforts: ["low", "turbo" as never, "xhigh"],
    });
    expect(await store.engine("codex")).toEqual({ models: [{ id: "gpt-5.5", name: "GPT-5.5", description: "Frontier" }], efforts: ["low", "xhigh"] });
  });

  it("cleans the saved models and efforts when the file is read", async () => {
    const dir = newDir();
    fs.writeFileSync(
      path.join(dir, "engines.json"),
      JSON.stringify({ version: 1, engines: { codex: { models: [{ id: "-rm" }, { id: "gpt-5.5", name: 7 }, "x"], efforts: ["max", "--y", 3] } } }),
    );
    expect(await new SharedConfigStore(dir).engine("codex")).toEqual({ models: [{ id: "gpt-5.5" }], efforts: ["max"] });
  });
});

describe("noticeAccepted", () => {
  it("needs the current notice version", () => {
    expect(noticeAccepted({}, 1)).toBe(false);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 1)).toBe(true);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 2)).toBe(false);
  });

  it("resets a damaged file, keeping a dated copy of it next to it", async () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, "engines.json"), "{ not json");
    const store = new SharedConfigStore(dir);
    expect(store.path).toBe(path.join(dir, "engines.json"));
    await expect(store.update("claude", { version: "1" })).rejects.toThrow(/not overwriting/);
    const backup = await store.reset(new Date("2026-10-11T14:05:06.000Z"));
    expect(path.basename(backup!)).toBe("engines.json.bak-20261011-140506");
    expect(fs.readFileSync(backup!, "utf8")).toBe("{ not json");
    expect(await store.load()).toEqual({ version: 1, engines: {} });
    await store.update("claude", { version: "1" });
    expect(await store.engine("claude")).toEqual({ version: "1" });
  });

  it("never overwrites an earlier backup, even for two resets in the same second", async () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, "engines.json"), "{ original");
    const store = new SharedConfigStore(dir);
    const now = new Date("2026-10-11T14:05:06.000Z");
    const [first, second] = await Promise.all([store.reset(now), store.reset(now)]);
    expect(path.basename(first!)).toBe("engines.json.bak-20261011-140506");
    expect(path.basename(second!)).toBe("engines.json.bak-20261011-140506-2");
    expect(fs.readFileSync(first!, "utf8")).toBe("{ original");
    expect(JSON.parse(fs.readFileSync(second!, "utf8"))).toEqual({ version: 1, engines: {} });
  });

  it("starts over a file it can't read, keeping it as the backup", async () => {
    const dir = newDir();
    const file = path.join(dir, "engines.json");
    fs.writeFileSync(file, "{ secret");
    fs.chmodSync(file, 0o000);
    const store = new SharedConfigStore(dir);
    const backup = await store.reset(new Date("2026-10-11T14:05:06.000Z"));
    expect(path.basename(backup!)).toBe("engines.json.bak-20261011-140506");
    fs.chmodSync(backup!, 0o600);
    expect(fs.readFileSync(backup!, "utf8")).toBe("{ secret");
    expect(await store.load()).toEqual({ version: 1, engines: {} });
  });

  it("starts over when engines.json is a directory, moving it aside under a free name", async () => {
    const dir = newDir();
    const file = path.join(dir, "engines.json");
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "inside"), "x");
    fs.writeFileSync(`${file}.bak-20261011-140506`, "earlier backup");
    const store = new SharedConfigStore(dir);
    const backup = await store.reset(new Date("2026-10-11T14:05:06.000Z"));
    expect(path.basename(backup!)).toBe("engines.json.bak-20261011-140506-2");
    expect(fs.readFileSync(path.join(backup!, "inside"), "utf8")).toBe("x");
    expect(fs.readFileSync(`${file}.bak-20261011-140506`, "utf8")).toBe("earlier backup");
    expect(await store.load()).toEqual({ version: 1, engines: {} });
  });

  it("reset of a missing file just creates an empty one", async () => {
    const dir = newDir();
    const store = new SharedConfigStore(dir);
    expect(await store.reset()).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(dir, "engines.json"), "utf8"))).toEqual({ version: 1, engines: {} });
  });
});
