// Test fixture for document reviews: the agent edits the folder; a ticket's spec part ends when specs/*.md is approved.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "reviewer",
  name: "Reviewer",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Reviewer" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  documents: { kinds: { spec: { when: "A feature's spec.", sections: ["Scope"], reviewTier: "standard" } } },
  actions: {
    ticket: {
      label: "Ticket",
      prompt: "./agent/tasks/ticket.md",
      cost: "light",
      phases: [
        { id: "spec", label: "Spec", brief: "./agent/phases/spec.md", approve: "specs/*.md" },
        { id: "plan", label: "Plan", brief: "./agent/phases/plan.md" },
      ],
    },
  },
  path: ["ticket"],
  author: "Human Harness tests",
});
