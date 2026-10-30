import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { aiStepOf, defineBlock, defineHarness, hasRecipes, jobUsesAi, loadHarness, MAX_AI_CAP, postStepIndex, RESERVED_BLOCK_NAMES, STEP_OUTPUT_TOOL } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
  actions: { "triage-ci": { label: "Triage CI", prompt: "./prompts/triage.md", cost: "light" as const } },
  tools: { "open-prs": "./tools/open-prs.ts", "pr-ci": "./tools/pr-ci.ts", "apply-triage": "./tools/apply-triage.ts" },
};
const Triage = z.object({ failing: z.array(z.string()), again: z.boolean() });
const ai = (extra: Record<string, unknown> = {}) => ({ ai: "./jobs/classify.md", input: ["ci"], output: Triage, as: "triage", ...extra });
const recipe = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  label: "Sync", on: { manual: true }, steps, ...extra,
});
const full = [{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", as: "ci" }, ai({ when: { from: "ci", where: { failed: true } } }), { tool: "apply-triage", input: ["triage"] }];
const make = (jobs: Record<string, unknown>) => defineHarness({ ...base, jobs } as never);

/** The issue messages of a refused manifest (zod's own message escapes the quotes our messages hold). */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    const issues = (e as { issues?: { message: string }[] }).issues;
    return issues ? issues.map((i) => i.message).join("\n") : String((e as Error).message);
  }
  throw new Error("not refused");
}

describe("job recipes in the manifest (tools spec §3, §7)", () => {
  it("D0: a prompt job parses as before, with no steps, maxAi or onLimit", () => {
    const h = make({ sync: { label: "Sync", prompt: "./jobs/sync.md", on: { manual: true } } });
    expect(h.jobs!.sync).toStrictEqual({ label: "Sync", prompt: "./jobs/sync.md", tier: "light", on: { manual: true }, scope: "none" });
    expect(hasRecipes(h)).toBe(false);
    expect(jobUsesAi(h.jobs!.sync)).toBe(true);
    expect(postStepIndex(h.jobs!.sync)).toBe(-1);
    expect(aiStepOf(h.jobs!.sync)).toBeUndefined();
  });
  it("D0: a harness without jobs has no recipes", () => {
    expect(hasRecipes(defineHarness(base as never))).toBe(false);
  });
  it("keeps a recipe: tool steps, one AI step with its zod output, a post-step, maxAi and onLimit", () => {
    const h = make({ sync: recipe(full, { maxAi: 3, onLimit: "triage-ci" }) });
    const j = h.jobs!.sync;
    expect(j.steps).toHaveLength(4);
    expect(j.prompt).toBeUndefined();
    expect(j.maxAi).toBe(3);
    expect(j.onLimit).toBe("triage-ci");
    expect(aiStepOf(j)?.output).toBe(Triage);
    expect(aiStepOf(j)?.tier).toBe("light");
    expect(aiStepOf(j)?.when).toEqual({ from: "ci", where: { failed: true } });
    expect(postStepIndex(j)).toBe(3);
    expect(hasRecipes(h)).toBe(true);
    expect(jobUsesAi(j)).toBe(true);
    expect(MAX_AI_CAP).toBe(3);
    expect(STEP_OUTPUT_TOOL).toBe("step_output");
  });
  it("an AI step keeps its tier", () => {
    const h = make({ sync: recipe([{ tool: "pr-ci", as: "ci" }, ai({ tier: "deep" })]) });
    expect(aiStepOf(h.jobs!.sync)?.tier).toBe("deep");
  });
  it("a recipe whose AI step is last has no post-step", () => {
    const h = make({ sync: recipe([{ tool: "pr-ci", as: "ci" }, ai()]) });
    expect(postStepIndex(h.jobs!.sync)).toBe(-1);
  });
  it("a recipe of tool steps only uses no AI and needs no dailyTokens with every", () => {
    const h = make({ sync: recipe([{ tool: "open-prs" }], { on: { every: "30m" } }) });
    expect(jobUsesAi(h.jobs!.sync)).toBe(false);
    expect(postStepIndex(h.jobs!.sync)).toBe(-1);
    expect(h.jobs!.sync.dailyTokens).toBeUndefined();
  });
  it.each([
    ["both prompt and steps", { s: { ...recipe([{ tool: "open-prs" }]), prompt: "./jobs/s.md" } }, "prompt or steps, not both"],
    ["neither prompt nor steps", { s: { label: "S", on: { manual: true } } }, "A job declares prompt or steps"],
    ["two AI steps", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai(), ai({ as: "again" })]) }, "at most one AI step"],
    ["an AI step whose input names no earlier as", { s: recipe([ai()]) }, 'input "ci" names no earlier step\'s as'],
    ["a when naming no earlier as", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ when: { from: "nope" } })]) }, 'when "nope" names no earlier step\'s as'],
    ["a when on a tool step", { s: recipe([{ tool: "pr-ci", as: "ci", when: { from: "ci" } }]) }, undefined],
    ["a when with an object value", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ when: { from: "ci", where: { failed: { x: 1 } } } })]) }, undefined],
    ["a when with an empty where", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ when: { from: "ci", where: {} } })]) }, undefined],
    ["an output that isn't a zod object", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ output: z.array(z.string()) })]) }, undefined],
    ["an output that is plain JSON", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ output: { type: "object" } })]) }, undefined],
    ["maxAi over 3", { s: recipe(full, { maxAi: 4 }) }, undefined],
    ["maxAi under 1", { s: recipe(full, { maxAi: 0 }) }, undefined],
    ["maxAi without an AI step", { s: recipe([{ tool: "open-prs" }], { maxAi: 2 }) }, "maxAi needs an AI step"],
    ["onLimit naming no action", { s: recipe(full, { onLimit: "nope" }) }, 'onLimit names no action "nope"'],
    ["onLimit without an AI step", { s: recipe([{ tool: "open-prs" }], { onLimit: "triage-ci" }) }, "onLimit needs an AI step"],
    ["maxAi on a prompt job", { s: { label: "S", prompt: "./jobs/s.md", on: { manual: true }, maxAi: 2 } }, "maxAi needs an AI step"],
    ["onLimit on a prompt job", { s: { label: "S", prompt: "./jobs/s.md", on: { manual: true }, onLimit: "triage-ci" } }, "onLimit needs an AI step"],
    ["permissions on a recipe", { s: recipe([{ tool: "open-prs" }], { permissions: { exec: false } }) }, "a recipe's tools use their own uses"],
    ["every with an AI step and no dailyTokens", { s: recipe(full, { on: { every: "30m" } }) }, "dailyTokens is required with every"],
    ["no steps at all", { s: recipe([]) }, undefined],
    ["more than 20 steps", { s: recipe(Array.from({ length: 21 }, () => ({ tool: "open-prs" }))) }, undefined],
    ["a step naming no tool", { s: recipe([{ tool: "nope" }]) }, '"nope" is not a tool of this harness'],
    ["an as used twice", { s: recipe([{ tool: "open-prs", as: "x" }, { tool: "pr-ci", as: "x" }]) }, 'as "x" is used twice'],
    ["required on a recipe step", { s: recipe([{ tool: "open-prs", required: true }]) }, undefined],
  ])("refuses %s", (_n, jobs, message) => {
    const run = () => make(jobs);
    if (message) expect(refusal(run)).toContain(message);
    else expect(run).toThrow();
  });
  it("names the recipe's job in a step problem", () => {
    expect(refusal(() => make({ s: recipe([{ tool: "nope" }]) }))).toContain('Job "s": steps[0]: "nope" is not a tool of this harness');
  });
  it("refuses a tool named step_output", () => {
    expect(refusal(() => defineHarness({ ...base, tools: { step_output: "./tools/x.ts" } } as never))).toContain('Tool id "step_output" clashes with a block tool name');
  });
  it("refuses a block named step_output", () => {
    expect(RESERVED_BLOCK_NAMES).toContain(STEP_OUTPUT_TOOL);
    const block = defineBlock({ description: "x", schema: z.object({}), example: {}, visible: false });
    expect(refusal(() => defineHarness({ ...base, blocks: { step_output: block } } as never))).toContain('"step_output" is a core block name');
  });
});

