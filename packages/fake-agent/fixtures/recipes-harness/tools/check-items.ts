import { defineTool, z } from "@humanharness/harness-sdk/tool";

// A recipe's first step: two fixed items, the first failed when `fail` is set (the AI step's `when` reads it).
export default defineTool({
  description: "Lists two items and whether each failed.",
  params: z.object({ fail: z.boolean() }),
  returns: z.array(z.object({ id: z.string(), failed: z.boolean() })),
  agent: "none",
  uses: {},
  async run({ fail }) {
    return [
      { id: "a", failed: fail },
      { id: "b", failed: false },
    ];
  },
  summary: (r) => `${r.length} items`,
});
