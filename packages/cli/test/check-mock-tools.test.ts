import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCommand, checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, dropExampleTool, memoryIo, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-mock-tools-");
afterAll(cleanup);
let n = 0;

const tool = (description: string, o: { returns?: string; agent?: "none" } = {}) => `import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: ${JSON.stringify(description)},
  params: z.object({}),
  ${o.returns ? `returns: ${o.returns},\n  ` : ""}${o.agent ? `agent: "${o.agent}",\n  ` : ""}uses: { files: "read" },
  async run() {
    return [];
  },
});
`;

const AI = '{ ai: "./jobs/classify.md", input: ["ci"], output: z.object({ ids: z.array(z.string()) }), as: "triage" }';
const RECIPE = `[{ tool: "pr-ci", as: "ci" }, ${AI}, { tool: "apply-triage", input: ["triage"] }]`;

/** The template's one action `example`, as a recording whose turns are `turns`. */
const recording = (turns: unknown[]) => ({ version: 1, action: "example", match: "# Task: example", turns });

/**
 * The template without its example tool, with (unless `tools` is false) the tools `pr-ci` (returns), `apply-triage` (`agent: "none"`) and
 * `open-prs`, and the jobs `sync` (`steps`) and `plain` (a recipe with no AI step). `mock` files are written under
 * `mock/` (an object as JSON, a string as is).
 */
