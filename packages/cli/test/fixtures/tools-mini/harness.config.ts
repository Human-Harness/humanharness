// Test fixture for the terminal's tool host (tools slice 5, Task 2): echo returns its args, fetcher fetches a declared
// host with a key, escape reports which Node globals it can see, wait never ends, ai calls ctx.summary and
// ctx.requestAi. Its dist/ is built with `humanharness build` and committed; packages/cli/test/tool-host-node.test.ts
// rebuilds it in memory and compares.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "tools-mini",
  name: "Tools mini",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Tools mini" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: true },
  blocks: {},
  actions: {
    look: { label: "Look", prompt: "./agent/tasks/look.md", cost: "light" },
  },
  path: ["look"],
  tools: {
    echo: "./tools/echo.ts",
    fetcher: "./tools/fetcher.ts",
    escape: "./tools/escape.ts",
    wait: "./tools/wait.ts",
    ai: "./tools/ai.ts",
  },
  secrets: [{ id: "api", label: "API key", help: "Any text: the tests never send it anywhere." }],
  author: "Human Harness tests",
});
