import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineHarness, isConcurrent, narrowPermissions, parallelCaps } from "../src";

const base = {
  id: "t",
  name: "T",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/T" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false },
  blocks: {},
  author: "x",
};

describe("parallel (parallel spec §3)", () => {
  it("D0: a manifest without parallel parses to the same object as before", () => {
    const h = defineHarness(base);
    expect("parallel" in h).toBe(false);
    expect(isConcurrent(h)).toBe(false);
    expect(parallelCaps(h)).toEqual({ tasks: 1, jobs: 1 });
  });
  it("defaults both caps to 1 and accepts 1..8", () => {
    expect(defineHarness({ ...base, parallel: {} }).parallel).toEqual({ tasks: 1, jobs: 1 });
    expect(defineHarness({ ...base, parallel: { tasks: 3, jobs: 2 } }).parallel).toEqual({ tasks: 3, jobs: 2 });
    expect(defineHarness({ ...base, parallel: { tasks: 8, jobs: 8 } }).parallel).toEqual({ tasks: 8, jobs: 8 });
    expect(isConcurrent(defineHarness({ ...base, parallel: { tasks: 1 } }))).toBe(true);
    expect(parallelCaps(defineHarness({ ...base, parallel: { tasks: 4 } }))).toEqual({ tasks: 4, jobs: 1 });
  });
  it.each([{ tasks: 0 }, { tasks: 9 }, { jobs: 1.5 }, { tasks: "2" }, { jobs: -1 }])("refuses %j", (p) => {
    expect(() => defineHarness({ ...base, parallel: p as never })).toThrow();
  });
  it("refuses an unknown key (a typo) the way the manifest reports any error: a ZodError naming the path", () => {
    let error: unknown;
    try {
      defineHarness({ ...base, parallel: { task: 3 } as never });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(z.ZodError);
    expect((error as z.ZodError).issues).toEqual([expect.objectContaining({ code: "unrecognized_keys", keys: ["task"], path: ["parallel"] })]);
  });
});

describe("narrowPermissions (parallel spec §8, T5)", () => {
  const wide = { edit: "folder" as const, exec: true, web: true };
  const narrow = { edit: "none" as const, exec: false, web: false };
  it("only narrows", () => {
    expect(narrowPermissions(wide, { edit: "none" })).toEqual({ edit: "none", exec: true, web: true });
    expect(narrowPermissions(wide, { exec: false, web: false })).toEqual({ edit: "folder", exec: false, web: false });
    expect(narrowPermissions(narrow, { edit: "folder", exec: true, web: true })).toEqual(narrow);
    expect(narrowPermissions(wide, undefined)).toEqual(wide);
    expect(narrowPermissions(wide, {})).toEqual(wide);
  });
  it("returns a copy, never the base object", () => {
    expect(narrowPermissions(wide, undefined)).not.toBe(wide);
  });
});

describe("inbox (parallel spec §9.2, Decision 1)", () => {
  it("absent by default; false hides the core inbox", () => {
    expect("inbox" in defineHarness(base)).toBe(false);
    expect(defineHarness({ ...base, parallel: {}, inbox: false }).inbox).toBe(false);
    expect(() => defineHarness({ ...base, inbox: "no" as never })).toThrow();
  });
});
