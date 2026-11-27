import path from "node:path";
import { app, type BrowserWindow, dialog, shell } from "electron";
import { getEngine } from "@humanharness/engines";
import { type LoadedHarness, dataCollections } from "@humanharness/harness-sdk";
import type { ConfiguredApp, ScopesView } from "@humanharness/protocol";
import type { CoreApp } from "@humanharness/mod-sdk/core";
import { APP_SCOPE, type History, MAIN_SCOPE, notesPrefix, readNotes } from "@humanharness/workspace";
import type { DataStore, ScopeStore } from "@humanharness/workspace";
import type { ConfigStore } from "./config";
import { commitAnnouncer } from "./commit-announcer";
import { dataWriteQueue, harnessUiDataRequests, personDataRequests } from "./data-requests";
import type { EngineIpc } from "./engine-config/engine-ipc";
import type { EngineGuards } from "./engine-guards";
import { historyView } from "./history-view";
import { holds } from "./holds";
import type { JobsHost } from "./jobs/jobs-host";
import { cleanModels, pinnedBudget } from "./models";
import type { PluginsController } from "./plugins";
import { ProfileSwitch } from "./profile-switch";
import type { Profiles } from "./profiles";
import type { ResolvedReference } from "./references";
import { RestoreGuard } from "./restore-guard";
import { createCoreEvents } from "./mods/core-events";
import type { ModHost } from "./mods/host";
import { revealIfStillSafe } from "./open-path";
import type { SettingsController } from "./settings";
import type { TaskManager } from "./task-manager";

/** What the IPC helper services read from the main entry. Getters for what changes after they are built. */
export interface AppServicesDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  guards: EngineGuards;
  quitting(): boolean;
  moving(): Promise<unknown> | null;
  window(): BrowserWindow | null;
  tasks(): Pick<
    TaskManager,
    | "isBusy"
    | "finish"
    | "chatScope"
    | "trailerNow"
    | "runningTask"
    | "whenSettled"
    | "reviewRound"
    | "documentApproved"
    | "contextRecord"
    | "addContext"
    | "view"
    | "currentScope"
  >;
  jobsHost(): JobsHost | null;
  profilesCtl(): Profiles | null;
  settingsCtl(): SettingsController | null;
  pluginsCtl(): PluginsController | null;
  engineIpc(): EngineIpc | null;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  dataStoreFor(base: string): DataStore;
  /** The mods' own stores (`ctx.stores`): whether a mod has one named `name`, and that store in `base`. Absent: none. */
  modStores?: { has(name: string): boolean; storeFor(base: string, name: string): DataStore | undefined };
  /** The mod host, told after a restore (core mods' `onRefresh`). Absent or null: no mods (D0). */
  modHost?(): (Pick<ModHost, "refresh"> & Partial<Pick<ModHost, "dataChanged" | "restored" | "baseGone" | "historyCommit" | "folderChanged">>) | null;
  scopeStoreFor(base: string): ScopeStore;
  scopesView(): Promise<ScopesView>;
  currentHistory(): Promise<History | null>;
  currentBase(): Promise<string | null>;
  ownCommits(): boolean;
  closeRuntime(): Promise<void>;
  arrivedInProfile(): Promise<void>;
  workReferences(c: ConfiguredApp, base: string): Promise<ResolvedReference[]>;
}

