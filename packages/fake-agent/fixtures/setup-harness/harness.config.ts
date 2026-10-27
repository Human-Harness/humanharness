// Test fixture for setup steps: a tiny tutor that interviews the person, asks for a tone and a goal, and runs a check of its own.
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
    conocerte: { label: "Get to know you", prompt: "./agent/tasks/conocerte.md", cost: "medium", tier: "light" },
    practice: { label: "Practice", prompt: "./agent/tasks/practice.md", cost: "light" },
  },
  path: ["practice"],
  data: {
    profile: {
      scoped: false,
      single: true,
      schema: z.object({ name: z.string().min(1).max(40), goal: z.string().min(1).max(200) }),
      agent: "write",
      context: { fields: "all", tokens: 200 },
    },
  },
  settings: {
    tab: "How I learn",
    fields: {
      tone: {
        schema: z.enum(["patient", "demanding"]),
        default: "patient",
        control: "segmented",
        label: "Tone",
        options: { patient: "Patient", demanding: "Demanding" },
        agent: "Use a {{value:label}} tone.",
      },
    },
  },
  setup: [
    {
      id: "conocerte",
      kind: "interview",
      label: "Get to know you",
      description: "A short chat so the app knows who you are and what you want.",
      action: "conocerte",
      writes: "profile",
      required: true,
    },
    { id: "estilo", kind: "form", label: "How the AI talks", settings: ["tone"] },
    { id: "goal", kind: "form", label: "Your goal", collection: "profile", fields: ["goal"] },
    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep" },
  ],
  author: "Human Harness tests",
});
