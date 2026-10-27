// Test fixture for task phases: a tutor whose Session task has three parts and a time box, and a Quiz with none.
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
    session: {
      label: "Session",
      prompt: "./agent/tasks/session.md",
      cost: "light",
      modes: ["socratic", "feynman"],
      defaultMode: "socratic",
      phases: [
        { id: "warmup", label: "Warm-up", brief: "./agent/phases/warmup.md", auto: true, modes: "none" },
        { id: "main", label: "Main block", brief: "./agent/phases/main.md" },
        { id: "close", label: "Close", brief: "./agent/phases/close.md", close: true, modes: "none" },
      ],
      timeBox: { options: [15, 30, 45], default: null, wrapUpAt: 0.85 },
    },
    quiz: { label: "Quiz", prompt: "./agent/tasks/quiz.md", cost: "light" },
  },
  path: ["session", "quiz"],
  modes: {
    socratic: { label: "Socratic", description: "Questions that lead you to the idea.", brief: "./agent/modes/socratic.md" },
    feynman: { label: "Feynman", description: "You explain it back in plain words.", brief: "./agent/modes/feynman.md" },
  },
  author: "Human Harness tests",
});
