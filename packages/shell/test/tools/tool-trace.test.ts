import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRACE_DAYS, TRACE_FILE_MAX_BYTES, ToolTrace, type TraceEntry } from "../../src/main/tools/tool-trace";

let base: string;
const NOW = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const TASK = "0b9f3c1e-5a2d-4c6b-9e8f-1a2b3c4d5e6f";
const RUN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-trace-")));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

function entry(over: Partial<TraceEntry> = {}): TraceEntry {
  return { at: NOW.toISOString(), tool: "count-notes", caller: "ui", args: {}, resultSummary: "3 items", ms: 12, ok: true, accesses: [], ...over };
}
const traceDir = () => path.join(base, ".harness", "trace");
const lines = async (file: string) => (await fs.readFile(file, "utf8")).split("\n").filter((l) => l !== "");

describe("ToolTrace (tools spec §8.1, Decision 8)", () => {
  it("a task's entries go to .harness/trace/<task>.jsonl; a job run's to jobs/<run>.jsonl; a UI call's to ui/<day>.jsonl", async () => {
    const t = new ToolTrace({ base });
    await t.append(entry({ caller: "agent", task: TASK, phase: "plan" }));
    await t.append(entry({ caller: "agent", job: "nightly", run: RUN }));
    await t.append(entry());
    expect(await lines(path.join(traceDir(), `${TASK}.jsonl`))).toHaveLength(1);
    expect(await lines(path.join(traceDir(), "jobs", `${RUN}.jsonl`))).toHaveLength(1);
    expect(JSON.parse((await lines(path.join(traceDir(), "ui", "2026-10-29.jsonl")))[0]!)).toEqual(entry());
    expect((await fs.stat(path.join(traceDir(), `${TASK}.jsonl`))).mode & 0o777).toBe(0o600);
  });

  it("read(task|run) returns the entries, newest last, skipping a torn last line", async () => {
    const t = new ToolTrace({ base });
    await t.append(entry({ task: TASK, ms: 1 }));
    await t.append(entry({ task: TASK, ms: 2 }));
    await fs.appendFile(path.join(traceDir(), `${TASK}.jsonl`), '{"at":"2026-10-29T12:00:00.000Z","tool":"cou');
    expect((await t.read(TASK)).map((e) => e.ms)).toEqual([1, 2]);
    await t.append(entry({ job: "nightly", run: RUN, ms: 3 }));
    expect((await t.read(RUN)).map((e) => e.ms)).toEqual([3]);
    expect(await t.read("1f2e3d4c-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("prune removes entries older than 30 days at start (whole files by mtime, lines by `at`)", async () => {
    expect(TRACE_DAYS).toBe(30);
    const t = new ToolTrace({ base, now: () => NOW });
    const old = new Date(NOW.getTime() - 31 * DAY);
    await t.append(entry({ task: TASK, at: old.toISOString(), ms: 1 }));
    await t.append(entry({ task: TASK, ms: 2 }));
    await t.append(entry({ job: "nightly", run: RUN, at: old.toISOString() }));
    await t.append(entry({ at: old.toISOString() }));
    const stale = [path.join(traceDir(), "jobs", `${RUN}.jsonl`), path.join(traceDir(), "ui", old.toISOString().slice(0, 10) + ".jsonl")];
    for (const f of stale) await fs.utimes(f, old, old);
    await t.prune();
    expect((await t.read(TASK)).map((e) => e.ms)).toEqual([2]);
    for (const f of stale) await expect(fs.stat(f)).rejects.toThrow();
  });

  it("prune with no trace folder creates nothing (D0)", async () => {
    await new ToolTrace({ base }).prune();
    await expect(fs.stat(path.join(base, ".harness"))).rejects.toThrow();
  });

  it("no links under .harness/trace (no-links rules): a linked trace folder is refused and nothing is written through it", async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-trace-out-")));
    try {
      await fs.mkdir(path.join(base, ".harness"));
      await fs.symlink(outside, traceDir());
      const t = new ToolTrace({ base });
      await expect(t.append(entry({ task: TASK }))).rejects.toThrow(/not a plain folder/);
      await expect(t.read(TASK)).rejects.toThrow(/not a plain folder/);
      await t.prune();
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("a link at the trace file is refused, not followed", async () => {
    const outside = path.join(base, "elsewhere.txt");
    await fs.writeFile(outside, "");
    await fs.mkdir(traceDir(), { recursive: true });
    await fs.symlink(outside, path.join(traceDir(), `${TASK}.jsonl`));
    await expect(new ToolTrace({ base }).append(entry({ task: TASK }))).rejects.toThrow();
    expect(await fs.readFile(outside, "utf8")).toBe("");
  });

  it("a hard-linked trace file (nlink > 1) is refused, nothing written to it", async () => {
    const other = path.join(base, "other.txt");
    await fs.writeFile(other, "");
    await fs.mkdir(traceDir(), { recursive: true });
    await fs.link(other, path.join(traceDir(), `${TASK}.jsonl`));
    await expect(new ToolTrace({ base }).append(entry({ task: TASK }))).rejects.toThrow(/not a plain file/);
    expect(await fs.readFile(other, "utf8")).toBe("");
  });

  it("a file at the 16 MB cap takes no more entries, logged once", async () => {
    const file = path.join(traceDir(), `${TASK}.jsonl`);
    await fs.mkdir(traceDir(), { recursive: true });
    await fs.writeFile(file, "");
    await fs.truncate(file, TRACE_FILE_MAX_BYTES);
    const logs: string[] = [];
    const t = new ToolTrace({ base, log: (m) => void logs.push(m) });
    await t.append(entry({ task: TASK }));
    await t.append(entry({ task: TASK }));
    expect((await fs.stat(file)).size).toBe(TRACE_FILE_MAX_BYTES);
    expect(logs).toHaveLength(1);
  });

  it("an entry after a torn last line starts its own line", async () => {
    const t = new ToolTrace({ base });
    await t.append(entry({ task: TASK, ms: 1 }));
    const file = path.join(traceDir(), `${TASK}.jsonl`);
    await fs.appendFile(file, '{"at":"2026-10-29T12:00:00.000Z","tool":"cou');
    await t.append(entry({ task: TASK, ms: 2 }));
    expect((await t.read(TASK)).map((e) => e.ms)).toEqual([1, 2]);
    expect((await fs.readFile(file, "utf8")).split("\n")).toHaveLength(4);
  });

  it("prune removes a whole file by its mtime even when its lines are fresh", async () => {
    const t = new ToolTrace({ base, now: () => NOW });
    await t.append(entry({ task: TASK }));
    const file = path.join(traceDir(), `${TASK}.jsonl`);
    const old = new Date(NOW.getTime() - 31 * DAY);
    await fs.utimes(file, old, old);
    await t.prune();
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it("ids that aren't task/run ids are refused (no path from a caller)", async () => {
    const t = new ToolTrace({ base });
    for (const bad of ["../x", "a/b", "", ".x", "X", "jobs/../../y"]) {
      await expect(t.append(entry({ task: bad }))).rejects.toThrow(/Not a task or run id/);
      await expect(t.append(entry({ job: "nightly", run: bad }))).rejects.toThrow(/Not a task or run id/);
      await expect(t.read(bad)).rejects.toThrow(/Not a task or run id/);
    }
    await expect(fs.stat(path.join(base, ".harness"))).rejects.toThrow();
  });
});
