// Test fixture: only read collections (no write tools), one with a field JSON Schema cannot show (a date).
import { z } from "zod";
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "readonly",
  name: "Read only",
  core: "^0.1.0",
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Read Only" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light" },
  },
  path: ["study"],
  data: {
    events: {
      scoped: false,
      key: "id",
      schema: z.object({ id: z.string(), when: z.date(), count: z.number().optional(), done: z.boolean(), tags: z.array(z.string()) }),
      agent: "read",
    },
  },
  author: "Human Harness tests",
});