/** The services behind the IPC handlers: holds, restores, profile switches, data requests, timelines, context, search. */
export function createAppServices(d: AppServicesDeps) {
  const {
    validConfig,
    baseOf,
    scoped,
    activeScope,
    dataStoreFor,
    scopeStoreFor,
    scopesView,
    currentHistory,
    currentBase,
    ownCommits,
    closeRuntime,
    arrivedInProfile,
    workReferences,
  } = d;

  /**
   * What waits for what (profiles spec §5): turns, restores, profile switches, engine changes, folder moves, archives and
   * deletes. Each source is read only when a guard asks, after all of them exist.
   */
  const hold = holds({
    quitting: () => d.quitting(),
    tasksBusy: () => d.tasks().isBusy(),
    moving: () => d.moving() !== null,
    engine: () => d.guards.turnBlocked(),
    restore: () => restores.turnBlocked(),
    profileSwitch: () => switches.turnBlocked(),
    profileChange: () => d.profilesCtl()?.changing() ?? false,
  });

  /** What happened in the base (data written, restored, a base gone, quitting): core mods and the core's services listen. */
  const events = createCoreEvents({ host: () => d.modHost?.() ?? null });

  /**
   * Restores: refused while quitting, while a task operation runs or turns are held (engine change, folder
   * move, a profile switch); one at a time; new turns are refused and a runtime starting waits until it ends.
   */
  const restores = new RestoreGuard({ quitting: () => d.quitting(), busy: () => d.tasks().isBusy() || (d.jobsHost()?.running() ?? false), turnBlocked: hold.restoreHeld });
  const restoreWith = (run: (history: History) => Promise<unknown>) => restores.run(currentHistory, run);
  /** A restore changes tracked files with no data event: the settings may have changed. */
  function afterRestore(): void {
    void d.settingsCtl()?.changed();
    // A restore reconciles the whole folder (search spec §4.2): the search index hears it as `restored`.
    events.restored(null);
    // The core mods read their settings again (Sidekick on or off, its state sent). D0: no host.
    void d.modHost?.()?.refresh().catch((err: unknown) => console.error("The mods' refresh failed", err));
  }

  /**
   * Profile switches (profiles spec §5): one at a time, refused while a turn, a restore, a move, an engine change, an
   * archive or a delete runs, and holding all of them off.
   */
  const switches = new ProfileSwitch({
    quitting: () => d.quitting(),
    busy: hold.switchBusy,
    turnBlocked: hold.switchHeld,
    closeTask: () => d.tasks().finish(),
    closeRuntime,
    saveActive: async (id) => void (await d.config().setProfile(id)),
    arrived: () => arrivedInProfile(),
  });

  /** Why a new turn can't start now (engine change, folder move, engine update, a restore, a profile switch), or null. */
  const turnBlocked = hold.turnBlocked;

  /** The person's data writes and the tools' (tools spec §8.3) in one order: no commit holds the other's write. */
  const dataWrites = dataWriteQueue();
  /** Whether `collection` is a core mod's own store (in any base: the name is what counts). */
  const ownStore = (collection: string) => d.modStores?.has(collection) ?? false;
  /** The harness UI's data requests (hh:data): one handler, so the person's writes and their commits run one at a time. */
  const personData = personDataRequests({
    serial: dataWrites,
    store: async () => {
      const c = await validConfig();
      return c ? dataStoreFor(baseOf(c)) : null;
    },
    chatScope: () => d.tasks().chatScope(),
    trailer: () => d.tasks().trailerNow(),
    history: () => currentHistory(),
    // Board mode, or a job running beside the single task: a write commits only its collection's file (parallel spec §5.3).
    board: ownCommits,
    blocked: () => (d.quitting() ? "The app is closing" : turnBlocked()),
    // Without scopes the only scope is the implicit `main` (D2); with them, the registry's open (not archived) scopes.
    scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
    // A core mod's own collection (Sidekick's `sidekick`, sidekick spec §6.4) lives in the mod's store; every other as before.
    storeFor: (collection) => (ownStore(collection) ? validConfig().then((c) => (c ? (d.modStores?.storeFor(baseOf(c), collection) ?? null) : null)) : undefined),
  });
  /** The same handler for the harness UI, which only reads `settings` (it changes them through `client.settings`) and never a mod's own collection. */
  const harnessUiData = harnessUiDataRequests(personData, () => d.harness().settings !== undefined, ownStore);

  /** What search finds among the tasks, read when the palette opens (search spec §4.2): actions, the open task, past tasks. */
  async function searchTasks(): ReturnType<CoreApp["search"]["tasks"]> {
    const scopeOf = (s: string | undefined) => (scoped() ? (s ?? APP_SCOPE) : MAIN_SCOPE);
    const view = await d.tasks().view();
    const actions = Object.entries(d.harness().actions).map(([id, a]) => ({
      id,
      label: a.label,
      ...(a.description ? { description: a.description } : {}),
      ...(a.tier ? { tier: a.tier } : {}),
      ...(view.actions[id] ? { status: view.actions[id] } : {}),
      scope: scopeOf(undefined),
    }));
    const current = view.current;
    const label = (id: string | null | undefined) => (id && Object.hasOwn(d.harness().actions, id) ? d.harness().actions[id].label : undefined);
    const open = current && label(current.action) ? { id: current.id, title: label(current.action)!, scope: scopeOf(current.scope) } : null;
    const history = await currentHistory();
    const rows = history ? historyView(await history.tasks()) : [];
    const past = rows.flatMap((r) => {
      const title = r.noteTitle ?? label(r.actionId);
      return r.taskId && r.taskId !== current?.id && title ? [{ id: r.taskId, title, scope: scopeOf(r.scopeId), at: Date.parse(r.date) || 0 }] : [];
    });
    return { actions, open, past };
  }

  /** What global search's mod reads of the app (`ctx.app.search`): the mod owns the index, the worker and the channels. */
  const search: CoreApp["search"] = {
    userData: () => app.getPath("userData"),
    openScope: () => d.tasks().currentScope(),
    scopeTitles: async () => new Map((await scopesView()).list.map((s) => [s.id, s.title])),
    references: async () => {
      const c = await validConfig();
      return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, label: r.label, path: r.path })) : [];
    },
    tasks: () => searchTasks(),
    extraDenied: async () => {
      // Same rule as the history's ignore list: the engine's instructions file is the app's, not the person's.
      const c = await validConfig();
      const extra = c ? getEngine(c.engineId).instructionsFile?.path : undefined;
      return extra ? [extra] : [];
    },
    reveal: (file, roots) => revealIfStillSafe(file, roots, (p) => shell.showItemInFolder(p)),
    collections: () => dataCollections(d.harness()),
    scopes: async (base) => (await scopeStoreFor(base).list()).filter((s) => !s.archived).map((s) => s.id),
    store: (base) => dataStoreFor(base),
    plugins: () => d.pluginsCtl() ?? null,
  };

  /** Passes on which paths each commit touched (null: too many to list). */
  const commitAnnouncements = commitAnnouncer((paths) => {
    // A commit that touched a scope's engine folder: its Engine config section reads it again (enginePresets only).
    d.engineIpc()?.committed(paths);
    // Search (D0): the commit's paths go out as `restored`; the search service (and a core mod) read them again.
    events.restored(paths);
    // And as the commit it is: `restored` also fires on a restore. The documents mod pushes it to the window.
    events.historyCommit(paths);
  });
  const announceCommits = (history: History) => commitAnnouncements.watch(history);

  return {
    hold,
    restores,
    restoreWith,
    afterRestore,
    switches,
    turnBlocked,
    dataWrites,
    personData,
    harnessUiData,
    search,
    events,
    commitAnnouncements,
    announceCommits,
  };
}
