import { defineMod } from "@humanharness/mod-sdk";

// Runs in the app (node) when the mod is on. Register hooks here (ctx.on.beforeSend, ctx.on.turnEnd, ...);
// each registration returns a disposer the app runs before a reload.
export default defineMod({
  id: "__ID__",
  main(ctx) {
    ctx.log("started");
  },
});
