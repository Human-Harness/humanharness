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
});

describe("noticeAccepted", () => {
  it("needs the current notice version", () => {
    expect(noticeAccepted({}, 1)).toBe(false);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 1)).toBe(true);
    expect(noticeAccepted({ notice: { version: 1, acceptedAt: "t" } }, 2)).toBe(false);
  });
});
