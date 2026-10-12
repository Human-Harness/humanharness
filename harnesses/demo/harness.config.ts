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
  id: "demo",
  name: { es: "Demo", en: "Demo" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Demo", seed: "./agent/seed" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { note, progress },
  actions: {
    tidy: { label: { es: "Ordenar mis notas", en: "Tidy up my notes" }, prompt: "./agent/tasks/tidy.md", cost: "heavy" },
  },
  tagline: { es: "Notas de prueba para Human Harness", en: "Test notes for Human Harness" },
  author: "Marco Zanger",
});
