import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Fetches the declared host with the key in a header; `url` lets a test ask an undeclared one.
export default defineTool({
  description: "Fetches api.example.test with the API key.",
  params: z.object({ url: z.string().optional() }),
  returns: z.object({ status: z.number(), text: z.string() }),
  agent: "call",
  uses: { hosts: ["api.example.test"], secrets: ["api"] },
  async run(args, ctx) {
    const res = await ctx.fetch(args.url ?? "https://api.example.test/x", { headers: { authorization: "Bearer {{secret:api}}" } });
    return { status: res.status, text: res.text() };
  },
});
