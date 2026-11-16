import { defineMod } from "@humanharness/mod-sdk";

// Runs in the app (node) when the mod is on. It only answers its own ui's calls; add hooks here
// (ctx.on.beforeSend, turnEnd, taskOpen, ...) when the mod needs them. Every registration returns a disposer the
// app runs before a reload.
export default defineMod({
  id: "__ID__",
  main(ctx) {
    ctx.ipc("hello", () => `Hello from ${ctx.id}`);
  },
});
