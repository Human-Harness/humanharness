// The context panel's main side as a core mod (minimal-core step 3): the person's pins and exclusions, the panel's data
// and the writes behind it. The core keeps the per-task record and the "Add now" turn (`ctx.app.tasks`).
import { defineMod } from "@humanharness/mod-sdk";
import type { CoreContextItem, CoreMainCtx } from "@humanharness/mod-sdk/core";
import type { HistoryTrailer } from "@humanharness/workspace";
import { CONTEXT_CHANNELS, contextHandlers } from "./ipc";
import { type ContextDeps, type ContextRecord, ContextService } from "./service";

/** The service's deps, from the app's parts: the folder, the scopes, the history and the dialog are the core's. */
export function contextDeps(ctx: CoreMainCtx, changed: (taskId: string) => void): ContextDeps {
  const app = ctx.app;
  return {
    base: async () => (await app.setup())?.base ?? null,
    scoped: () => app.context.scoped(),
    scopeExists: (id) => app.context.scopeExists(id),
    budget: () => app.context.budget(),
    record: async (id) => (await app.tasks.contextRecord(id)) as unknown as ContextRecord | null,
    openTask: async () => (await app.task())?.id ?? null,
    noteTitles: (scope) => app.context.noteTitles(scope),
    history: () => app.context.history() as ReturnType<ContextDeps["history"]>,
    trailer: async () => (await app.context.trailer()) as HistoryTrailer | undefined,
    blocked: () => app.context.blocked(),
    add: (taskId, file) => {
      const { accepted, done } = app.tasks.addContext(taskId, file);
      // Closing ends the operation before it runs: not a failure worth a log line.
      done.catch((err: unknown) => {
        if (!app.context.blocked()) ctx.log("The Add now turn failed", err);
      });
      return accepted as ReturnType<ContextDeps["add"]>;
    },
    pickFile: (base) => app.context.pickFile(base),
    changed,
  };
}

/** The task's panel refreshes (`hh:context`); a task that is no longer open sends nothing. */
async function send(ctx: CoreMainCtx, svc: ContextService, task: string): Promise<void> {
  const got = await svc.get(task).catch(() => null);
  if (got?.ok) ctx.push("hh:context", { task, context: got.context });
}

export default defineMod({
  id: "context-panel",
  main(base) {
    const ctx = base as unknown as CoreMainCtx;
    if (!ctx.app) return;
    const svc = new ContextService(contextDeps(ctx, (task) => void send(ctx, svc, task)));
    // The window's seven calls, under the names it already uses.
    const handlers = contextHandlers(svc);
    for (const channel of CONTEXT_CHANNELS) ctx.handle(channel, handlers[channel]);
    // A task's record changed (its start, reads or compaction): its panel refreshes.
    ctx.app.tasks.onContextChanged((task) => send(ctx, svc, task));
    // The pins' slot in a first or resume message: the pinned section, one item per pin, the notes left out.
    ctx.on.firstMessage(async (task) => {
      const person = await svc.personContext(task.scope).catch((err: unknown) => {
        console.error("Could not load the pins and exclusions for the task", err);
        return null;
      });
      if (!person) return null;
      return {
        text: person.pinned,
        items: person.items as unknown as readonly CoreContextItem[],
        // The layout already holds the pinned text to the budget; the host's cut must never bite (the section is as it was).
        budgetTokens: Math.max(1, Math.ceil(person.pinned.length / 4)),
        excludeNotes: [...person.excluded],
      };
    });
  },
});
