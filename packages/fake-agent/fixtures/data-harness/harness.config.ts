// Test fixture for scopes and harness data: a tiny study harness with topics and an app-wide welcome.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const card = defineBlock({
  description: "Shows a card with a title to the person.",
  visible: true,
  schema: z.object({ title: z.string().min(1) }),
  example: { title: "Card" },
});

export default defineHarness({
  id: "study",
  name: { es: "Estudio", en: "Study" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Study" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { card },
  scopes: { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } },
  actions: {
    study: { label: { es: "Estudiar", en: "Study" }, prompt: "./agent/tasks/study.md", cost: "light" },
    onboarding: { label: { es: "Bienvenida", en: "Welcome" }, prompt: "./agent/tasks/onboarding.md", cost: "light", scope: "none" },
  },
  path: ["study"],
  author: "Human Harness tests",
});
