// Sidekick's main side as a core mod (minimal-core 1a): the controller behind the 26 app channels (`hh:sidekick…`)
// and the `hh:sidekick` push, driven by the mod hooks. On only for a harness with a `sidekick` key.
import { defineMod } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { SidekickController } from "./controller";
import { sidekickDeps } from "./deps";
import { registerSidekickIpc } from "./ipc";
import { type SidekickManifest, sidekickSchema } from "./manifest";

/** Runs `work` without holding the hook (the host's limit is 5 s; a model turn takes longer); errors are logged. */
const detached = (ctx: CoreMainCtx, work: () => Promise<unknown>) => void work().catch((err: unknown) => ctx.log("Sidekick", err));

export default defineMod({
  id: "sidekick",
  main(base) {
    const ctx = base as unknown as CoreMainCtx;
    const key = ctx.app?.harness.sidekick;
    // Sidekick runs only for a harness that declares it: without the key there is no controller.
    if (!key) return;
    const ctl = new SidekickController(sidekickDeps(ctx, sidekickSchema.parse(key) as SidekickManifest));
    // The window's calls keep their channel names; the host hands a core mod their arguments as an array.
    registerSidekickIpc((channel, fn) => void ctx.ipc(channel, (args) => fn(...((Array.isArray(args) ? args : [args]) as never[]))), () => ctl);
    // The window still reviews a send itself (hh:sidekickReview) until the UI moves: holding here too would review twice.
    ctx.on.beforeSend(() => ({ kind: "pass" }));
    ctx.on.turnStart(() => ctl.turnStarting());
    // A mod's turn end is a person's turn (`run`) unless the app says otherwise.
    ctx.on.turnEnd((end) => detached(ctx, () => ctl.afterReply({ ...end, kind: (end as { kind?: string }).kind ?? "run" })));
    ctx.on.taskOpen(() => detached(ctx, () => ctl.refresh()));
    ctx.on.taskClose(() => detached(ctx, () => ctl.refresh()));
    ctx.on.betweenTasks(() => ctl.betweenTasks());
    ctx.on.phaseMoved((e) => detached(ctx, () => ctl.phaseMoved(e)));
    ctx.on.daily(() => detached(ctx, () => ctl.daily()));
    ctx.on.close(() => ctl.close());
  },
});
