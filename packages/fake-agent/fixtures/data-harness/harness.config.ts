// Test fixture for scopes and harness data: a tiny study harness with topics and an app-wide welcome.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const card = defineBlock({
  description: "Shows a card with a title to the person.",
  visible: true,
  schema: z.object({ title: z.string().min(1) }),
  example: { title: "Card" },
});

const LEVELS = ["unseen", "seen", "practising", "mastered"];
const concept = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["unseen", "seen", "practising", "mastered"]),
  evidence: z.array(z.object({ kind: z.string(), date: z.string(), detail: z.string() })),
});

export default defineHarness({
  id: "study",
  name: "Study",
  core: "^0.1.0",
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Study" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { card },
  scopes: { label: "topic", plural: "topics" },
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light" },
    onboarding: { label: "Welcome", prompt: "./agent/tasks/onboarding.md", cost: "light", scope: "none" },
  },
  path: ["study"],
  data: {
    concepts: {
      scoped: true,
      key: "id",
      schema: concept,
      agent: "write",
      context: { fields: ["id", "name", "state"], tokens: 400 },
      // The student example (spec §4.3): the state rises only with a new evidence entry.
      rules: (next, prev) => {
        if (!next || !prev) return true;
        const rises = LEVELS.indexOf(String(next.state)) > LEVELS.indexOf(String(prev.state));
        const more = (next.evidence as unknown[]).length > (prev.evidence as unknown[]).length;
        return !rises || more ? true : "The state can rise only with a new evidence entry";
      },
    },
    flashcards: { scoped: true, key: "id", schema: z.object({ id: z.string(), front: z.string(), back: z.string() }), agent: "read" },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string(), level: z.string() }), agent: "read", context: { fields: "all", tokens: 300 } },
    secrets: { scoped: false, key: "id", schema: z.object({ id: z.string(), note: z.string() }), agent: "none" },
  },
  author: "Human Harness tests",
});
