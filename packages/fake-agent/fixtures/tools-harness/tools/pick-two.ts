import { defineTool, z } from "@humanharness/harness-sdk/tool";

// A pre-step that reads an earlier step's result (`input: ["today"]`): the first two of `ctx.inputs.today`.
export default defineTool({
  description: "Picks the first two items due today as a warm-up.",
  params: z.object({}),
  returns: z.array(z.object({ id: z.string(), title: z.string() })),
  agent: "none",
  uses: {},
  async run(_args, ctx) {
    const today = ctx.inputs.today;
    return Array.isArray(today) ? today.slice(0, 2) : [];
  },
});
