import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type JobStep, type ToolMeta, type ToolsJson, defineHarness, recipeSourceProblems } from "../src";

/** A tools.json with one entry per id: an agent: call tool with no params and no returns, changed by its overrides. */
function json(tools: Record<string, Partial<Pick<ToolMeta, "agent" | "params" | "returns">>>): ToolsJson {
  const out: ToolsJson["tools"] = {};
  for (const [id, over] of Object.entries(tools)) {
    const entry: ToolMeta = { description: `The ${id} tool of the ci harness`, agent: "call", uses: {}, params: { type: "object", properties: {} }, timeout: 30, file: `tools/${id}.js` };
    if (over.agent) entry.agent = over.agent;
    if (over.params) entry.params = over.params;
    if (over.returns) entry.returns = over.returns;
    out[id] = entry;
  }
  return { version: 1, tools: out };
}

/** A manifest with one recipe job, `sync`. */
const m = (steps: JobStep[]) => ({ jobs: { sync: { label: "Sync", on: { manual: true }, steps } } });
const brief = "./jobs/classify.md";
const Triage = z.object({ ids: z.array(z.string()) });
const LIST = { type: "array", items: { type: "object" } };

describe("recipeSourceProblems (tools spec §3.3)", () => {
  it("a post-step's input may name the AI step's as: its output is the source", () => {
    const steps: JobStep[] = [{ tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output: Triage, as: "triage", tier: "light" }, { tool: "apply-triage", input: ["triage"] }];
    expect(recipeSourceProblems(m(steps), json({ "pr-ci": { returns: LIST }, "apply-triage": {} }))).toEqual([]);
  });

  it("forEach over the AI step's output needs an array output", () => {
    const steps: JobStep[] = [{ tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output: Triage, as: "triage", tier: "light" }, { tool: "apply-triage", forEach: "triage" }];
    expect(recipeSourceProblems(m(steps), json({ "pr-ci": { returns: LIST }, "apply-triage": {} }))).toEqual([
      'Job "sync": steps[2]: forEach "triage": the AI step does not return an array',
    ]);
  });

  it("an AI step's input naming a tool without returns is a problem", () => {
    const steps: JobStep[] = [{ tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output: Triage, as: "triage", tier: "light" }];
    expect(recipeSourceProblems(m(steps), json({ "pr-ci": {} }))).toEqual(['Job "sync": steps[1]: input "ci": pr-ci declares no returns']);
  });

  it("a post-step's input naming a tool without returns keeps the recipe's index", () => {
    const steps: JobStep[] = [{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output: Triage, tier: "light" }, { tool: "apply-triage", input: ["prs"] }];
    expect(recipeSourceProblems(m(steps), json({ "open-prs": {}, "pr-ci": { returns: LIST }, "apply-triage": {} }))).toEqual([
      'Job "sync": steps[3]: input "prs": open-prs declares no returns',
    ]);
  });

  it("forEach in a recipe checks the items against the tool's required params", () => {
    const j = json({
      "open-prs": { returns: { type: "array", items: { type: "object", properties: { repo: { type: "string" } } } } },
      "pr-ci": { params: { type: "object", properties: { repo: { type: "string" }, number: { type: "integer" } }, required: ["repo", "number"] } },
    });
    expect(recipeSourceProblems(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), j)).toEqual([
      'Job "sync": steps[1]: forEach "prs": its items have no "number", a required param of pr-ci',
    ]);
    expect(recipeSourceProblems(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", args: { number: 1 } }]), j)).toEqual([]);
  });

  it("an AI step output that can't convert to JSON Schema is a problem line, never a throw", () => {
    const steps: JobStep[] = [{ tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output: z.object({ at: z.date() }), as: "triage", tier: "light" }, { tool: "apply-triage", input: ["triage"] }];
    expect(recipeSourceProblems(m(steps), json({ "pr-ci": { returns: LIST }, "apply-triage": {} }))).toEqual([
      'Job "sync": steps[1]: the AI step\'s output must convert to JSON Schema (no dates, transforms or other types JSON can\'t hold)',
    ]);
  });

  it("D0: a harness with prompt jobs only has no problems", () => {
    const j = json({ "pr-ci": {}, "open-prs": { returns: { type: "object", properties: {} } } });
    expect(recipeSourceProblems({ jobs: { sync: { prompt: "./jobs/sync.md" } } }, j)).toEqual([]);
    expect(recipeSourceProblems({}, j)).toEqual([]);
  });
});

describe("an AI step's output in the manifest (tools spec §7.1)", () => {
  const manifest = (output: z.ZodObject) => ({
    id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
    permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
    actions: { "triage-ci": { label: "Triage CI", prompt: "./prompts/triage.md", cost: "light" as const } },
    tools: { "pr-ci": "./tools/pr-ci.ts" },
    jobs: { sync: { label: "Sync", on: { manual: true }, steps: [{ tool: "pr-ci", as: "ci" }, { ai: brief, input: ["ci"], output }] } },
  });
  /** The issue messages of a refused manifest (zod's own message escapes the quotes our messages hold). */
  function refusal(run: () => unknown): string {
    try {
      run();
    } catch (e) {
      return ((e as { issues?: { message: string }[] }).issues ?? []).map((i) => i.message).join("\n");
    }
    throw new Error("not refused");
  }

  it("an output with a date is refused at load: it must convert to JSON Schema", () => {
    expect(refusal(() => defineHarness(manifest(z.object({ at: z.date() })) as never))).toBe(
      'Job "sync": steps[1]: the AI step\'s output must convert to JSON Schema (no dates, transforms or other types JSON can\'t hold)',
    );
  });

  it("an output with a transform is refused at load", () => {
    expect(refusal(() => defineHarness(manifest(z.object({ n: z.string().transform((s) => s.length) })) as never))).toContain("must convert to JSON Schema");
  });

  it("a plain output loads", () => {
    expect(defineHarness(manifest(z.object({ ids: z.array(z.string()) })) as never).jobs?.sync.steps).toHaveLength(2);
  });
});
