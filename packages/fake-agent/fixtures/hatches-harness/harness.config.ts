// Test fixture for linked folders (hatches spec part 1) and engine config per scope (part 3): a plain harness (no
// `parallel`, no jobs) whose projects link repos outside the work folder. The e2e test writes its fake-claude script at
// run time: the folders it edits are the sandbox's.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "hatches",
  name: "Hatches",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Hatches" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  scopes: { label: "Project", plural: "Projects" },
  actions: {
    implement: { label: "Implement", prompt: "./agent/tasks/implement.md", cost: "light" },
  },
  linkedFolders: { repos: { label: "Repos", mode: "write", history: "auto", many: true } },
  // Engine config per scope (hatches part 3): hatches-engine.spec writes `.harness/engine/<scope>/` at run time.
  enginePresets: true,
  author: "Human Harness tests",
});
