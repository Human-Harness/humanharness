import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Says what ctx.summary and ctx.requestAi are, sets a summary line, then asks for an AI round (refused outside a job's post-step).
export default defineTool({
  description: "Calls ctx.summary and ctx.requestAi.",
  params: z.object({}),
  returns: z.object({ summary: z.string(), requestAi: z.string(), refused: z.string() }),
  agent: "none",
  uses: {},
  async run(_args, ctx) {
    const kinds = { summary: typeof ctx.summary, requestAi: typeof ctx.requestAi };
    await ctx.summary("one line");
    let refused = "";
    try {
      await ctx.requestAi({ more: true });
    } catch (e) {
      refused = `${(e as Error).name}: ${(e as Error).message}`;
    }
    return { ...kinds, refused };
  },
});
