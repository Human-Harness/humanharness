import { defineMod } from "@humanharness/mod-sdk";

export default defineMod({
  id: "home",
  ui(ctx) {
    ctx.block("home", () => null);
  },
});
