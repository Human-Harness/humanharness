import { defineMod } from "@humanharness/mod-sdk";
// @ts-ignore: a mod gets the app's zod; the CLI's typecheck can't resolve it from here.
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
