import { definePluginBackend } from "@humanharness/harness-sdk/plugin-backend";

type Item = { id: string; title: string };

// The sources: one function per source in plugin.config.ts. Everything goes through ctx; there is no network of its own.
export default definePluginBackend({
  sources: {
    async items(ctx) {
      const res = await ctx.fetch("https://api.example.com/items");
      if (!res.ok) throw new Error(`api.example.com answered ${res.status}`);
      const items: Item[] = (res.json() as Item[]).map((item) => ({ id: String(item.id), title: String(item.title) }));
      await ctx.data.replaceAll("items", items);
      await ctx.chip.set("count", { text: `${items.length} items` });
    },
  },
});
