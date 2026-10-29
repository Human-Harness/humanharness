import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { UsageError } from "../src/cli";
import { USAGE, main } from "../src/main";
import { measureCommand } from "../src/measure";
import { memoryIo, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-measure-");
afterAll(cleanup);
afterEach(() => vi.restoreAllMocks());
let n = 0;

const at = "2026-10-29T10:00:00.000Z";
const turn = (task: string, action: string, inputTokens: number, cacheReadTokens = 0) => ({
  at,
  engine: "claude",
  action,
  task,
  phase: "run",
  ok: true,
  usage: { inputTokens, outputTokens: 300, cacheReadTokens, cacheWriteTokens: 0 },
});
const pre = (task: string, action: string, preparedTokens: number, ms: number) => ({ at, engine: "claude", kind: "pre", action, task, steps: 2, ms, preparedTokens, ok: true });

/** A working folder whose .harness/usage.jsonl holds `lines` (none: no usage.jsonl, only .harness/). */
function folderWith(lines?: object[]): string {
  const dir = path.join(root, `f${++n}`);
  fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
  if (lines) fs.writeFileSync(path.join(dir, ".harness", "usage.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return dir;
}

describe("humanharness measure (tools spec §8.4)", () => {
  it("prints one block per action: with and without pre-steps, first-turn tokens, prepared tokens, pre time", async () => {
    const dir = folderWith([
      turn("A", "study", 100_000, 20_000),
      turn("B", "study", 110_000, 6_800),
      turn("C", "study", 118_400),
      pre("D", "study", 800, 250),
      turn("D", "study", 41_000),
      pre("E", "study", 840, 350),
      turn("E", "study", 41_400),
      turn("F", "quiz", 1_000),
    ]);
    const m = memoryIo(dir);
    expect(await measureCommand([], m.io)).toBe(0);
    expect(m.out()).toBe(
      [
        "study",
        "  without pre-steps: 3 tasks, first turn ≈ 118,400 tokens",
        "  with pre-steps:    2 tasks, first turn ≈ 41,200 tokens; prepared ≈ 820 tokens in 0.3 s",
        "",
        "quiz",
        "  without pre-steps: 1 task, first turn ≈ 1,000 tokens",
        "  with pre-steps:    no tasks yet",
        "",
      ].join("\n"),
    );
    expect(m.err()).toBe("");
  });

  it("--folder points at another working folder", async () => {
    const dir = folderWith([turn("A", "study", 500)]);
    const m = memoryIo(root);
    expect(await measureCommand(["--folder", path.relative(root, dir)], m.io)).toBe(0);
    expect(m.out()).toContain("  without pre-steps: 1 task, first turn ≈ 500 tokens");
  });

  it("--folder ~/<dir> is read from the home folder", async () => {
    const dir = folderWith([turn("A", "study", 700)]);
    // A stubbed home (the test's temp root): the real one is never read.
    const home = vi.spyOn(os, "homedir").mockReturnValue(root);
    const m = memoryIo(path.join(root, "elsewhere"));
    expect(await measureCommand(["--folder", `~/${path.basename(dir)}`], m.io)).toBe(0);
    expect(home).toHaveBeenCalled();
    expect(m.out()).toContain("  without pre-steps: 1 task, first turn ≈ 700 tokens");
  });

  it("a folder without usage.jsonl says 'No usage recorded in <folder> yet.' and exits 0", async () => {
    const dir = folderWith();
    const m = memoryIo(dir);
    expect(await measureCommand([], m.io)).toBe(0);
    expect(m.out()).toBe(`No usage recorded in ${dir} yet.\n`);
  });

  it("a log with no task's first turn says so too", async () => {
    const dir = folderWith([pre("A", "study", 800, 300)]);
    const m = memoryIo(dir);
    expect(await measureCommand([], m.io)).toBe(0);
    expect(m.out()).toBe(`No usage recorded in ${dir} yet.\n`);
  });

  it("--folder is required when the current folder has no .harness", async () => {
    const dir = path.join(root, "plain");
    fs.mkdirSync(dir, { recursive: true });
    await expect(measureCommand([], memoryIo(dir).io)).rejects.toThrow(new UsageError("Run it in a harness folder, or pass --folder <dir>."));
    // Through main: the message on stderr, exit code 2.
    const m = memoryIo(dir);
    expect(await main(["measure"], m.io)).toBe(2);
    expect(m.err()).toBe("Run it in a harness folder, or pass --folder <dir>.\n");
  });

  it("an unknown option or a positional is a usage error", async () => {
    const dir = folderWith([]);
    await expect(measureCommand(["--nope"], memoryIo(dir).io)).rejects.toThrow(UsageError);
    await expect(measureCommand(["extra"], memoryIo(dir).io)).rejects.toThrow(UsageError);
  });

  it("main lists it in USAGE", () => {
    expect(USAGE.split("\n").filter((l) => /^ {2}measure\b/.test(l))).toEqual([
      "  measure [--folder <dir>]                 Print first-turn tokens with and without pre-steps, per action",
    ]);
  });
});
