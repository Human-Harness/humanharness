// Test fixture for parallel tasks (parallel spec §11): two actions that each write their own file, so two tasks can
// run at once; a free question starting "both" writes a shared file. fake-script.json holds the fake-claude scenarios.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "parallel",
  name: "Parallel",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Parallel" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  actions: {
    "write-a": { label: "Write A", prompt: "./agent/tasks/write-a.md", cost: "light" },
    "write-b": { label: "Write B", prompt: "./agent/tasks/write-b.md", cost: "light" },
  },
  parallel: { tasks: 2, jobs: 1 },
  author: "Human Harness tests",
});
