import { defineTool, z } from "@humanharness/cli/tool";

/** An example tool: replace it with your own (the guide's Mechanical work phase). */
export default defineTool({
  description: "Counts the words of a text file in the person's folder. Use it instead of counting by hand.",
  params: z.object({ path: z.string().min(1) }),
  returns: z.object({ path: z.string(), words: z.number().int() }),
  agent: "call",
  uses: { files: "read" },
  run: async ({ path }, ctx) => {
    const text = await ctx.files.read(path);
    const words = text.split(/\s+/).filter(Boolean).length;
    return { path, words };
  },
});
