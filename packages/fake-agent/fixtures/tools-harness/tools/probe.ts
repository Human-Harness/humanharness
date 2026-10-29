import { defineTool, z } from "@humanharness/harness-sdk/tool";

// The sandbox has no Node (tools spec D2, T1): both read "undefined" there. Read off globalThis: in a bundle, esbuild turns
// a bare `require` into its own shim (a function that throws "Dynamic require … is not supported").
export default defineTool({
  description: "Reports whether Node's require and process exist where the tools run.",
  params: z.object({}),
  returns: z.object({ require: z.string(), process: z.string() }),
  agent: "call",
  uses: {},
  async run() {
    const global = globalThis as { require?: unknown; process?: unknown };
    return { require: typeof global.require, process: typeof global.process };
  },
});
