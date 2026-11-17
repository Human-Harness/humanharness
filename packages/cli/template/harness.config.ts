// The manifest: everything the core needs to know about this harness.
// `corepack pnpm check` validates it together with HARNESS.md; the /new-harness guide edits it phase by phase.
// `z` is zod: the schemas of blocks, data and settings the guide adds are written with it.
import { defineHarness, z } from "@humanharness/cli/sdk";

export default defineHarness({
  // Stable id: lowercase letters, digits and dashes. It names the app's data folder.
  id: "example-harness",
  // The app's name, in English. Never a provider or model brand.
  name: "example-harness",
  // How the app's screens should sound when it translates them for the person, in English. Optional.
  tone: "warm and plain, short sentences",
  // The core version this harness is written for.
  core: "^0.1.0",
  // Engines this harness is tested with. People only see the ones whose terms allow this use.
  engines: ["claude", "codex"],
  // Where the person's work lives, relative to their home folder.
  folder: { suggested: "Documents/example-harness" },
  // This harness's instructions to the AI, in English. The core appends its own section (language rule, tools, folders).
  instructions: "./agent/AGENTS.md",
  // What the AI may do: change files in the folder ("folder") or nothing ("none"), run commands, use the web.
  permissions: { edit: "none", exec: false, web: false },
  // Mods this harness turns on, by id: its own in mods/<id>/, or a core mod. Each value is that mod's config.
  // layouts/main.json places their blocks.
  mods: { example: {} },
  // Blocks the AI shows by calling a tool (show_<name>), by name. The core adds `choices` and `save_note` to every harness.
  blocks: {},
  // Code the AI (or a task's pre-steps) can call instead of doing mechanical work by hand. Each one is a file in tools/ with fixtures in tools/<id>/fixtures/.
  tools: { "word-count": "./tools/word-count.ts" },
  // Tasks the person can start. Each one runs in its own engine session and ends with a note.
  actions: {
    example: {
      label: "Example",
      description: "Shows how a task works.",
      // The brief: the first message of the task's session. Write it in English; the AI answers in the person's language.
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
