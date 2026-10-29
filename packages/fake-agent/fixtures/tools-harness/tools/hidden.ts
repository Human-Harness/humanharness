import { defineTool, z } from "@humanharness/harness-sdk/tool";

// agent: "none": never offered to the agent; only the app's UI may call it.
export default defineTool({
  description: "A tool only the app's own screens call.",
  params: z.object({}),
  returns: z.object({ hidden: z.boolean() }),
  agent: "none",
  uses: {},
  async run() {
    return { hidden: true };
  },
});
