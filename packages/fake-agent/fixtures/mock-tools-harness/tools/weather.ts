import { defineTool, z } from "@humanharness/harness-sdk/tool";

// One fetch with the key in a header (tools spec §9). In mock mode the key is `fixture-weather` and the reply comes from
// mock/tools/weather/; api.weather.test is never asked.
export default defineTool({
  description: "Tells the sky over a city today.",
  params: z.object({ city: z.string() }),
  returns: z.object({ city: z.string(), sky: z.string() }),
  agent: "call",
  uses: { hosts: ["api.weather.test"], secrets: ["weather"] },
  async run({ city }, ctx) {
    const res = await ctx.fetch(`https://api.weather.test/v1/${city}`, { headers: { authorization: "Bearer {{secret:weather}}" } });
    return (await res.json()) as { city: string; sky: string };
  },
});
