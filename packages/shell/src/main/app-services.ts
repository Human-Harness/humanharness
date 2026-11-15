import path from "node:path";
import { app, type BrowserWindow, dialog, shell } from "electron";
import { getEngine } from "@humanharness/engines";
import { type LoadedHarness, SIDEKICK_COLLECTION, dataCollections } from "@humanharness/harness-sdk";
import type { ConfiguredApp, ScopesView } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { type SearchDoc, actionDocs, openTaskDoc, pastTaskDocs } from "@humanharness/search";
import { APP_SCOPE, type History, MAIN_SCOPE, loadReview, notesPrefix, readNotes } from "@humanharness/workspace";
import type { DataStore, ScopeStore } from "@humanharness/workspace";
import type { ConfigStore } from "./config";
import { ContextService } from "./context";
import { dataWriteQueue, harnessUiDataRequests, personDataRequests } from "./data-requests";
import { workerDiff } from "./diff-runner";
import type { EngineIpc } from "./engine-config/engine-ipc";
import type { EngineGuards } from "./engine-guards";
import { commitAnnouncer } from "./file-ipc";
import { FileTimelineService } from "./file-timeline";
import { historyView } from "./history-view";
import { holds } from "./holds";
import type { JobsHost } from "./jobs/jobs-host";
import { cleanModels, pinnedBudget } from "./models";
import type { PluginsController } from "./plugins";
import { ProfileSwitch } from "./profile-switch";
import type { Profiles } from "./profiles";
import type { ResolvedReference } from "./references";
import { RestoreGuard } from "./restore-guard";
import { ReviewService } from "./reviews";
import { searchData } from "./search/data-sources";
import { workerBuild } from "./search/runner";
import { SearchService } from "./search/service";
import { revealIfStillSafe } from "./open-path";
import type { SettingsController } from "./settings";
import type { SidekickController } from "./sidekick";
import type { TaskManager } from "./task-manager";

/** What the IPC helper services read from the main entry. Getters for what changes after they are built. */
export interface AppServicesDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  here: string;
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
  sidekickCtl(): SidekickController | null;
  pluginsCtl(): PluginsController | null;
  engineIpc(): EngineIpc | null;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  dataStoreFor(base: string): DataStore;
  sidekickStoreFor(base: string): DataStore;
  scopeStoreFor(base: string): ScopeStore;
  scopesView(): Promise<ScopesView>;
  currentHistory(): Promise<History | null>;
  currentBase(): Promise<string | null>;
  ownCommits(): boolean;
  closeRuntime(): Promise<void>;
  arrivedInProfile(): Promise<void>;
  workReferences(c: ConfiguredApp, base: string): Promise<ResolvedReference[]>;
  sendToWindow(channel: PushChannel, value: unknown): void;
}

