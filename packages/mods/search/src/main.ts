// Global search's main side as a core mod (minimal-core step 3): the index, its worker and the two calls the palette
// makes. The core keeps only what the index reads of the app (`ctx.app.search`) and the events it hears.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Collection } from "@humanharness/harness-sdk";
import { defineMod } from "@humanharness/mod-sdk";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { type SearchDoc, actionDocs, openTaskDoc, pastTaskDocs } from "@humanharness/search";
import type { DataStore } from "@humanharness/workspace";
import { type PluginSearch, searchData, searchableCollection } from "./data-sources";
import { searchHandlers } from "./ipc";
import { workerBuild } from "./runner";
import { SearchService } from "./service";

/** The build's worker thread, beside this file once the app is built (the core-mod build emits `src/worker.ts` as `worker.js`). */
function workerEntry(): string | undefined {
  const file = fileURLToPath(new URL("./worker.js", import.meta.url));
  return existsSync(file) ? file : undefined;
}

/** Actions, the open task and past tasks as documents (search spec §4.2), from what the core reads of its tasks. */
async function memory(ctx: CoreMainCtx): Promise<SearchDoc[]> {
  const t = await ctx.app.search.tasks();
  return [
    ...actionDocs(t.actions.map((a) => ({ id: a.id, label: a.label, ...(a.description ? { description: a.description } : {}), ...(a.tier ? { tier: a.tier } : {}), ...(a.status ? { status: a.status } : {}), scope: a.scope }) as Parameters<typeof actionDocs>[0][number])),
    ...(t.open ? [openTaskDoc({ id: t.open.id, title: t.open.title, scope: t.open.scope, at: 0 })] : []),
    ...pastTaskDocs(t.past),
  ];
}

/** The search service, built from the app's parts. Nothing is read, written or started until the window first asks (D0, D8). */
export function searchService(ctx: CoreMainCtx): SearchService {
  const { app } = ctx;
  const s = app.search;
  const entry = workerEntry();
  return new SearchService({
    userData: () => s.userData(),
    base: async () => (await app.setup())?.base ?? null,
    scoped: () => app.context.scoped(),
    openScope: () => s.openScope(),
    scopeTitles: () => s.scopeTitles(),
    references: () => s.references(),
    memory: () => memory(ctx),
    extraDenied: () => s.extraDenied(),
    status: (st) => ctx.push("hh:searchStatus", st),
    runner: workerBuild(entry ? { entry } : {}),
    reveal: (file, roots) => s.reveal(file, roots),
    data: searchData({
      current: async () => (await app.setup())?.base ?? null,
      collections: () => s.collections() as Record<string, Collection>,
      scoped: () => app.context.scoped(),
      scopes: (base) => s.scopes(base),
      store: (base) => s.store(base) as Pick<DataStore, "readAll" | "changedAt">,
      plugins: () => (s.plugins() as PluginSearch | null) ?? null,
    }),
    // A burst of writes (an import, a plugin run) is one refresh.
    dataDelayMs: 500,
  });
}

export default defineMod({
  id: "search",
  main(base) {
    const ctx = base as unknown as CoreMainCtx;
    if (!ctx.app) return;
    const svc = searchService(ctx);
    // The window's two calls, under their app channel names.
    const handlers = searchHandlers(svc);
    for (const name of Object.keys(handlers) as (keyof typeof handlers)[]) ctx.handle(name, (...args) => handlers[name](...args));
    // The core's events: a write to a searchable collection (a plugin's data or on/off state always counts), a restore
    // (null: the whole folder), a base that is gone, and the app closing.
    ctx.on.dataChanged(({ collection }) => {
      if (collection === null || searchableCollection(ctx.app.search.collections() as Record<string, Collection>, collection)) svc.dataChanged();
    });
    ctx.on.restored((paths) => svc.committed(paths && [...paths]));
    ctx.on.baseGone((b) => svc.discard(b));
    ctx.on.close(() => svc.flush());
  },
});
