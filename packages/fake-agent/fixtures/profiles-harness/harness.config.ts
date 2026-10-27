// Test fixture for profiles: a family tutor. Each student has a name, a colour and an age band, a goal set up once,
// and a tone of their own.
import { z } from "zod";
import { PROFILE_COLORS, defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "family",
  name: "Family Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Family" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    practice: { label: "Practice", prompt: "./agent/tasks/practice.md", cost: "light" },
  },
  path: ["practice"],
  data: {
    profile: {
      scoped: false,
      single: true,
      schema: z.object({
        name: z.string().min(1).max(40),
        color: z.enum(PROFILE_COLORS).optional(),
        ageBand: z.enum(["6-9", "10-12", "13-17", "adult"]).optional(),
      }),
      agent: "read",
      context: { fields: "all", tokens: 100 },
    },
    goal: {
      scoped: false,
      single: true,
      schema: z.object({ text: z.string().min(1).max(200) }),
      agent: "read",
      context: { fields: "all", tokens: 100 },
    },
  },
  profiles: { label: "student", fields: ["name", "color", "ageBand"] },
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
  setup: [{ id: "goal", kind: "form", label: "Your goal", collection: "goal", fields: ["text"], required: true }],
  author: "Human Harness tests",
});
