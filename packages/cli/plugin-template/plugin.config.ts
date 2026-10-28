import { definePlugin, z } from "@humanharness/harness-sdk";

// The manifest. `humanharness plugin build` turns it into dist/plugin.json; the app never runs this file.
export default definePlugin({
  id: "__ID__",
  name: "__NAME__",
  version: "0.1.0",
  harness: "__HARNESS__",
  permissions: { hosts: ["api.example.com"], tasks: true },
  sources: [{ id: "items", ttl: 900 }],
  data: {
    items: { key: "id", agent: "read", schema: z.object({ id: z.string(), title: z.string() }) },
  },
  panels: [{ id: "main", title: "Items" }],
  chips: [{ id: "count" }],
  actions: [
    {
      id: "summarize",
      label: "Summarize",
      tier: "light",
      scope: "none",
      vars: z.object({ id: z.string() }),
      prompt: "Summarize item {{id}} in two sentences. Only read: change nothing outside the app without asking.",
    },
  ],
});
