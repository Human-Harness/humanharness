import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BYTES, FIXTURE_FILES } from "../../src/main/plugin-fixture-files";
import { readToolFixtures as fromCli } from "../../src/main/tools/tool-cli";
import { readToolFixtures } from "../../src/main/tools/tool-fixture-files";

const CASE = { args: { q: "x" }, expect: { result: { n: 1 } } };

let root: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-fx-")));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** `<root>/tools/<tool>/fixtures/` with `files`; answers that folder. */
async function fixtures(tool: string, files: Record<string, unknown>): Promise<string> {
  const dir = path.join(root, "tools", tool, "fixtures");
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  return dir;
}

const logged = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([m, e]) => `${String(m)}: ${e instanceof Error ? e.message : ""}`).join("\n");

describe("readToolFixtures (A4)", () => {
  it("reads tools/<id>/fixtures/*.json in name order, each with its file name", async () => {
    await fixtures("lookup", { "b.json": { expect: { error: "no" } }, "a.json": CASE, "notes.txt": "not a fixture" });
    const log = vi.fn();
    expect(await readToolFixtures(root, "lookup", log)).toEqual([
      { file: "a.json", fixture: { args: { q: "x" }, scope: null, expect: { result: { n: 1 } } } },
      { file: "b.json", fixture: { args: {}, scope: null, expect: { error: "no" } } },
    ]);
    expect(log).not.toHaveBeenCalled();
    expect(fromCli).toBe(readToolFixtures);
  });

  it("skips (with a note) a file that doesn't parse or fails the schema, and a hard link", async () => {
    const outside = path.join(root, "outside.json");
    await fs.writeFile(outside, JSON.stringify(CASE));
    const dir = await fixtures("lookup", { "a.json": "{not json", "b.json": { expect: {} }, "d.json": CASE });
    await fs.link(outside, path.join(dir, "c.json"));
    await fs.symlink(outside, path.join(dir, "e.json"));
    const log = vi.fn();
    expect((await readToolFixtures(root, "lookup", log)).map((x) => x.file)).toEqual(["d.json"]);
    const notes = logged(log);
    expect(notes).toMatch(/tools\/lookup\/fixtures\/a\.json skipped/);
    expect(notes).toMatch(/tools\/lookup\/fixtures\/b\.json skipped/);
    expect(notes).toMatch(/tools\/lookup\/fixtures\/c\.json skipped: a hard link/);
    expect(notes).not.toMatch(/d\.json/);
    // A file link is never opened (as the plugin reader: links are not files).
    expect(notes).not.toContain(outside);
  });

  it("a file over the size cap is skipped unread, and at most FIXTURE_FILES files are read", async () => {
    const files: Record<string, unknown> = {};
    for (let i = 0; i < FIXTURE_FILES + 2; i++) files[`${String(i).padStart(3, "0")}.json`] = CASE;
    const dir = await fixtures("lookup", files);
    await fs.truncate(path.join(dir, "000.json"), FIXTURE_BYTES + 1);
    const log = vi.fn();
    const got = await readToolFixtures(root, "lookup", log);
    expect(got).toHaveLength(FIXTURE_FILES - 1);
    expect(got.at(-1)?.file).toBe(`${FIXTURE_FILES - 1}.json`);
    expect(logged(log)).toMatch(/000\.json skipped: larger than 10 MB/);
  });

  it("a linked tools/<id> or fixtures folder is not followed", async () => {
    const real = await fixtures("real", { "a.json": CASE });
    const log = vi.fn();
    await fs.symlink(path.dirname(real), path.join(root, "tools", "linked"));
    expect(await readToolFixtures(root, "linked", log)).toEqual([]);
    await fs.mkdir(path.join(root, "tools", "other"), { recursive: true });
    await fs.symlink(real, path.join(root, "tools", "other", "fixtures"));
    expect(await readToolFixtures(root, "other", log)).toEqual([]);
    expect(await readToolFixtures(root, "real", log)).toHaveLength(1);
  });

  it("a missing fixtures folder is no fixtures", async () => {
    const log = vi.fn();
    expect(await readToolFixtures(root, "lookup", log)).toEqual([]);
    await fs.mkdir(path.join(root, "tools", "lookup"), { recursive: true });
    expect(await readToolFixtures(root, "lookup", log)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses a tool name that isn't a tool id (no path walking)", async () => {
    await expect(readToolFixtures(root, "../x", vi.fn())).rejects.toThrow(/not a tool id/);
    await expect(readToolFixtures(root, "", vi.fn())).rejects.toThrow(/not a tool id/);
  });
});