/** The services behind the IPC handlers: holds, restores, profile switches, data requests, reviews, timelines, context, search. */
export function createAppServices(d: AppServicesDeps) {
  const {
    validConfig,
    baseOf,
    scoped,
    activeScope,
    dataStoreFor,
    sidekickStoreFor,
    scopeStoreFor,
    scopesView,
    currentHistory,
    currentBase,
    ownCommits,
    closeRuntime,
    arrivedInProfile,
    workReferences,
    sendToWindow,
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

  /**
   * Restores: refused while quitting, while a task operation runs or turns are held (engine change, folder
   * move, a profile switch); one at a time; new turns are refused and a runtime starting waits until it ends.
   */
  const restores = new RestoreGuard({ quitting: () => d.quitting(), busy: () => d.tasks().isBusy() || (d.jobsHost()?.running() ?? false), turnBlocked: hold.restoreHeld });
  const restoreWith = (run: (history: History) => Promise<unknown>) => restores.run(currentHistory, run);
  /** A restore changes tracked files with no data event: the settings and Sidekick's settings may have changed. */
  function afterRestore(): void {
    void d.settingsCtl()?.changed();
    void d.sidekickCtl()?.refresh().catch((err: unknown) => console.error("Could not refresh Sidekick", err));
    // A restore reconciles the whole folder (search spec §4.2); a no-op until search was first opened (D0).
    searchSvc.committed(null);
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
    // The reserved `sidekick` collection lives in its own store (sidekick spec §6.4); every other collection as before.
    storeFor: (collection) =>
      collection === SIDEKICK_COLLECTION ? validConfig().then((c) => (c ? sidekickStoreFor(baseOf(c)) : null)) : undefined,
  });
  /** The same handler for the harness UI, which only reads `settings` (it changes them through `client.settings`). */
  const harnessUiData = harnessUiDataRequests(personData, () => d.harness().settings !== undefined);

  /** Document reviews (review spec): the person's side, and the agent's tools for each runtime's folder (one set of locks). */
  const reviews = new ReviewService({
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    history: () => currentHistory(),
    trailer: () => d.tasks().trailerNow(),
    openTask: async () => {
      const t = await d.tasks().runningTask();
      return t ? { id: t.id, scope: t.scope } : null;
    },
    busy: () => d.tasks().isBusy(),
    whenSettled: (write) => d.tasks().whenSettled(write),
    blocked: () => (d.quitting() ? "The app is closing" : turnBlocked()),
    // The canonical path and the record's scope; rejects with `RoundNotStarted` when no turn started.
    round: (r) => d.tasks().reviewRound(r),
    approved: (a) => void d.tasks().documentApproved(a).catch((err: unknown) => console.error("Could not act on the approval", err)),
    reviewTier: (kind) => {
      const kinds = d.harness().documents?.kinds;
      return (kind !== undefined && kinds && Object.hasOwn(kinds, kind) ? kinds[kind].reviewTier : undefined) ?? "standard";
    },
    changed: (p) => sendToWindow("hh:reviewChanged", p),
  });

  /** File timelines (file-timeline spec): read from the history; a one-file go-back goes through the restore guard. */
  const fileTimelines = new FileTimelineService({
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    history: () => currentHistory(),
    actionLabel: (id) => (id === null ? "A question" : Object.hasOwn(d.harness().actions, id) ? d.harness().actions[id].label : id),
    approvals: async (base, doc) => (await loadReview(base, doc).catch(() => null))?.approvals ?? [],
    busy: () => d.quitting() || d.tasks().isBusy() || turnBlocked() !== null,
    restore: (run) => restoreWith(run),
    restored: () => afterRestore(),
    // Diffs run in a worker thread of their own: jsdiff's budget and the Markdown parse never block Electron main.
    diff: workerDiff({ entry: path.join(d.here, "diff-worker.js") }),
  });

  /** The context panel (context-panel spec): the person's pins and exclusions and the open task's record. */
  const contextSvc = new ContextService({
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    scoped,
    scopeExists: (id) => activeScope(id),
    budget: async () => pinnedBudget(cleanModels((await d.config().load()).models), d.harness().context),
    record: (id) => d.tasks().contextRecord(id),
    openTask: async () => (await d.tasks().runningTask())?.id ?? null,
    noteTitles: async (scope) => {
      const c = await validConfig();
      if (!c) return new Map<string, string>();
      const notes = await readNotes(baseOf(c), notesPrefix(scoped(), scope)).catch(() => []);
      return new Map(notes.map((n) => [n.path, n.title]));
    },
    history: () => currentHistory(),
    trailer: () => d.tasks().trailerNow(),
    blocked: () => (d.quitting() ? "The app is closing" : turnBlocked()),
    add: (taskId, file) => {
      const { accepted, done } = d.tasks().addContext(taskId, file);
      // Closing ends the operation before it runs: not a failure worth a log line.
      done.catch((err: unknown) => {
        if (!d.quitting()) console.error("The Add now turn failed", err);
      });
      return accepted;
    },
    pickFile: async (base) => {
      const window = d.window();
      if (!window || window.isDestroyed()) return null;
      const result = await dialog.showOpenDialog(window, { defaultPath: base, properties: ["openFile"] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    changed: (task) => void sendContext(task),
  });

  /** What search finds among the tasks, built when the palette opens (search spec §4.2): actions, the open task, past tasks. */
  async function searchMemory(): Promise<SearchDoc[]> {
    const scopeOf = (s: string | undefined) => (scoped() ? (s ?? APP_SCOPE) : MAIN_SCOPE);
    const view = await d.tasks().view();
    const actions = actionDocs(
      Object.entries(d.harness().actions).map(([id, a]) => ({
        id,
        label: a.label,
        ...(a.description ? { description: a.description } : {}),
        ...(a.tier ? { tier: a.tier } : {}),
        ...(view.actions[id] ? { status: view.actions[id] } : {}),
        scope: scopeOf(undefined),
      })),
    );
    const current = view.current;
    const label = (id: string | null | undefined) => (id && Object.hasOwn(d.harness().actions, id) ? d.harness().actions[id].label : undefined);
    const open = current && label(current.action) ? [openTaskDoc({ id: current.id, title: label(current.action)!, scope: scopeOf(current.scope), at: 0 })] : [];
    const history = await currentHistory();
    const rows = history ? historyView(await history.tasks()) : [];
    const past = pastTaskDocs(
      rows.flatMap((r) => {
        const title = r.noteTitle ?? label(r.actionId);
        return r.taskId && r.taskId !== current?.id && title ? [{ id: r.taskId, title, scope: scopeOf(r.scopeId), at: Date.parse(r.date) || 0 }] : [];
      }),
    );
    return [...actions, ...open, ...past];
  }

  /** Global search's collections (search spec D4): the harness's, then each running plugin's, of the live index's base only. */
  const searchDataDeps = searchData({
    current: () => currentBase(),
    collections: () => dataCollections(d.harness()),
    scoped,
    scopes: async (base) => (await scopeStoreFor(base).list()).filter((s) => !s.archived).map((s) => s.id),
    store: (base) => dataStoreFor(base),
    plugins: () => d.pluginsCtl() ?? null,
  });

  /** Global search (search spec): nothing is read, written or started until the window first asks (D0, D8). */
  const searchSvc = new SearchService({
    userData: () => app.getPath("userData"),
    base: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    scoped,
    openScope: () => d.tasks().currentScope(),
    scopeTitles: async () => new Map((await scopesView()).list.map((s) => [s.id, s.title])),
    references: async () => {
      const c = await validConfig();
      return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, label: r.label, path: r.path })) : [];
    },
    memory: () => searchMemory(),
    extraDenied: async () => {
      // Same rule as the history's ignore list: the engine's instructions file is the app's, not the person's.
      const c = await validConfig();
      const extra = c ? getEngine(c.engineId).instructionsFile?.path : undefined;
      return extra ? [extra] : [];
    },
    status: (s) => sendToWindow("hh:searchStatus", s),
    runner: workerBuild({ entry: path.join(d.here, "search-worker.js") }),
    reveal: (file, roots) => revealIfStillSafe(file, roots, (p) => shell.showItemInFolder(p)),
    data: searchDataDeps,
    // A burst of writes (an import, a plugin run) is one refresh.
    dataDelayMs: 500,
  });

  /** The task's panel refreshes (`hh:context`); a task that is no longer open sends nothing. */
  async function sendContext(task: string): Promise<void> {
    const got = await contextSvc.get(task).catch(() => null);
    if (got?.ok) sendToWindow("hh:context", { task, context: got.context });
  }

  /** Tells the window which paths each commit touched: an open timeline gets its new entry (§6.3 `onChange`). */
  const commitAnnouncements = commitAnnouncer((paths) => {
    sendToWindow("hh:fileCommits", paths);
    // A commit that touched a scope's engine folder: its Engine config section reads it again (enginePresets only).
    d.engineIpc()?.committed(paths);
    // Search (D0): a no-op until the palette first opened; then the commit's paths are read again.
    searchSvc.committed(paths);
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
    reviews,
    fileTimelines,
    contextSvc,
    searchSvc,
    sendContext,
    commitAnnouncements,
    announceCommits,
  };
}
