// Test fixture for tools in mock mode (tools spec §12, slice 5): Forecast's pre-step and the agent both call `weather`,
// whose one fetch is answered from mock/tools/weather/ (no network; api.weather.test only exists in the recording).
// The recording's second call (oslo) has no recorded exchange, so it fails "Not recorded: …". Its dist/ is not
// committed: `humanharness dev --build` (packages/e2e/tests/tools-mock.spec.ts) builds the tools first.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "mock-tools",
  name: "Mock Tools",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Mock Tools" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: true },
  blocks: {},
  actions: {
    forecast: {
      label: "Forecast",
      prompt: "./agent/tasks/forecast.md",
      cost: "light",
      pre: [{ tool: "weather", args: { city: "lima" }, as: "today" }],
    },
  },
  path: ["forecast"],
  questions: { tier: "light" },
  tools: { weather: "./tools/weather.ts" },
  secrets: [{ id: "weather", label: "Weather API key", help: "Any text: the tests never send it." }],
  author: "Human Harness tests",
});
