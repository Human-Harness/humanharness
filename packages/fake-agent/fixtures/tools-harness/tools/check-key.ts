import { defineTool, z } from "@humanharness/harness-sdk/tool";

// The connect step's Test (tools spec §9). The key reaches only the declared fetch, as {{secret:demo}}. The tests press
// Test only without a key, which fails before any request: api.example.invalid is never asked.
export default defineTool({
  description: "Checks that the demo key works.",
  params: z.object({}),
  returns: z.object({ ok: z.boolean() }),
  agent: "none",
  uses: { secrets: ["demo"], hosts: ["api.example.invalid"] },
  async run(_args, ctx) {
    const res = await ctx.fetch("https://api.example.invalid/me", { headers: { authorization: "Bearer {{secret:demo}}" } });
    return { ok: res.ok };
  },
});
