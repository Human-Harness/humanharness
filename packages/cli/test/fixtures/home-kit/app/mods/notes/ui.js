import { defineMod } from "@humanharness/mod-sdk";

export default defineMod({
  id: "notes",
  ui(ctx) {
    ctx.block("notes", () => null);
    ctx.block("note-count", () => null);
  },
});
