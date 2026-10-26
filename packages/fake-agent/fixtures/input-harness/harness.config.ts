// Test fixture for input blocks: a tiny practice harness that asks the person to commit to an answer.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const card = defineBlock({
  description: "Shows a card with a title to the person.",
  visible: true,
  schema: z.object({ title: z.string().min(1).max(80) }),
  example: { title: "Card" },
});

const commit_answer = defineBlock({
  description: "Asks the person to commit to an answer before you explain: a question, up to 4 options, and why.",
  visible: true,
  schema: z.object({ question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(120)).max(4).optional() }),
  input: z.object({ choice: z.string().max(120).optional(), why: z.string().min(1).max(1000) }),
  inputUi: { choice: { label: { es: "Elegí", en: "I pick" } }, why: { label: { es: "¿Por qué? Con tus palabras", en: "Why? In your own words" } } },
  submitLabel: { es: "Me comprometo", en: "I commit" },
  example: { question: "¿Quién comió más?", options: ["Yo", "Mi amiga", "Las dos igual"] },
});

const summary = defineBlock({
  description: "Asks the person to sum the topic up in their own words and to write flashcards.",
  visible: true,
  schema: z.object({ prompt: z.string().min(1).max(300) }),
  input: z.object({
    summary: z.string().min(1).max(2000),
    cards: z.array(z.object({ front: z.string().min(1).max(200), back: z.string().min(1).max(200) })).max(20),
  }),
  inputUi: { cards: { columns: { front: { es: "Frente", en: "Front" }, back: { es: "Dorso", en: "Back" } } } },
  skippable: true,
  // Spec §9's flashcards: one record per card.
  saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, front: c.front, back: c.back })) },
  example: { prompt: "Resumí el tema con tus palabras." },
});

export default defineHarness({
  id: "quiz",
  name: { es: "Quiz", en: "Quiz" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Quiz" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: { card, commit_answer, summary },
  actions: { practice: { label: { es: "Practicar", en: "Practice" }, prompt: "./agent/tasks/practice.md", cost: "light" } },
  path: ["practice"],
  data: {
    flashcards: { scoped: true, key: "id", schema: z.object({ id: z.string().min(1), front: z.string().min(1), back: z.string().min(1) }), agent: "read" },
  },
  author: "Human Harness tests",
});
