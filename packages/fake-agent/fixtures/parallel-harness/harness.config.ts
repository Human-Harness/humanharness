// Test fixture for parallel tasks (parallel spec §11): two actions that each write their own file, so two tasks can
// run at once; a free question starting "both" writes a shared file. Four background jobs (part 3): `sync` runs on
// start, `check` asks for Write A, `asker` tries to ask, `silent` ends with no result. fake-script.json holds the
// fake-claude scenarios: each job's turn is picked by its brief's first words.
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
  jobs: {
    sync: { label: "Sync", prompt: "./jobs/sync.md", on: { start: true, manual: true } },
    check: { label: "Check", prompt: "./jobs/check.md", on: { manual: true } },
    asker: { label: "Asker", prompt: "./jobs/asker.md", on: { manual: true } },
    silent: { label: "Silent", prompt: "./jobs/silent.md", on: { manual: true } },
  },
  author: "Human Harness tests",
});