async function fixture(o: { tools?: boolean; steps?: string; mock?: Record<string, unknown> } = {}): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  dropExampleTool(dir);
  if (o.tools !== false) {
    replaceIn(dir, "harness.config.ts", "  actions: {\n", '  tools: { "pr-ci": "./tools/pr-ci.ts", "apply-triage": "./tools/apply-triage.ts", "open-prs": "./tools/open-prs.ts" },\n  actions: {\n');
    replaceIn(
      dir,
      "harness.config.ts",
      'questions: { tier: "light" },',
      `questions: { tier: "light" },\n  jobs: {\n    sync: { label: "Sync", on: { manual: true }, steps: ${o.steps ?? RECIPE} },\n    plain: { label: "Plain", on: { manual: true }, steps: [{ tool: "pr-ci", as: "ci" }, { tool: "apply-triage", input: ["ci"] }] },\n  },`,
    );
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "pr-ci.ts"), tool("Reads the CI runs of the open pull requests.", { returns: "z.array(z.object({ id: z.string() }))" }));
    fs.writeFileSync(path.join(dir, "tools", "apply-triage.ts"), tool("Labels the pull requests the triage picked.", { agent: "none" }));
    fs.writeFileSync(path.join(dir, "tools", "open-prs.ts"), tool("Lists the open pull requests of the repository."));
    fs.mkdirSync(path.join(dir, "jobs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "jobs", "classify.md"), "Pick the failing pull requests.\n");
  }
  for (const [rel, value] of Object.entries(o.mock ?? {})) {
    const file = path.join(dir, "mock", ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  return dir;
}

const of = (r: Awaited<ReturnType<typeof checkHarness>>, rule: string) => r.findings.filter((f) => f.rule === rule).map((f) => `${f.file} ${f.message}`);

describe("check: tool calls in recordings and AI step recordings (tools spec §12, Decisions 9, 11)", () => {
  it("a turn's tools naming no agent: call tool is a mock-schema error", { timeout: 60_000 }, async () => {
    const dir = await fixture({
      mock: {
        "example.json": recording([
          { id: "t1", text: "Hola.", tools: [{ tool: "open-prs", args: {} }, { tool: "nope", args: {} }, { tool: "apply-triage", args: {} }], next: { "*": "t2" } },
          { id: "t2", tools: [{ tool: "pr-ci", args: { x: 1 } }] },
        ]),
      },
    });
    const r = await checkHarness(dir);
    expect(of(r, "mock-schema")).toEqual([
      'mock/example.json Turn "t1": tools[1] calls "nope", which is not a tool of this harness.',
      'mock/example.json Turn "t1": tools[2] calls "apply-triage", which the agent can\'t call (agent: "none").',
    ]);
    expect(r.findings.filter((f) => f.severity === "error")).toHaveLength(2);
  });

  it("a harness with no tools: every recorded tool call is a mock-schema error", { timeout: 60_000 }, async () => {
    const dir = await fixture({ tools: false, mock: { "example.json": recording([{ id: "t1", text: "Hola.", tools: [{ tool: "open-prs", args: {} }] }]) } });
    const r = await checkHarness(dir);
    expect(of(r, "mock-schema")).toEqual(['mock/example.json Turn "t1": tools[0] calls "open-prs", which is not a tool of this harness.']);
  });

  it("tools that don't build: only the build problem, no tool-call finding", { timeout: 60_000 }, async () => {
    const dir = await fixture({ mock: { "example.json": recording([{ id: "t1", text: "Hola.", tools: [{ tool: "nope", args: {} }] }]) } });
    fs.writeFileSync(path.join(dir, "tools", "open-prs.ts"), "export default {");
    const r = await checkHarness(dir);
    expect(of(r, "tool-build").length).toBeGreaterThan(0);
    expect(of(r, "mock-schema")).toEqual([]);
  });

  it("mock-step: a step recording for no recipe with an AI step is an error", { timeout: 60_000 }, async () => {
    const dir = await fixture({
      mock: {
        "steps/sync.json": { version: 1, job: "sync", output: { ids: ["1"] } },
        "steps/plain.json": { version: 1, job: "plain", output: {} },
        "steps/gone.json": { version: 1, job: "gone", output: {} },
        "steps/misnamed.json": { version: 1, job: "sync", output: { ids: [] } },
        "steps/broken.json": "{ nope",
        "steps/shape.json": { version: 1, job: "shape" },
        "steps/folder.json/x": "",
        "steps/notes.txt": "ignored: not .json",
      },
    });
    const r = await checkHarness(dir);
    expect(of(r, "mock-step")).toEqual([
      expect.stringMatching(/^mock\/steps\/broken\.json Not valid JSON: /),
      "mock/steps/folder.json folder.json is not a file.",
      'mock/steps/gone.json Job "gone" is not in the manifest.',
      'mock/steps/misnamed.json The step recording of "sync" must be named sync.json.',
      'mock/steps/plain.json Job "plain" has no AI step, so nothing plays this recording.',
      expect.stringMatching(/^mock\/steps\/shape\.json output: /),
    ]);
    expect(r.findings.filter((f) => f.rule === "mock-step").every((f) => f.severity === "error")).toBe(true);
  });

  it("mock-step: an output and request the AI step's output takes give no finding", { timeout: 60_000 }, async () => {
    const good = await fixture({ mock: { "steps/sync.json": { version: 1, job: "sync", output: { ids: ["1"] }, request: { ids: [] } } } });
    expect(of(await checkHarness(good), "mock-step")).toEqual([]);
  });

  it("mock-step: output and request are checked against the job's AI step output", { timeout: 60_000 }, async () => {
    const bad = await fixture({ mock: { "steps/sync.json": { version: 1, job: "sync", output: { ids: [1] }, request: { other: true } } } });
    expect(of(await checkHarness(bad), "mock-step")).toEqual([
      expect.stringMatching(/^mock\/steps\/sync\.json output is not a valid output of the AI step: ids\.0: \S/),
      expect.stringMatching(/^mock\/steps\/sync\.json request is not a valid output of the AI step: ids: \S/),
    ]);
  });

  it("mock-step: a linked steps folder is an error and is never read", { timeout: 60_000 }, async () => {
    const outside = path.join(root, `o${++n}`);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "gone.json"), JSON.stringify({ version: 1, job: "gone", output: {} }));
    const dir = await fixture({ mock: { "example.json": recording([{ id: "t1", text: "Hola." }]) } });
    fs.symlinkSync(outside, path.join(dir, "mock", "steps"), "dir");
    expect(of(await checkHarness(dir), "mock-step")).toEqual(["mock/steps steps is not a folder."]);
  });

  it("mock-step: a hard link or a file over 10 MB is an error, as mock mode refuses it", { timeout: 60_000 }, async () => {
    const big = JSON.stringify({ version: 1, job: "sync", output: { ids: ["x".repeat(10 * 1024 * 1024)] } });
    const dir = await fixture({ mock: { "steps/sync.json": big, "steps/real.json": { version: 1, job: "sync", output: { ids: [] } } } });
    fs.linkSync(path.join(dir, "mock", "steps", "real.json"), path.join(dir, "mock", "steps", "linked.json"));
    expect(of(await checkHarness(dir), "mock-step")).toEqual([
      "mock/steps/linked.json linked.json is a hard link.",
      "mock/steps/real.json real.json is a hard link.",
      "mock/steps/sync.json sync.json is too big (over 10 MB).",
    ]);
  });

  it("D0: a harness without tools or recipes gets no new mock finding", { timeout: 60_000 }, async () => {
    // The template with a recording without tools and a stray steps file: check's output as before this task.
    const dir = await fixture({ tools: false, mock: { "example.json": recording([{ id: "t1", text: "Hola." }]), "steps/sync.json": { version: 1, job: "sync", output: [] } } });
    const m = memoryIo(dir);
    expect(await checkCommand([], m.io)).toBe(0);
    expect(m.out()).toBe("No problems found.\n");
    expect(m.err()).toBe("");
    // A harness with tools and recipes but no recordings: no mock finding either.
    const r = await checkHarness(await fixture());
    expect(r.findings.filter((f) => f.rule.startsWith("mock-"))).toEqual([]);
  });
});
