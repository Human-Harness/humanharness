// Test fixture for background jobs without `parallel` (parallel spec part 3): one task at a time, as the plain app,
// plus two jobs. `sync` runs on start and by hand; `check` asks for Write A. fake-script.json holds the fake-claude
// scenario: each job's turn is picked by its brief's first words, the same turns as parallel-harness's.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "jobs",
  name: "Jobs",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Jobs" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  actions: {
    "write-a": { label: "Write A", prompt: "./agent/tasks/write-a.md", cost: "light" },
  },
  jobs: {
    sync: { label: "Sync", prompt: "./jobs/sync.md", on: { start: true, manual: true } },
    check: { label: "Check", prompt: "./jobs/check.md", on: { manual: true } },
  },
  author: "Human Harness tests",
});
