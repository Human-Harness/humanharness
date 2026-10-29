// Test fixture for a job recipe's AI step (tools spec §7.1): one action, one tool, and a recipe job whose AI step ends
// with `step_output`. The ui server only loads the manifest, so nothing here is built.
import { defineHarness, z } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "recipe",
  name: "Recipe",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Recipe" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  actions: {
    "write-a": { label: "Write A", prompt: "./agent/tasks/write-a.md", cost: "light" },
  },
  tools: { "list-prs": "./tools/list-prs.ts" },
  jobs: {
    triage: {
      label: "Triage",
      on: { manual: true },
      steps: [
        { tool: "list-prs", as: "prs" },
        { ai: "./jobs/triage.md", input: ["prs"], output: z.object({ ids: z.array(z.string()), again: z.boolean() }), as: "triage" },
      ],
    },
  },
  author: "Human Harness tests",
});
