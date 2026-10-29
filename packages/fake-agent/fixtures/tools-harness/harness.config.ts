// Test fixture for harness tools (tools spec slice 2): agent-callable tools, an agent: "none" one, and a connect step
// whose Test runs a tool. Its dist/ is built with `humanharness build` and committed (Decision 16); a unit test
// (packages/cli/test/fixture-dist.test.ts) rebuilds it in memory and compares.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "toolbox",
  name: "Toolbox",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Toolbox" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: true },
  blocks: {},
  actions: {
    survey: { label: "Survey", prompt: "./agent/tasks/survey.md", cost: "light" },
  },
  path: ["survey"],
  tools: {
    "count-notes": "./tools/count-notes.ts",
    "peek-folder": "./tools/peek-folder.ts",
    probe: "./tools/probe.ts",
    hidden: "./tools/hidden.ts",
    "check-key": "./tools/check-key.ts",
  },
  secrets: [{ id: "demo", label: "Demo key", help: "Any text: the tests never send it." }],
  setup: [{ id: "demo", kind: "connect", label: "Connect demo", secrets: ["demo"], test: "check-key" }],
  author: "Human Harness tests",
});
