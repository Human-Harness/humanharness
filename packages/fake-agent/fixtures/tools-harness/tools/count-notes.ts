import { defineTool, z } from "@humanharness/harness-sdk/tool";

// Reads the folder (uses.files "read"): how many markdown notes each folder holds.
export default defineTool({
  description: "Counts the person's markdown notes in each folder of their work folder.",
  params: z.object({}),
  returns: z.array(z.object({ folder: z.string(), notes: z.number().int() })),
  uses: { files: "read" },
  async run(_args, ctx) {
    const counts = new Map<string, number>();
    for (const p of await ctx.files.list("", "**/*.md")) {
      const cut = p.lastIndexOf("/");
      const folder = cut < 0 ? "." : p.slice(0, cut);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([folder, notes]) => ({ folder, notes }));
  },
});
