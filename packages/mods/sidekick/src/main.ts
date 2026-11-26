// Sidekick's main side as a core mod (minimal-core 1a): the controller behind the mod's 26 own channels
// (`mods.sidekick.<name>`) and its `state` sends to its ui, driven by the mod hooks. On only for a harness with `mods.sidekick`.
import { defineMod } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { SidekickController } from "./controller";
import { sidekickDeps } from "./deps";
import { registerSidekickIpc } from "./ipc";
import { type SidekickManifest, sidekickSchema } from "./schema";

/** Runs `work` without holding the hook (the host's limit is 5 s; a model turn takes longer); errors are logged. */
const detached = (ctx: CoreMainCtx, work: () => Promise<unknown>) => void work().catch((err: unknown) => ctx.log("Sidekick", err));

export default defineMod({
  id: "sidekick",
  main(base) {
    const ctx = base as unknown as CoreMainCtx;
    const key = ctx.app?.harness.sidekick;
    // Sidekick runs only for a harness that declares it: without `mods.sidekick` there is no controller.
    if (!key) return;
    const ctl = new SidekickController(sidekickDeps(ctx, sidekickSchema.parse(key) as SidekickManifest));
    // The mod's ui sends each call's arguments as an array (ui/api.ts); anything else is a call with none.
    registerSidekickIpc((channel, fn) => void ctx.ipc(channel, (args) => fn(...((Array.isArray(args) ? args : []) as never[]))), () => ctl);
    // The mod's ui reviews a send itself (its composer reviewer calls `review`): holding here too would review twice.
    ctx.on.beforeSend(() => ({ kind: "pass" }));
    ctx.on.turnStart(() => ctl.turnStarting());
    // A mod's turn end is a person's turn (`run`) unless the app says otherwise.
    ctx.on.turnEnd((end) => detached(ctx, () => ctl.afterReply({ ...end, kind: (end as { kind?: string }).kind ?? "run" })));
    ctx.on.taskOpen(() => detached(ctx, () => ctl.refresh()));
    ctx.on.taskClose(() => detached(ctx, () => ctl.refresh()));
    // A profile switch or an undo: the settings and the base may have changed under the controller.
    ctx.onRefresh?.(() => detached(ctx, () => ctl.refresh()));
    ctx.on.betweenTasks(() => ctl.betweenTasks());
    ctx.on.phaseMoved((e) => detached(ctx, () => ctl.phaseMoved(e)));
    ctx.on.daily(() => detached(ctx, () => ctl.daily()));
    ctx.on.close(() => ctl.close());
  },
});
