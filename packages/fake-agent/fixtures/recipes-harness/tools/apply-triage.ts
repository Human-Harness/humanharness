import { defineTool, z } from "@humanharness/harness-sdk/tool";

// The post-step (the step right after the AI step): applies the AI step's triage, asks for another AI round when the
// triage says `again`, and sets the run's summary.
export default defineTool({
  description: "Applies the AI step's triage.",
  params: z.object({}),
  returns: z.object({ applied: z.number() }),
  agent: "none",
  uses: {},
  async run(_args, ctx) {
    const triage = ctx.inputs.triage as { ids: string[]; again: boolean };
    if (triage.again) await ctx.requestAi({ ids: triage.ids });
    await ctx.summary(`Triaged ${triage.ids.length}`);
    return { applied: triage.ids.length };
  },
});
