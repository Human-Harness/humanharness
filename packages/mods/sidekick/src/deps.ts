// The adapter from a core mod's ctx to what the controller needs (SidekickDeps): the controller stays as it was in the
// core, and every app service it used comes through `ctx` instead (minimal-core 1a).
import os from "node:os";
import { type EngineDef, type ModelProfile, getEngine } from "@humanharness/engines";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import { APP_SCOPE } from "@humanharness/workspace";
import { sidekickCollection } from "./collection";
import type { SidekickDeps, SidekickLike } from "./controller";
import { appendSidekickEvent, readSidekickEvents } from "./events";
import { readImportFiles } from "./import";
import { SIDEKICK_COLLECTION, type SidekickManifest } from "./manifest";
import { SidekickStore } from "./store";
import { readSidekickUsage } from "./usage";

/** The controller's deps from `ctx`; `manifest` is the harness's `sidekick` key. */
export function sidekickDeps(ctx: CoreMainCtx, manifest: SidekickManifest): SidekickDeps {
  const app = ctx.app;
  const own = () => ctx.stores.open(SIDEKICK_COLLECTION, sidekickCollection());
  return {
    manifest,
    harness: { name: app.harness.name, ...(app.harness.tagline ? { tagline: app.harness.tagline } : {}) },
    phases: (action) => app.harness.phases(action),
    phaseBrief: (action, phase) => app.harness.phaseBrief(action, phase),
    store: new SidekickStore({
      // Every record of the collection (settings, learned items, sidekicks, scope records), with no query limit.
      readAll: async () => (await own().readAll()) as never,
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: sidekick` commit.
      write: (request) => app.person.data(request, { scope: APP_SCOPE }) as never,
      manifest,
    }),
    setup: () => app.setup(),
    hasNotice: (engineId) => app.sessions.hasNotice(engineId),
    engine: getEngine,
    command: (engine) => app.sessions.command(engine.id),
    // The mod's process (`sidekick`) in Settings › Models; with `tier`, that tier's model.
    profile: async (engine, tier) => (await app.sessions.profile(engine.id, tier)) as ModelProfile,
    workDir: (base, id) => app.sessions.workDir(base, id),
    writeBrief: (folder, text, engine: EngineDef) => app.sessions.writeBrief(folder, text, engine.id),
    open: (o) => app.sessions.open({ engineId: o.engine.id, command: o.command, ...(o.env ? { env: o.env } : {}), folder: o.folder, profile: o.profile }) as unknown as SidekickLike,
    task: () => app.task(),
    // The scope's note titles (newest first) and the data tables the task agent sees.
    context: async (_base, scope) => ({ notes: (await ctx.notes.titles(scope)).slice(0, 20), data: app.harness.dataTables() }),
    uiLanguage: () => app.uiLanguage(),
    usage: readSidekickUsage,
    // The host writes a mod's line in the usage log (kind `sidekick`, its process and moment); `cap` is the profile's.
    log: (_base, r) =>
      ctx.usage.record(r.moment ?? "after", {
        engine: r.engine,
        ok: r.ok,
        ...(r.task ? { task: r.task } : {}),
        ...(r.scope ? { scope: r.scope } : {}),
        ...(r.action ? { action: r.action } : {}),
        ...(r.sidekick ? { by: r.sidekick } : {}),
        ...(r.tier ? { tier: r.tier } : {}),
        ...(r.model !== undefined ? { model: r.model } : {}),
        ...(r.effort ? { effort: r.effort } : {}),
        ...(r.usage ? { usage: r.usage } : {}),
        ...(r.limits ? { limits: r.limits } : {}),
      }),
    dailyInput: (base, day) => app.dailyInput(base, day),
    // The ui hears it on `mods.sidekick.state`: the mod's own name, never an app channel.
    changed: (state) => ctx.push("state", state),
    events: { read: readSidekickEvents, append: appendSidekickEvent },
    // Import (sidekick spec §2a.6): a file in an engine's settings folder (under home or moved by env) is refused, links resolved, before any read.
    importFiles: (paths, signal) => readImportFiles(paths, { home: os.homedir(), env: process.env }, undefined, signal),
    tagKey: async (create) => {
      const key = await app.tagKey(create);
      return key ? Buffer.from(key) : null;
    },
    pickImportFiles: () => app.pickImportFiles(),
    saveDecision: ({ scope, action, title, decision }) => app.person.note({ scope, ...(action ? { action } : {}), title, decision }),
    // Learning (sidekick spec §6.4): Sidekick's own items, written as the app in one `Data: sidekick` commit (the store
    // checks every request first and refuses while turns are blocked). Never into another profile's base.
    writeApp: async (base, requests) => {
      const c = await app.setup();
      if (!c) throw new Error("The app is not set up yet");
      if (c.base !== base) throw new Error("The app's folder changed while Sidekick was learning");
      await own().write(requests);
    },
  };
}
