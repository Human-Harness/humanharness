// Test fixture for harness settings: a tiny tutor whose person picks a tone, a hint threshold and more.
import { z } from "zod";
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Tutor" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    practice: { label: "Practice", prompt: "./agent/tasks/practice.md", cost: "light" },
    review: { label: "Review", prompt: "./agent/tasks/review.md", cost: "light" },
  },
  path: ["practice", "review"],
  settings: {
    tab: "How I learn",
    sections: [
      { id: "voice", label: "How the AI talks" },
      { id: "help", label: "Help" },
    ],
    fields: {
      nickname: { schema: z.string().max(40), default: "", control: "text", label: "What the app calls you", help: "Only the app's screens use it." },
      tone: {
        schema: z.enum(["patient", "neutral", "demanding"]),
        default: "patient",
        section: "voice",
        control: "segmented",
        label: "Tone",
        options: { patient: "Patient", neutral: "Neutral", demanding: "Demanding" },
        agent: "Use a {{value:label}} tone.",
      },
      examples: {
        schema: z.boolean(),
        default: true,
        section: "help",
        control: "toggle",
        label: "Show worked examples",
        agent: { text: "Do not show worked examples.", onlyWhenChanged: true },
      },
      hintAfter: {
        schema: z.number().int().min(1).max(5),
        default: 2,
        section: "help",
        control: "number",
        label: "Hint after",
        unit: "tries",
        agent: "Give a hint after {{value}} failed tries, not before.",
        advanced: true,
      },
    },
  },
  author: "Human Harness tests",
});
