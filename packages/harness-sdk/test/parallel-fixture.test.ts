import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isConcurrent, loadHarness, parallelCaps, resolveInHarness } from "../src";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/parallel-harness");

describe("the parallel fixture harness (parallel spec §11)", () => {
  it("loads as a concurrent harness with two tasks at once and one job", async () => {
    const h = await loadHarness(path.join(DIR, "harness.config.ts"));
    expect(h.id).toBe("parallel");
    expect(isConcurrent(h)).toBe(true);
    expect(parallelCaps(h)).toEqual({ tasks: 2, jobs: 1 });
    expect(h.permissions).toEqual({ edit: "folder", exec: false, web: false });
    expect(Object.keys(h.actions)).toEqual(["write-a", "write-b"]);
    // Small on purpose: no scopes, no phases, no modes (those have unit tests of their own).
    expect(h.scopes).toBeUndefined();
    expect(h.modes).toEqual({});
    expect("inbox" in h).toBe(false);
  });

  it("has every file the app build and the fake agent need", async () => {
    const h = await loadHarness(path.join(DIR, "harness.config.ts"));
    for (const a of Object.values(h.actions)) expect(fs.existsSync(resolveInHarness(h, a.prompt))).toBe(true);
    expect(fs.readFileSync(resolveInHarness(h, h.actions["write-a"].prompt), "utf8")).toMatch(/^# Task: write-a\n/);
    expect(fs.readFileSync(resolveInHarness(h, h.actions["write-b"].prompt), "utf8")).toMatch(/^# Task: write-b\n/);
    expect(fs.existsSync(resolveInHarness(h, h.instructions))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "ui", "App.tsx"))).toBe(true);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, "fake-script.json"), "utf8")).scenarios)).toEqual(["parallel", "slow"]);
  });
});
