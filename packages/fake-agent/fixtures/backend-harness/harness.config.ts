// Test fixture for the harness backend (hatches spec §4): one action and a small Node process of its own.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "backend-fx",
  name: "Backend fixture",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Backend Fixture" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    ask: { label: "Ask", prompt: "./agent/tasks/ask.md", cost: "light" },
  },
  path: ["ask"],
  backend: "./backend/index.ts",
  author: "Human Harness tests",
});
