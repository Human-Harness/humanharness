import { defineTool, z } from "@humanharness/harness-sdk/tool";

// A pre-step of Study (tools spec slice 3): three fixed items, no reach. agent: "none" keeps the agent's catalogue as
// slice 2's e2e pins it.
export default defineTool({
  description: "Lists what is due today.",
  params: z.object({}),
  returns: z.array(z.object({ id: z.string(), title: z.string() })),
  agent: "none",
  uses: {},
  async run() {
    return [
      { id: "a", title: "Fractions" },
      { id: "b", title: "Decimals" },
      { id: "c", title: "Percentages" },
    ];
  },
});
