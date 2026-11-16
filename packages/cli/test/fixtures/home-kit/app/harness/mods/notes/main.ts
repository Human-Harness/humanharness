import { defineMod } from "@humanharness/mod-sdk";
import { z } from "zod";

export default defineMod({
  id: "notes",
  schema: z.object({ folder: z.string().default("notes"), keep: z.number().default(10) }),
  main(ctx) {
    ctx.on.turnEnd(() => undefined);
    ctx.on.taskOpen(() => undefined);
    ctx.ipc("list", () => []);
  },
});
