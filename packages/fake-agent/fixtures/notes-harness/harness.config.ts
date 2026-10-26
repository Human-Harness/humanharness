// Test fixture for the core packages: the smallest harness with one visible and one state-only block.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const note = defineBlock({
  description: "Shows a note with a title and a body to the user.",
  visible: true,
  schema: z.object({ title: z.string().min(1), body: z.string() }),
  example: { title: "Example", body: "Text of the note." },
});

const progress = defineBlock({
  description: "Updates the progress of the session, from 0 to 100.",
  visible: false,
  schema: z.object({ percent: z.number().min(0).max(100) }),
  example: { percent: 50 },
});

export default defineHarness({
  id: "notes",
  name: "Notes",
  core: "^0.1.0",
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Notes", seed: "./agent/seed" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { note, progress },
  author: "Human Harness tests",
});