describe("loadHarness: an AI step's brief stays inside the harness folder", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-recipes-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  // The manifest builds its AI step's output with zod, as a harness does; it imports the same zod by file URL.
  const zodUrl = pathToFileURL(path.join(path.dirname(createRequire(import.meta.url).resolve("zod/package.json")), "index.js")).href;
  const write = (name: string, brief: string) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const { tools: _t, ...rest } = base;
    const manifest = { ...rest, id: name, tools: { "pr-ci": "./tools/pr-ci.ts" } };
    const job = `{ label: "Sync", on: { manual: true }, steps: [{ tool: "pr-ci", as: "ci" }, { ai: ${JSON.stringify(brief)}, input: ["ci"], output: z.object({ ok: z.boolean() }) }] }`;
    fs.writeFileSync(
      path.join(dir, "harness.config.mjs"),
      `import { z } from ${JSON.stringify(zodUrl)};\nexport default { ...${JSON.stringify(manifest)}, jobs: { sync: ${job} } };\n`,
    );
    return path.join(dir, "harness.config.mjs");
  };
  it("refuses an AI brief that escapes it", async () => {
    await expect(loadHarness(write("out", "../outside.md"))).rejects.toThrow("escapes");
  });
  it("loads an AI brief inside it, and a recipe job without prompt", async () => {
    const h = await loadHarness(write("in", "./jobs/classify.md"));
    expect(aiStepOf(h.jobs!.sync)?.ai).toBe("./jobs/classify.md");
    expect(h.jobs!.sync.prompt).toBeUndefined();
  });
});
