import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-recipes-");
afterAll(cleanup);
let n = 0;

/** A tool file: `returns` is a zod expression or nothing. */
const tool = (description: string, returns?: string) => `import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: ${JSON.stringify(description)},
  params: z.object({}),
  ${returns ? `returns: ${returns},\n  ` : ""}uses: { files: "read" },
  async run() {
    return [];
  },
});
`;

const TOOLS = {
  "open-prs": ["Lists the open pull requests of the repository.", undefined],
  "pr-ci": ["Reads the CI runs of the open pull requests.", "z.array(z.object({ id: z.string() }))"],
  "apply-triage": ["Labels the pull requests the triage picked."],
} as const;

/**
 * The template with three tools (`open-prs` without returns, `pr-ci` with, `apply-triage`) and one job, `sync`, whose
 * steps are `steps`. `brief` is the AI step brief's text (./jobs/classify.md), null for none.
 */
async function fixture(steps: string, brief: string | null = "Pick the failing pull requests.\n"): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  const tools = Object.keys(TOOLS).map((id) => `"${id}": "./tools/${id}.ts"`).join(", ");
  replaceIn(dir, "harness.config.ts", "  actions: {\n", `  tools: { ${tools} },\n  actions: {\n`);
  replaceIn(dir, "harness.config.ts", 'questions: { tier: "light" },', `questions: { tier: "light" },\n  jobs: {\n    sync: { label: "Sync", on: { manual: true }, steps: ${steps} },\n  },`);
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  for (const [id, [description, returns]] of Object.entries(TOOLS)) fs.writeFileSync(path.join(dir, "tools", `${id}.ts`), tool(description, returns));
  if (brief !== null) {
    fs.mkdirSync(path.join(dir, "jobs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "jobs", "classify.md"), brief);
  }
  return dir;
}
const AI = '{ ai: "./jobs/classify.md", input: ["ci"], output: z.object({ ids: z.array(z.string()) }), as: "triage" }';
const RECIPE = `[{ tool: "pr-ci", as: "ci" }, ${AI}, { tool: "apply-triage", input: ["triage"] }]`;
const of = (r: Awaited<ReturnType<typeof checkHarness>>, rule: string) => r.findings.filter((f) => f.rule === rule).map((f) => `${f.file} ${f.message}`);

describe("check: job recipes (tools spec §3.3, §7)", () => {
  it("an AI step whose brief is missing is brief-missing", async () => {
    const r = await checkHarness(await fixture(RECIPE, null));
    expect(of(r, "brief-missing")).toEqual(['harness.config.ts Job "sync": its AI step brief ./jobs/classify.md does not exist.']);
  });

  it("an empty AI step brief is brief-missing", async () => {
    const r = await checkHarness(await fixture(RECIPE, " \n"));
    expect(of(r, "brief-missing")).toEqual(['jobs/classify.md Job "sync": its AI step brief ./jobs/classify.md is empty.']);
  });

  it("a recipe without prompt reads no prompt brief", async () => {
    const r = await checkHarness(await fixture(RECIPE));
    expect(of(r, "brief-missing")).toEqual([]);
    expect(r.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("a post-step reading a tool without returns is a tool-steps error", async () => {
    const r = await checkHarness(await fixture(`[{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", as: "ci" }, ${AI}, { tool: "apply-triage", input: ["prs"] }]`));
    expect(r.findings.filter((f) => f.rule.startsWith("tool-"))).toEqual([
      { rule: "tool-steps", severity: "error", message: 'Job "sync": steps[3]: input "prs": open-prs declares no returns', file: "harness.config.ts" },
    ]);
  });

  it("an AI step's input from a tool without returns is a tool-steps error", async () => {
    const r = await checkHarness(await fixture(`[{ tool: "open-prs", as: "ci" }, ${AI}, { tool: "apply-triage", input: ["triage"] }]`));
    expect(of(r, "tool-steps")).toEqual(['harness.config.ts Job "sync": steps[1]: input "ci": open-prs declares no returns']);
  });

  it("an AI step output with a date is a schema error, and check does not crash", async () => {
    const r = await checkHarness(await fixture(`[{ tool: "pr-ci", as: "ci" }, { ai: "./jobs/classify.md", input: ["ci"], output: z.object({ at: z.date() }), as: "triage" }]`));
    expect(of(r, "schema")).toEqual([
      "harness.config.ts jobs.sync.steps.1.output: Job \"sync\": steps[1]: the AI step's output must convert to JSON Schema (no dates, transforms or other types JSON can't hold)",
    ]);
  });

  it("job-daily-tokens: dailyTokens on a periodic recipe with no AI step is a warning (it caps nothing)", async () => {
    const dir = await fixture('[{ tool: "pr-ci", as: "ci" }, { tool: "apply-triage", input: ["ci"] }]', null);
    replaceIn(dir, "harness.config.ts", 'on: { manual: true }, steps:', 'on: { every: "1h" }, dailyTokens: 1000, steps:');
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "job-daily-tokens")).toEqual([
      { rule: "job-daily-tokens", severity: "warning", message: 'Job "sync": dailyTokens caps only runs that use AI, and this recipe has no AI step, so it caps nothing.', file: "harness.config.ts" },
    ]);
  });

  it("dailyTokens on a periodic recipe with an AI step is no warning", async () => {
    const dir = await fixture(RECIPE);
    replaceIn(dir, "harness.config.ts", 'on: { manual: true }, steps:', 'on: { every: "1h" }, dailyTokens: 1000, steps:');
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.severity === "error" || f.rule === "job-daily-tokens")).toEqual([]);
  });

  it("a recipe with no AI step reads no brief", async () => {
    const r = await checkHarness(await fixture('[{ tool: "pr-ci", as: "ci" }, { tool: "apply-triage", input: ["ci"] }]', null));
    expect(r.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
