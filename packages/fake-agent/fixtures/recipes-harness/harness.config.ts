// Test fixture for job recipes (tools spec slice 4): single mode (jobs, no `parallel`) with four recipe jobs. Triage
// runs a tool, a conditional AI step and a post-step that asks for one more AI round; Quiet's `when` doesn't hold, so it
// skips the AI step; Capped asks past its maxAi and offers Write A; Broken's one tool throws. Its dist/ is built with
// `humanharness build` and committed; packages/cli/test/recipes-fixture-dist.test.ts rebuilds it in memory and
// compares. fake-script.json answers the AI step's turns with step_output, picked by their first words.
import { defineHarness, z } from "@humanharness/harness-sdk";

const triageSteps = (fail: boolean) => [
  { tool: "check-items", args: { fail }, as: "items" },
  {
    ai: "./jobs/classify.md",
    input: ["items"],
    output: z.object({ ids: z.array(z.string()), again: z.boolean() }),
    when: { from: "items", where: { failed: true } },
    as: "triage",
  },
  { tool: "apply-triage", input: ["triage"] },
];

export default defineHarness({
  id: "recipes",
  name: "Recipes",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Recipes" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  actions: {
    "write-a": { label: "Write A", prompt: "./agent/tasks/write-a.md", cost: "light" },
  },
  jobs: {
    triage: { label: "Triage", on: { manual: true }, scope: "none", steps: triageSteps(true), maxAi: 2 },
    quiet: { label: "Quiet", on: { manual: true }, scope: "none", steps: triageSteps(false) },
    capped: { label: "Capped", on: { manual: true }, scope: "none", steps: triageSteps(true), maxAi: 1, onLimit: "write-a" },
    broken: { label: "Broken", on: { manual: true }, scope: "none", steps: [{ tool: "boom" }] },
  },
  tools: {
    "check-items": "./tools/check-items.ts",
    "apply-triage": "./tools/apply-triage.ts",
    boom: "./tools/boom.ts",
  },
  author: "Human Harness tests",
});
