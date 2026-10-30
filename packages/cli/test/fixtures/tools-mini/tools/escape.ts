import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Reports which Node and network globals it can see. Read off globalThis: in a bundle, esbuild turns a bare `require`
// into its own shim.
export default defineTool({
  description: "Reports whether process, require, fetch and Buffer exist where the tools run.",
  params: z.object({}),
  returns: z.object({ process: z.string(), require: z.string(), fetch: z.string(), Buffer: z.string() }),
  agent: "none",
  uses: {},
  async run() {
    const g = globalThis as { process?: unknown; require?: unknown; fetch?: unknown; Buffer?: unknown };
    return { process: typeof g.process, require: typeof g.require, fetch: typeof g.fetch, Buffer: typeof g.Buffer };
  },
});
