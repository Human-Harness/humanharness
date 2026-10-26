// Test fixture for task modes: a tiny coach whose Study task works in one of three modes, and a Quiz with none.
import { z } from "zod";
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "coach",
  name: "Coach",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Coach" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light", modes: ["socratic", "feynman", "worked"], defaultMode: "recommend" },
    quiz: { label: "Quiz", prompt: "./agent/tasks/quiz.md", cost: "light" },
  },
  path: ["study", "quiz"],
  modes: {
    socratic: {
      label: "Socratic",
      description: "Questions that lead you to the idea.",
      brief: "./agent/modes/socratic.md",
      recommend: "Good when the topic has one key idea to discover.",
      settings: {
        questions: {
          schema: z.enum(["few", "many"]),
          default: "few",
          control: "segmented",
          label: "Questions",
          options: { few: "Few", many: "Many" },
          agent: "Ask {{value}} questions before explaining.",
        },
      },
    },
    feynman: { label: "Feynman", description: "You explain it back in plain words.", brief: "./agent/modes/feynman.md" },
    worked: { label: "Worked examples", description: "See it solved, then try one.", brief: "./agent/modes/worked.md", minTier: "deep" },
  },
  // Mode settings are drawn in the harness's Settings tab: it needs one, even with no field of its own.
  settings: { tab: "How I learn", fields: {} },
  author: "Human Harness tests",
});
