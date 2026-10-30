import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Declares no reach (uses {}), so its read is refused: the call fails and its accesses show "access denied".
export default defineTool({
  description: "Reads the person's notes.md without having declared any access to files.",
  params: z.object({}),
  returns: z.object({ text: z.string() }),
  agent: "call",
  uses: {},
  async run(_args, ctx) {
    return { text: await ctx.files.read("notes.md") };
  },
});
