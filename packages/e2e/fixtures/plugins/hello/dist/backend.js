// A test plugin (e2e, plugins part 1): one source that writes a record, raises an item and sets a chip.
export default {
  sources: {
    async tick(ctx) {
      await ctx.data.put("greetings", { id: "today", text: "Hello" });
      await ctx.attention.raise({ key: "hello", severity: "action", title: "Hello from a plugin" });
      await ctx.chip.set("who", { text: "Hello" });
    },
  },
};
