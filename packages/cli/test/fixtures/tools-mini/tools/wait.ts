import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Never ends: its 1 s timeout fails it.
export default defineTool({
  description: "Waits forever.",
  params: z.object({}),
  agent: "none",
  uses: {},
  timeout: 1,
  async run() {
    await new Promise(() => undefined);
    return null;
  },
});
