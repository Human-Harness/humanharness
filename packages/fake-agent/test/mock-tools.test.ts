import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadRecordings, loadStepRecording, mockTurnSchema, recordingSchema, stepRecordingSchema } from "../src/mock";

const DEMO_MOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/mock");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-tools-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const folder = () => fs.mkdtempSync(path.join(root, `m${++n}-`));
const write = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

const turn = (extra: Record<string, unknown> = {}) => ({ id: "t1", text: "Hola.", ...extra });
const recording = (turns: unknown[]) => ({ version: 1, action: "look", match: "# Task: look", turns });

describe("tools in recordings (tools spec §12, Decisions 9, 11)", () => {
  it("D0: a recording without tools parses as before", () => {
    // sha256 of JSON.stringify(recordingSchema.parse(file)), taken with mock.ts as it was before this task.
    const before: Record<string, string> = {
      "engines.json": "9bb27fe7972e8525a7b80274b6c2e17ac2c7ec59873ac45ca37916141e325ef9",
      "manifest.json": "c1bc0a59dc8df8197130f97873db0eafee2a4bb8f6abd13fbd254a0c3cc53cce",
    };
    for (const [name, hash] of Object.entries(before)) {
      const parsed = recordingSchema.parse(JSON.parse(fs.readFileSync(path.join(DEMO_MOCK, name), "utf8")));
      expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex"), name).toBe(hash);
      for (const t of parsed.turns) expect(Object.hasOwn(t, "tools")).toBe(false);
    }
    const loaded = loadRecordings(DEMO_MOCK);
    expect(loaded.problems).toEqual([]);
    expect(loaded.recordings.map((r) => r.action).sort()).toEqual(["engines", "manifest"]);
  });

  it("a turn's tools: up to 20 { tool, args } calls, in order", () => {
    const calls = [
      { tool: "due-today", args: {} },
      { tool: "pr_ci", args: { id: "12", deep: { a: [1] } } },
    ];
    expect(mockTurnSchema.parse(turn({ tools: calls })).tools).toEqual(calls);
    const twenty = Array.from({ length: 20 }, (_, i) => ({ tool: "echo", args: { i } }));
    expect(mockTurnSchema.parse(turn({ tools: twenty })).tools?.map((c) => c.args.i)).toEqual(twenty.map((_, i) => i));
    expect(mockTurnSchema.safeParse(turn({ tools: [...twenty, { tool: "echo", args: {} }] })).success).toBe(false);
    expect(mockTurnSchema.safeParse(turn({ tools: [] })).success).toBe(true);
    expect(recordingSchema.parse(recording([turn({ tools: calls })])).turns[0].tools).toEqual(calls);
  });

  it("refuses a tool call with a bad id or args that aren't an object", () => {
    for (const bad of [
      { tool: "Echo", args: {} },
      { tool: "1echo", args: {} },
      { tool: "", args: {} },
      { tool: "a".repeat(65), args: {} },
      { tool: "echo" },
      { tool: "echo", args: [] },
      { tool: "echo", args: "x" },
      { tool: "echo", args: null },
      { tool: "echo", args: {}, extra: 1 },
      JSON.parse('{ "tool": "echo", "args": { "__proto__": { "x": 1 } } }'),
    ]) {
      expect(mockTurnSchema.safeParse(turn({ tools: [bad] })).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("loadRecordings ignores mock/tools/ and mock/steps/ (only mock/*.json)", () => {
    const dir = folder();
    write(path.join(dir, "look.json"), recording([turn()]));
    write(path.join(dir, "tools", "echo", "001.json"), { not: "a recording" });
    write(path.join(dir, "steps", "sync.json"), { version: 1, job: "sync", output: {} });
    const { recordings, problems } = loadRecordings(dir);
    expect(problems).toEqual([]);
    expect(recordings.map((r) => r.action)).toEqual(["look"]);
  });

  it("stepRecordingSchema: { version: 1, job, output, request? }", () => {
    expect(stepRecordingSchema.parse({ version: 1, job: "sync", output: { ids: ["1"] } })).toEqual({ version: 1, job: "sync", output: { ids: ["1"] } });
    expect(stepRecordingSchema.parse({ version: 1, job: "sync", output: {}, request: { ids: [] } }).request).toEqual({ ids: [] });
    for (const bad of [
      { version: 2, job: "sync", output: {} },
      { version: 1, job: "Sync", output: {} },
      { version: 1, job: "sync" },
      { version: 1, job: "sync", output: [] },
      { version: 1, job: "sync", output: {}, request: "x" },
      { version: 1, job: "sync", output: {}, extra: true },
      JSON.parse('{ "version": 1, "job": "sync", "output": { "__proto__": { "x": 1 } } }'),
      JSON.parse('{ "version": 1, "job": "sync", "output": {}, "request": { "__proto__": {} } }'),
    ]) {
      expect(stepRecordingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("loadStepRecording reads mock/steps/<job>.json; missing → null; a bad file → a problem", () => {
    const dir = folder();
    expect(loadStepRecording(dir, "sync")).toBeNull();
    write(path.join(dir, "steps", "sync.json"), { version: 1, job: "sync", output: { ids: ["7"] } });
    expect(loadStepRecording(dir, "sync")).toEqual({ version: 1, job: "sync", output: { ids: ["7"] } });
    expect(loadStepRecording(dir, "other")).toBeNull();
    // A file that doesn't parse throws with its problem.
    write(path.join(dir, "steps", "bad.json"), "{ nope");
    expect(() => loadStepRecording(dir, "bad")).toThrow(/steps\/bad\.json/);
    write(path.join(dir, "steps", "wrong.json"), { version: 1, job: "wrong", output: [] });
    expect(() => loadStepRecording(dir, "wrong")).toThrow(/output/);
    // The file's job must be the job it is named after.
    write(path.join(dir, "steps", "named.json"), { version: 1, job: "sync", output: {} });
    expect(() => loadStepRecording(dir, "named")).toThrow(/"sync".*named/);
  });

  it("loadStepRecording checks the job id before it joins a path, and refuses links and folders", () => {
    const dir = folder();
    write(path.join(root, "outside.json"), { version: 1, job: "outside", output: {} });
    for (const bad of ["../outside", "../../x", "Sync", "", "a/b"]) expect(() => loadStepRecording(dir, bad), bad).toThrow(/not a job id/);
    write(path.join(dir, "steps", "real.json"), { version: 1, job: "linked", output: {} });
    fs.symlinkSync(path.join(dir, "steps", "real.json"), path.join(dir, "steps", "linked.json"));
    expect(() => loadStepRecording(dir, "linked")).toThrow(/not a file/);
    fs.mkdirSync(path.join(dir, "steps", "dir.json"));
    expect(() => loadStepRecording(dir, "dir")).toThrow(/not a file/);
    // A linked steps folder is never followed.
    const other = folder();
    write(path.join(other, "s", "sync.json"), { version: 1, job: "sync", output: {} });
    const linked = folder();
    fs.symlinkSync(path.join(other, "s"), path.join(linked, "steps"), "dir");
    expect(() => loadStepRecording(linked, "sync")).toThrow(/steps is not a folder/);
  });

  it("loadStepRecording refuses a hard link", () => {
    const dir = folder();
    write(path.join(dir, "steps", "sync.json"), { version: 1, job: "sync", output: {} });
    fs.linkSync(path.join(dir, "steps", "sync.json"), path.join(dir, "steps", "other.json"));
    expect(() => loadStepRecording(dir, "sync")).toThrow(/steps\/sync\.json is a hard link/);
  });

  it("loadStepRecording refuses a file over the size cap", () => {
    const dir = folder();
    write(path.join(dir, "steps", "big.json"), JSON.stringify({ version: 1, job: "big", output: { s: "x".repeat(10 * 1024 * 1024) } }));
    expect(() => loadStepRecording(dir, "big")).toThrow(/too big/);
  });
});
