import { definePlugin, z } from "@humanharness/harness-sdk";

// The demo's plugin (plugins spec §10): Wikimedia's "On this day" feed in a panel, a chip and the inbox. The manifest:
// `humanharness plugin build` turns it into dist/plugin.json; the app never runs this file.
export default definePlugin({
  id: "on-this-day",
  name: "On this day",
  version: "0.1.0",
  harness: "demo",
  permissions: { hosts: ["api.wikimedia.org"], tasks: true },
  sources: [{ id: "events", ttl: 21_600 }],
  data: {
    events: {
      key: "id",
      agent: "read",
      schema: z.object({ id: z.string(), year: z.number().int(), text: z.string(), page: z.string().optional() }),
    },
  },
  settings: {
    fields: {
      count: {
        label: "Events kept",
        help: "How many of today's events to keep. A round anniversary is looked for among these only.",
        control: "number",
        schema: z.number().int().min(5).max(50),
        default: 25,
      },
    },
  },
  panels: [{ id: "events", title: "On this day" }],
  chips: [{ id: "today" }],
  actions: [
    {
      id: "explain",
      label: "Explain this event",
      tier: "light",
      scope: "none",
      vars: z.object({ year: z.number().int(), text: z.string() }),
      prompt:
        "Explain this event from {{year}} for someone curious, in a few short paragraphs: {{text}} Say when you're unsure. Only explain: change nothing outside the app without asking.",
    },
  ],
});
