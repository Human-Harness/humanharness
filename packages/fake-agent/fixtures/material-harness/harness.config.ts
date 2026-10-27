// Test fixture for material processing: a reader. Each student adds their own chapters to a topic; fragments link to
// the topic's concepts.
import { z } from "zod";
import { PROFILE_COLORS, defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "reader",
  name: "Reader",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Reader" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light" },
  },
  path: ["study"],
  scopes: { label: "topic", plural: "topics" },
  data: {
    profile: {
      scoped: false,
      single: true,
      schema: z.object({ name: z.string().min(1).max(40), color: z.enum(PROFILE_COLORS).optional() }),
      agent: "read",
    },
    concepts: {
      scoped: true,
      key: "id",
      schema: z.object({ id: z.string(), name: z.string().min(1).max(80) }),
      agent: "write",
      context: { fields: ["id", "name"], tokens: 200 },
    },
  },
  profiles: { label: "student", fields: ["name", "color"] },
  material: {
    sheet: { sections: [{ id: "terms", label: "Terms", prompt: "The key terms and what each means, one line each." }], maxTokens: 800 },
    items: { collection: "concepts", label: "name" },
    budget: { indexTokens: 600 },
  },
  author: "Human Harness tests",
});
