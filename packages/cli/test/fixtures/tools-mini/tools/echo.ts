import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Returns its args, as the registry parsed them.
export default defineTool({
  description: "Returns its arguments.",
  params: z.object({ a: z.number() }),
  returns: z.object({ a: z.number() }),
  agent: "call",
  uses: {},
  async run(args) {
    return { a: args.a };
  },
});
