// Test fixture for several sidekicks: a report task with two parts, and a harness preset that guards the move between them.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "planner",
  name: "Planner",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Planner" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    report: {
      label: "Report",
      prompt: "./agent/tasks/report.md",
      cost: "light",
      phases: [
        { id: "outline", label: "Outline", brief: "./agent/phases/outline.md" },
        { id: "writing", label: "Writing", brief: "./agent/phases/writing.md" },
      ],
    },
  },
  path: ["report"],
  sidekick: {
    default: "off",
    presets: [{ name: "Guard", mark: "🛡️", personality: "Calm and brief.", purposes: [{ id: "process-guard" }] }],
  },
  author: "Human Harness tests",
});
