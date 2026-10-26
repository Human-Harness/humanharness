import { type HarnessInput, z } from "../src";

/** Shared by the settings tests (not a test file, so importing it runs no tests). */
export const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};

export const tone = {
  schema: z.enum(["patient", "neutral", "demanding"]),
  default: "patient",
  section: "voice",
  control: "segmented" as const,
  label: "Tone",
  options: { patient: "Patient", neutral: "Neutral", demanding: "Demanding" },
  agent: "Use a {{value:label}} tone.",
};
export const hintAfter = {
  schema: z.number().int().min(1).max(5),
  default: 2,
  section: "help",
  control: "number" as const,
  label: "Hint after",
  unit: "tries",
  agent: "Give a hint after {{value}} failed tries, not before.",
  advanced: true,
};
export const examples = {
  schema: z.boolean(),
  default: true,
  section: "help",
  control: "toggle" as const,
  label: "Show worked examples",
  agent: { text: "Do not show worked examples.", onlyWhenChanged: true },
};
export const nickname = { schema: z.string().max(40), default: "", control: "text" as const, label: "What the app calls you", help: "Only the app's screens use it." };
export const declared = {
  tab: "How I learn",
  sections: [
    { id: "voice", label: "How the AI talks" },
    { id: "help", label: "Help" },
  ],
  fields: { tone, hintAfter, examples, nickname },
};
