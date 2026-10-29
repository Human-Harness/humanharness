// Test fixture for the harness's keys (tools spec §9): one declared secret, asked for by a connect step.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "secrets",
  name: "Tracker",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Tracker" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    triage: { label: "Triage", prompt: "./agent/tasks/triage.md", cost: "light" },
  },
  path: ["triage"],
  secrets: [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." }],
  setup: [{ id: "jira", kind: "connect", label: "Connect Jira", required: true, secrets: ["jira"] }],
  author: "Human Harness tests",
});
