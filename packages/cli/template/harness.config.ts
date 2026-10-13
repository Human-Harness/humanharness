// The manifest: everything the core needs to know about this harness.
// `corepack pnpm check` validates it together with HARNESS.md; the /new-harness guide edits it phase by phase.
import { defineBlock, defineHarness, z } from "@humanharness/cli/sdk";

// A custom block: a piece of UI the AI shows by calling a tool (`show_example_card`).
// The schema bounds what the AI may send, and the example must match it. Its component is ui/ExampleCard.tsx.
const exampleCard = defineBlock({
  description: "Shows one idea as a card: a short title and a body of one or two sentences. Use it once per answer, for the main idea.",
  visible: true,
  schema: z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(400) }),
  example: { title: "One idea", body: "A short explanation of why it matters." },
});

export default defineHarness({
  // Stable id: lowercase letters, digits and dashes. It names the app's data folder.
  id: "example-harness",
  // The app's name in each language. Never a provider or model brand.
  name: { es: "example-harness", en: "example-harness" },
  // The core version this harness is written for.
  core: "^0.1.0",
  // Languages of the screens and of the AI's answers.
  languages: ["es", "en"],
  // Engines this harness is tested with. People only see the ones whose terms allow this use.
  engines: ["claude", "codex"],
  // Where the person's work lives, relative to their home folder.
  folder: { suggested: "Documents/example-harness" },
  // This harness's instructions to the AI. The core appends its own section (language, tools, folders).
  instructions: "./agent/AGENTS.md",
  // What the AI may do: change files in the folder ("folder") or nothing ("none"), run commands, use the web.
  permissions: { edit: "none", exec: false, web: false },
  // Custom blocks, by name. The core adds `choices` and `save_note` to every harness.
  blocks: { example_card: exampleCard },
  // Tasks the person can start. Each one runs in its own engine session and ends with a note.
  actions: {
    example: {
      label: { es: "Ejemplo", en: "Example" },
      description: { es: "Muestra cómo funciona una tarea.", en: "Shows how a task works." },
      // The brief: the first message of the task's session.
      prompt: "./agent/tasks/example.md",
      // How much of the person's plan it tends to use: light, medium or heavy.
      cost: "light",
      // How much model it needs: light, standard or deep.
      tier: "standard",
    },
  },
  // Free questions (anything that isn't an action) run at this tier.
  questions: { tier: "light" },
  // Who made it (Settings → About).
  author: "Your name",
});
