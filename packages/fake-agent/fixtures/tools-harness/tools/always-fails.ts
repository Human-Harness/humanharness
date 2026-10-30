import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Strict's required pre-step: it always throws, so the task never starts.
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
