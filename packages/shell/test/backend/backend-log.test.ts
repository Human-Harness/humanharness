import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendLog } from "../../src/main/backend/backend-log";

const at = new Date("2026-10-28T10:00:00Z");
const PREFIX = "2026-10-28T10:00:00.000Z stderr ";

describe("BackendLog (spec §4.3)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "hh-backend-log-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });
  const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

  it("appends lines with a time prefix", async () => {
    const log = new BackendLog(dir, { max: 1000, now: () => at });
    await log.write("stderr", "hello\n");
    await log.write("app", "Dropped 3 backend events");
    expect(read("backend.log")).toBe(`${PREFIX}hello\n2026-10-28T10:00:00.000Z app Dropped 3 backend events\n`);
  });

  it("rotates to backend.log.1 past the limit, keeping one old file", async () => {
    // Each line is 60 bytes with its prefix and newline: two never fit under 100.
    const line = (c: string) => c.repeat(60 - PREFIX.length - 1);
    const log = new BackendLog(dir, { max: 100, now: () => at });
    await log.write("stderr", line("a"));
    await log.write("stderr", line("b"));
    expect(read("backend.log.1")).toBe(`${PREFIX}${line("a")}\n`);
    expect(read("backend.log")).toBe(`${PREFIX}${line("b")}\n`);
    await log.write("stderr", line("c"));
    expect(read("backend.log.1")).toBe(`${PREFIX}${line("b")}\n`);
    expect(read("backend.log")).toBe(`${PREFIX}${line("c")}\n`);
    await log.write("stderr", line("d"));
    expect(read("backend.log.1")).toBe(`${PREFIX}${line("c")}\n`);
    expect(read("backend.log")).toBe(`${PREFIX}${line("d")}\n`);
  });

  it("never throws: a folder it can't write is reported once to console.error", async () => {
    const file = path.join(dir, "not-a-folder");
    writeFileSync(file, "x");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = new BackendLog(file, { max: 1000, now: () => at });
    await expect(log.write("stderr", "one\n")).resolves.toBeUndefined();
    await expect(log.write("stderr", "two\n")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("Could not write backend.log");
  });

  it("splits a chunk into lines and cuts a line at 8 KB", async () => {
    const log = new BackendLog(dir, { max: 1_000_000, now: () => at });
    await log.write("stderr", "first\r\nsecond\n\nthird");
    await log.write("stderr", `${"x".repeat(8 * 1024 - 1)}ñ${"y".repeat(100)}\n`);
    const lines = read("backend.log").split("\n");
    expect(lines.slice(0, 3)).toEqual([`${PREFIX}first`, `${PREFIX}second`, `${PREFIX}third`]);
    // The cut never splits a character: "ñ" (2 bytes) would cross 8 KB, so it goes, and the cut is marked.
    expect(lines[3]).toBe(`${PREFIX}${"x".repeat(8 * 1024 - 1)}…`);
    expect(lines[4]).toBe("");
    expect(lines).toHaveLength(5);
  });

  it("writes nothing for a chunk of blank lines", async () => {
    const log = new BackendLog(dir, { max: 1000, now: () => at });
    await log.write("stderr", "\n\r\n");
    await log.write("stderr", "x\n");
    expect(read("backend.log")).toBe(`${PREFIX}x\n`);
  });

  it("writes are serialized: 50 concurrent writes keep every line whole", async () => {
    const log = new BackendLog(dir, { max: 1_000_000, now: () => at });
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.write("stderr", `line ${i} ${"z".repeat(500)}\n`)));
    const lines = read("backend.log").trimEnd().split("\n");
    expect(lines).toEqual(Array.from({ length: 50 }, (_, i) => `${PREFIX}line ${i} ${"z".repeat(500)}`));
  });
});
