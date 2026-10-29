// Test fixture for harness tools (tools spec slice 2): agent-callable tools, an agent: "none" one, and a connect step
// whose Test runs a tool. Its dist/ is built with `humanharness build` and committed (Decision 16); a unit test
// (packages/cli/test/fixture-dist.test.ts) rebuilds it in memory and compares.
// Slice 3 (pre-steps): Study prepares two items before its session opens (the second reads the first through `input`)
// and expects count-notes in its Close part; Strict's one required pre-step always fails, so it never starts.
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
    study: {
      label: "Study",
      prompt: "./agent/tasks/study.md",
      cost: "light",
      pre: [
        { tool: "due-today", as: "today" },
        { tool: "pick-two", input: ["today"], as: "warmup" },
      ],
      phases: [
        { id: "main", label: "Main", brief: "./agent/phases/main.md", auto: true },
        { id: "close", label: "Close", brief: "./agent/phases/close.md", close: true, expects: ["count-notes"] },
      ],
    },
    strict: {
      label: "Strict",
      prompt: "./agent/tasks/strict.md",
      cost: "light",
      pre: [{ tool: "always-fails", as: "x", required: true }],
    },
  },
  path: ["survey", "study", "strict"],
  tools: {
    "count-notes": "./tools/count-notes.ts",
    "peek-folder": "./tools/peek-folder.ts",
    probe: "./tools/probe.ts",
    hidden: "./tools/hidden.ts",
    "check-key": "./tools/check-key.ts",
    "due-today": "./tools/due-today.ts",
    "pick-two": "./tools/pick-two.ts",
    "always-fails": "./tools/always-fails.ts",
  },
  secrets: [{ id: "demo", label: "Demo key", help: "Any text: the tests never send it." }],
  setup: [{ id: "demo", kind: "connect", label: "Connect demo", secrets: ["demo"], test: "check-key" }],
  author: "Human Harness tests",
});
