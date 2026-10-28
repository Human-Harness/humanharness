import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { allBlocks, defineHarness, hasJobs, isConcurrent, jobProblems, jobResultSchema, loadHarness, parseEvery } from "../src";

const base = {
  id: "t",
  name: "T",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/T" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false },
  blocks: {},
  author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md", cost: "light" as const } },
};
const job = (extra: object = {}) => ({ label: "Sync", prompt: "./jobs/sync.md", on: { manual: true }, ...extra });
const scoped = { ...base, scopes: { label: "Project", plural: "Projects" } };

describe("jobs schema (parallel spec §3)", () => {
  it("D0: absent; allBlocks unchanged by jobs (Decision 1)", () => {
    const h = defineHarness(base);
    expect("jobs" in h).toBe(false);
    expect(hasJobs(h)).toBe(false);
    expect(isConcurrent(h)).toBe(false);
    expect(Object.keys(allBlocks(defineHarness({ ...base, jobs: { sync: job() } })))).toEqual(Object.keys(allBlocks(h)));
  });
  it("defaults: tier light, scope none", () => {
    expect(defineHarness({ ...base, jobs: { sync: job() } }).jobs?.sync).toMatchObject({ tier: "light", scope: "none" });
  });
  it("hasJobs is false for an empty record", () => {
    expect(hasJobs(defineHarness({ ...base, jobs: {} }))).toBe(false);
    expect(hasJobs(defineHarness({ ...base, jobs: { sync: job() } }))).toBe(true);
  });
  it("accepts every trigger, a narrowing permission and each scope with scopes", () => {
    const h = defineHarness({
      ...scoped,
      jobs: {
        sync: job({ on: { start: true, manual: true, afterTask: ["implement"], every: "30m" }, dailyTokens: 50_000, scope: "each", tier: "standard" }),
        tidy: job({ on: { afterTask: true }, scope: "trigger", permissions: { exec: false, edit: "none" } }),
      },
    } as never);
    expect(h.jobs?.sync).toMatchObject({ tier: "standard", scope: "each", dailyTokens: 50_000 });
    expect(h.jobs?.tidy.permissions).toEqual({ exec: false, edit: "none" });
  });
  it.each([
    ["an id clashing with an action", { implement: job() }, "clashes"],
    ["a bad id", { "Bad Id": job() }, undefined],
    ["every under 15m", { s: job({ on: { every: "10m" }, dailyTokens: 1000 }) }, "15m"],
    ["an every that is not a duration", { s: job({ on: { every: "90" }, dailyTokens: 1000 }) }, "15m"],
    ["every without dailyTokens", { s: job({ on: { every: "30m" } }) }, "dailyTokens"],
    ["afterTask naming no action", { s: job({ on: { afterTask: ["nope"] } }) }, "nope"],
    ["scope each without scopes", { s: job({ scope: "each" }) }, "scopes"],
    ["no trigger at all", { s: job({ on: {} }) }, "trigger"],
    ["only false triggers", { s: job({ on: { start: false, manual: false } }) }, "trigger"],
    ["a widening permission", { s: job({ permissions: { exec: true, web: true } }) }, "narrow"],
    ["an unknown trigger (a typo)", { s: job({ on: { manaul: true } }) }, undefined],
    ["an unknown permission key", { s: job({ permissions: { net: false } }) }, undefined],
    ["a label over 80 characters", { s: job({ label: "x".repeat(81) }) }, undefined],
    ["a zero dailyTokens", { s: job({ on: { every: "1h" }, dailyTokens: 0 }) }, undefined],
  ])("refuses %s", (_n, jobs, message) => {
    const run = () => defineHarness({ ...base, jobs: jobs as never });
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });
  it("J2: a job can't widen any permission (edit, exec or web)", () => {
    const off = { ...base, permissions: { edit: "none" as const, exec: false, web: false } };
    for (const p of [{ edit: "folder" }, { exec: true }, { web: true }]) {
      expect(() => defineHarness({ ...off, jobs: { s: job({ permissions: p }) } } as never)).toThrow("narrow");
    }
    // Repeating the harness's own value is not a widening.
    expect(defineHarness({ ...base, jobs: { s: job({ permissions: { edit: "folder", exec: true, web: false } }) } } as never).jobs?.s.permissions).toBeDefined();
  });
  it("scope trigger needs afterTask or manual and nothing else (with scopes)", () => {
    expect(() => defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { manual: true, start: true } }) } } as never)).toThrow("trigger");
    expect(() => defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { every: "1h" }, dailyTokens: 10 }) } } as never)).toThrow("trigger");
    expect(defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { afterTask: true } }) } } as never).jobs?.s.scope).toBe("trigger");
    expect(defineHarness({ ...scoped, jobs: { s: job({ scope: "trigger", on: { manual: true } }) } } as never).jobs?.s.scope).toBe("trigger");
  });
  it("reports each problem with its path under jobs.<id>", () => {
    let issues: { path: PropertyKey[]; message: string }[] = [];
    try {
      defineHarness({ ...base, jobs: { s: job({ on: { every: "30m" } }) } } as never);
    } catch (e) {
      issues = (e as { issues: typeof issues }).issues;
    }
    expect(issues.map((i) => i.path.join("."))).toEqual(["jobs.s.dailyTokens"]);
  });
  it("jobProblems is empty without jobs", () => {
    expect(jobProblems(defineHarness(base))).toEqual([]);
  });
  it("a job makes the harness concurrent", () => {
    expect(isConcurrent(defineHarness({ ...base, jobs: { sync: job() } }))).toBe(true);
  });
});

describe("loadHarness: a job's prompt stays inside the harness folder", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-jobs-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name: string, prompt: string) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const manifest = { ...base, id: name, jobs: { sync: job({ prompt }) } };
    fs.writeFileSync(path.join(dir, "harness.config.mjs"), `export default ${JSON.stringify(manifest)};\n`);
    return path.join(dir, "harness.config.mjs");
  };
  it("refuses a prompt that escapes it", async () => {
    await expect(loadHarness(write("out", "../outside.md"))).rejects.toThrow("escapes");
  });
  it("loads a prompt inside it", async () => {
    expect((await loadHarness(write("in", "./jobs/sync.md"))).jobs?.sync.prompt).toBe("./jobs/sync.md");
  });
});

describe("parseEvery", () => {
  it("minutes and hours", () => {
    expect(parseEvery("15m")).toBe(15 * 60_000);
    expect(parseEvery("2h")).toBe(2 * 3_600_000);
    expect(parseEvery("90")).toBeNull();
    expect(parseEvery("1d")).toBeNull();
    expect(parseEvery(" 15m")).toBeNull();
  });
});

describe("jobResultSchema (spec §8)", () => {
  it("status, summary up to 300 characters, optional action", () => {
    expect(jobResultSchema.parse({ status: "needs-you", summary: "2 tickets without AC", action: "implement" })).toBeTruthy();
    expect(jobResultSchema.parse({ status: "ok", summary: "x".repeat(300) })).toBeTruthy();
    expect(() => jobResultSchema.parse({ status: "maybe", summary: "x" })).toThrow();
    expect(() => jobResultSchema.parse({ status: "ok", summary: "" })).toThrow();
    expect(() => jobResultSchema.parse({ status: "ok", summary: "x".repeat(301) })).toThrow();
  });
});
