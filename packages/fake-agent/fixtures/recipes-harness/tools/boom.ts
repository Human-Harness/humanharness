import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Broken's one step: it always throws, so the run fails.
export default defineTool({
  description: "Always fails.",
  params: z.object({}),
  returns: z.object({ ok: z.boolean() }),
  agent: "none",
  uses: {},
  async run() {
    throw new Error("boom");
  },
});
