import { defineMod } from "@humanharness/mod-sdk";

export default defineMod({
  id: "notes",
  main(ctx) {
    ctx.on.beforeSend(() => ({ ok: true }));
    ctx.on.taskOpen(() => undefined);
  },
});
