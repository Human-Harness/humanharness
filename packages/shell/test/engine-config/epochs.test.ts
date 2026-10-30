import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EngineEpochs } from "../../src/main/engine-config/epochs";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-engine-epochs-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const dir = path.join(root, `u${++n}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, "engine-epochs.json");
  return { file, epochs: new EngineEpochs(file) };
};

describe("EngineEpochs (revocation record, spec §5.3)", () => {
  it("no file: epoch 0 for every scope, and reading makes none", async () => {
    const { file, epochs } = fresh();
    expect(await epochs.get("", "intro")).toBe(0);
    expect(await epochs.sign("", "intro")).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("a revoke bumps one scope of one profile; others keep theirs", async () => {
    const { file, epochs } = fresh();
    expect(await epochs.bump("", "intro")).toBe(1);
    expect(await epochs.bump("", "intro")).toBe(2);
    expect(await epochs.bump("work", "intro")).toBe(1);
    expect(await epochs.get("", "intro")).toBe(2);
    expect(await epochs.get("work", "intro")).toBe(1);
    expect(await epochs.get("", "other")).toBe(0);
    expect(await epochs.sign("", "intro")).toBe(2);
    // Kept on disk, private to the person, read back by a new instance.
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(await new EngineEpochs(file).get("", "intro")).toBe(2);
    expect(await new EngineEpochs(file).get("work", "intro")).toBe(1);
  });

  it("concurrent bumps are serialized", async () => {
    const { epochs } = fresh();
    expect(await Promise.all([epochs.bump("", "a"), epochs.bump("", "a"), epochs.bump("", "a")])).toEqual([1, 2, 3]);
  });

  it("a damaged record verifies nothing; the next approval or revoke starts above any epoch it held", async () => {
    const { file, epochs } = fresh();
    await epochs.bump("", "intro");
    for (const bad of ["{", "[]", JSON.stringify({ version: 1, floor: -1, epochs: [] }), JSON.stringify({ version: 1, floor: 0, epochs: [["", "intro", "x"]] })]) {
      fs.writeFileSync(file, bad);
      const e = new EngineEpochs(file);
      expect(await e.get("", "intro"), bad).toBeNull();
      expect(await e.get("", "other"), bad).toBeNull();
    }
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new EngineEpochs(file);
    const signed = await e.sign("", "other");
    expect(signed).toBeGreaterThan(1_000_000);
    expect(await e.get("", "other")).toBe(signed);
    expect(await e.get("", "intro")).toBe(signed);
    expect(await e.bump("", "intro")).toBe(signed + 1);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("prototype names are plain data", async () => {
    const { epochs } = fresh();
    expect(await epochs.bump("__proto__", "constructor")).toBe(1);
    expect(await epochs.get("__proto__", "constructor")).toBe(1);
    expect(await epochs.get("", "toString")).toBe(0);
  });
});
