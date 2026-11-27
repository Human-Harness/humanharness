import os from "node:os";
import path from "node:path";
import { app, clipboard, dialog, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { hasBackend, hasEnginePresets, hasLinkedFolders } from "@humanharness/harness-sdk";
import { flushFileIndexes } from "@humanharness/workspace";
import { searchHandlers } from "./search/ipc";
import { languageHandlers } from "./language-ipc";
import { chooseModeHandler } from "./mode-ipc";
import { setPhaseHandler } from "./phase-ipc";
import { reviewHandlers } from "./review-ipc";
import { fileHandlers, openPathIpc } from "./file-ipc";
import { documentIpc } from "./document-ipc";
import { registerPluginsIpc } from "./plugin-ipc";
import { jobsIpc } from "./jobs/jobs-host";
import { linkedIpcDeps, registerLinkedIpc } from "./linked-ipc";
import { engineIpcDeps, registerEngineIpc } from "./engine-config/engine-ipc";
import { EPOCHS_FILE, EngineEpochs } from "./engine-config/epochs";
import { buildBackend, registerBackendIpc } from "./backend/backend-ipc";
import { tasksIpc } from "./tasks-ipc";
import { respondHandler } from "./respond-ipc";
import { layoutIpc } from "./layout-ipc";
import { setupIpc } from "./setup-ipc";
import { folderIpc } from "./folder-ipc";
import { engineSetupIpc } from "./engine-setup-ipc";
import { chatIpc } from "./chat-ipc";
import { historyIpc } from "./history-ipc";
import { historyRestores } from "./history-restore";
import { dataIpc } from "./data-ipc";
import { settingsIpc } from "./settings-ipc";
import { scopesIpc } from "./scopes-ipc";
import { profilesIpc } from "./profiles-ipc";
import { registerModAppChannels } from "./mods/app-channels";
import { shownLayout } from "./mods/layout";
import { registerModsIpc } from "./mods/mods-ipc";
import { appHome } from "./mods/services";
import { materialIpc } from "./material-ipc";
import { baseFor } from "./profile-base";
import type { LifecycleDeps } from "./index";

/**
 * The window's IPC channels (replaceable parts §5.3): every handler the app registers once it is loaded, reading the
 * main entry's state through `d` (the start-up blocks' getters and setters).
 */
export function registerAppIpc(d: LifecycleDeps): void {
  d.handle("hh:getState", () => d.appState());
  d.handleAll(
    settingsIpc({
      harness: () => d.harness,
      config: () => d.config,
      settingsCtl: () => d.settingsCtl,
      pluginsCtl: () => d.pluginsCtl,
      setupCtl: () => d.setupCtl,
      host: () => d.host,
      setJobSettings: (jobs) => (d.jobSettings = jobs),
      validation: d.validation,
      currentBase: d.currentBase,
      hasNotice: d.hasNotice,
      folderBusy: d.hold.folderBusy,
      guards: d.guards,
      interruptTasks: d.interruptTasks,
      dropRuntime: d.dropRuntime,
      saveConfigPatch: d.saveConfigPatch,
      documentSessions: d.documentSessions,
      dropDataStoresUnder: d.dropDataStoresUnder,
      settleScopes: d.settleScopes,
      scopesChanged: d.scopesChanged,
      rebasePlugins: d.rebasePlugins,
      validConfig: d.validConfig,
      jobsReady: d.jobsReady,
      backendRebase: d.backendRebase,
      backendReady: d.backendReady,
      applyAppearance: d.applyAppearance,
      applyTextSize: d.applyTextSize,
      jobsChanged: d.jobsChanged,
      refreshJobBadge: d.refreshJobBadge,
      appState: d.appState,
    }),
  );
  d.handleAll(
    chatIpc({
      harness: () => d.harness,
      quitting: () => d.quitting,
      turnBlocked: d.turnBlocked,
      tasks: () => d.tasks,
      host: () => d.host,
      modHost: () => d.appMods.state.modHost,
      guards: d.guards,
      engineBusy: d.hold.engineBusy,
      scopesSettled: d.scopesSettled,
      scopesChanged: d.scopesChanged,
      validConfig: d.validConfig,
      baseOf: d.baseOf,
      dropRuntime: d.dropRuntime,
    }),
  );
  d.handle("hh:getTasks", () => d.tasks.view());
  d.handleAll(
    scopesIpc({
      quitting: () => d.quitting,
      turnBlocked: d.turnBlocked,
      tasks: () => d.tasks,
      scopesView: d.scopesView,
      scopesSettled: d.scopesSettled,
      scopeStore: d.scopeStore,
      scopesChanged: d.scopesChanged,
      linked_: d.linked_,
    }),
  );
  // Linked folders (hatches spec §3.2): only a harness that declares them has these channels, or its key (D0).
  if (hasLinkedFolders(d.harness)) {
    // Made once: the turns' scope access (linked_) shares these deps, so the prune runs once and one signing writes.
    d.linkedDeps ??= linkedIpcDeps({
      userData: app.getPath("userData"),
      home: os.homedir(),
      linkedFolders: d.harness.linkedFolders ?? {},
      store: d.scopeStore,
      validConfig: d.validConfig,
      profilesOn: d.profilesOn,
      profileIds: () => d.profilesCtl?.state().then((st) => st.list.map((p) => p.id)) ?? null,
      baseFor: (c) => baseFor(c, true),
      baseOf: d.baseOf,
      scopeStoreFor: d.scopeStoreFor,
      references: async (c, base) => (await d.workReferences(c, base)).map((r) => r.path),
      pick: async () => {
        if (!d.window || d.window.isDestroyed()) return null;
        const r = await dialog.showOpenDialog(d.window, { properties: ["openDirectory"] });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      trash: (dir) => shell.trashItem(dir),
      scopesChanged: d.scopesChanged,
      linked: d.linked_,
      unsupported: () => d.linkedUnsupported,
      currentScope: () => d.tasks.currentScope(),
      openLinked: d.openLinked,
    });
    registerLinkedIpc(d.handle, d.linkedDeps);
  }
  // A scope's engine config (hatches spec §5.3): only a harness that declares `enginePresets` has these channels (D0).
  if (hasEnginePresets(d.harness)) {
    const userData = app.getPath("userData");
    d.engineIpc = registerEngineIpc(
      d.handle,
      engineIpcDeps({
        host: d.engineHost_()!,
        userData,
        validConfig: d.validConfig,
        baseOf: d.baseOf,
        scopeStoreFor: d.scopeStoreFor,
        profilesOn: d.profilesOn,
        epochs: () => (d.engineEpochs ??= new EngineEpochs(path.join(userData, EPOCHS_FILE))),
        engines: () => d.harness.engines,
        engineId: async () => (await d.config.load()).engineId,
        send: d.sendToWindow,
      }),
    );
  }
  if (hasEnginePresets(d.harness)) void d.pruneEngineConfig();
  // The harness's backend (hatches spec §4): only a harness that declares one has a supervisor and these channels (D0).
  if (hasBackend(d.harness)) {
    d.backend = buildBackend(d.harness, { userData: app.getPath("userData"), launcher: electronLauncher(process.execPath), send: d.sendToWindow });
    if (d.backend) registerBackendIpc(d.handle, { supervisor: d.backend });
  }
  d.handleAll(dataIpc({ harness: () => d.harness, scopesSettled: d.scopesSettled, harnessUiData: d.harnessUiData, currentHistory: d.currentHistory }));
  // The app channels a core mod answers (Sidekick's, sidekick spec §7): each call goes to the mod host.
  registerModAppChannels(d.handle, () => d.appMods.state.modHost);
  // The layout the screen shows (minimal-core spec §5.2).
  d.handle("hh:layout", () => shownLayout(appHome(app.getPath("userData"), d.harness.id)));
  // The person's pick (0b2): written in the home folder's settings.json; the watcher redraws the window too.
  d.handle("hh:layoutPick", layoutIpc({ home: () => appHome(app.getPath("userData"), d.harness.id) })["hh:layoutPick"]);
  // Safe mode entered this run: the window shows its notice.
  d.handle("hh:safeMode", () => d.appMods.state.safeEntered);
  // Settings › Mods (minimal-core spec §4, §6): registered with or without a host, so the page always answers (empty).
  registerModsIpc(d.handle, d.appMods.modsIpcDeps());
  // Plugins and the Attention inbox (plugins spec §6, §7): only with the controller (D0: no handler at all).
  // A prepared task starts only here, from the person's Start (P6): nothing but the token comes from the window.
  if (d.pluginsCtl) {
    registerPluginsIpc(d.handle, d.pluginsCtl, {
      startPrepared: (p) => d.tasks.startPrepared(p),
      // Board mode: a prepared task starts in a lane of its own, whatever another lane runs.
      startBlocked: () => (d.quitting ? "The app is closing" : (d.turnBlocked() ?? (!d.host && d.tasks.isBusy() ? "A turn is already running" : null))),
      ...(d.harness.scopes ? { scopes: { label: d.harness.scopes.label, open: async () => (await d.tasks.currentScope()) !== null } } : {}),
    });
  }
  d.handleAll(setupIpc({ setupCtl: () => d.setupCtl }));
  d.handleAll(profilesIpc({ profilesCtl: () => d.profilesCtl, appState: d.appState, lastAppState: () => d.lastAppState }));
  // The person's material (material spec §10).
  d.handleAll(materialIpc({ materialSvc: () => d.materialSvc, shell }));
  d.handle("hh:respond", respondHandler({ quitting: () => d.quitting, blocked: d.turnBlocked, respond: (blockId, value) => d.tasks.respond(blockId, value) }));
  // The person's pick of a mode (task-modes spec §5): the acceptance comes back as data.
  d.handle(
    "hh:chooseMode",
    chooseModeHandler({
      quitting: () => d.quitting,
      blocked: d.turnBlocked,
      openTask: async () => (await d.tasks.runningTask())?.id ?? null,
      choose: (mode, choice, task) => d.tasks.chooseMode(mode, choice, task),
    }),
  );
  // The person's pick of a phase (task-phases spec §4.2): the acceptance comes back as data.
  d.handle("hh:setPhase", setPhaseHandler({ quitting: () => d.quitting, blocked: d.turnBlocked, setPhase: (to, task) => d.tasks.setPhase(to, task) }));
  d.handleAll(openPathIpc({ validConfig: d.validConfig, baseOf: d.baseOf, workReferences: d.workReferences, shell }));
  const reader = documentIpc({ documentRoots: d.documentRoots, documentSessions: d.documentSessions });
  d.handle("hh:readDocument", reader["hh:readDocument"]);
  d.handle("hh:readImage", reader["hh:readImage"]);
  d.handle("hh:documentsExist", reader["hh:documentsExist"]);
  d.handleFrom("hh:watchDocument", reader["hh:watchDocument"]);
  d.handleFrom("hh:unwatchDocument", reader["hh:unwatchDocument"]);
  // Reviews (review spec §5.6): every answer is data; nothing reaches the service unless the agent may edit the folder (D0).
  d.handleAll(reviewHandlers(d.reviews, () => d.harness.permissions.edit === "folder"));
  // File timelines (file-timeline spec §6.3): every harness (Q1); every answer is data.
  d.handleAll(fileHandlers(d.fileTimelines));
  d.handleAll(searchHandlers(d.searchSvc));
  // Language on demand (plan 5b): every answer is data; the state is pushed on hh:language.
  if (d.translation) d.handleAll(languageHandlers(d.translation));
  // Cancels the turn and stops the task operation (a closing turn never goes on to the next task).
  d.handle("hh:cancel", () => d.tasks.cancel());
  // The go-back service: the wrappers below and a core mod's `ctx.app.history` (app-lifecycle's parts) both call it.
  const restores = historyRestores({
    quitting: () => d.quitting,
    tasksBusy: () => d.tasks.isBusy(),
    restoreHeld: d.hold.restoreHeld,
    linked_: d.linked_,
    currentHistory: d.currentHistory,
    linkedHistoriesOf: d.linkedHistoriesOf,
    confirmGoBack: d.confirmGoBack,
    mainWindow: () => (d.window && !d.window.isDestroyed() ? d.window.webContents : null),
    restoreWith: d.restoreWith,
    afterRestore: d.afterRestore,
    restores: d.restores,
    undoByPaths: d.undoByPaths,
    fileTimelines: d.fileTimelines,
  });
  d.historyRestores = restores;
  const history = historyIpc({ restores, homeHistory: () => d.appMods.state.homeHistory, linked_: d.linked_, linkedHistoriesOf: d.linkedHistoriesOf });
  d.handleFrom("hh:fileRestore", history["hh:fileRestore"]);
  d.handle("hh:historyTasks", history["hh:historyTasks"]);
  d.handle("hh:homeHistory", history["hh:homeHistory"]);
  d.handle("hh:homeUndo", history["hh:homeUndo"]);
  // Board mode's task inbox (parallel spec §9.1). Ids are looked up in the board's lanes (P1); plain mode refuses.
  const inbox = tasksIpc(() => d.host);
  d.handle("hh:tasksList", () => inbox.list());
  d.handle("hh:tasksFocus", (id: unknown) => inbox.focus(id));
  d.handle("hh:tasksCancelQueued", (id: unknown) => inbox.cancelQueued(id));
  d.handle("hh:tasksResume", () => inbox.resume());
  // The jobs channels (parallel spec §9.1, J4): a declared manual job in an existing scope; without jobs, refused (D0).
  const jobsChannels = jobsIpc(() => d.jobsHost);
  d.handle("hh:jobsList", () => jobsChannels.list());
  d.handle("hh:jobsRun", (id: unknown, scope: unknown) => jobsChannels.run(id, scope));
  d.handleAll(
    engineSetupIpc({
      harness: () => d.harness,
      config: () => d.config,
      shared: () => d.shared,
      quitting: () => d.quitting,
      profilesCtl: () => d.profilesCtl,
      setupRun: () => d.setupRun,
      setSetupRun: (run) => (d.setupRun = run),
      stopTranslation: () => d.translation?.stop(),
      hooks: d.hooks,
      commandDeps: d.commandDeps,
      guards: d.guards,
      engineFor: d.engineFor,
      hasNotice: d.hasNotice,
      engineBusy: d.hold.engineBusy,
      dropRuntime: d.dropRuntime,
      sendToWindow: d.sendToWindow,
      validConfig: d.validConfig,
      baseOf: d.baseOf,
      clipboard,
      shell,
    }),
  );
  d.handleAll(
    folderIpc({
      window: () => d.window,
      config: () => d.config,
      quitting: () => d.quitting,
      profilesCtl: () => d.profilesCtl,
      pluginsCtl: () => d.pluginsCtl,
      backend: () => d.backend,
      host: () => d.host,
      tasks: () => d.tasks,
      moving: () => d.moving,
      setMoving: (run) => (d.moving = run),
      setHistoryHeld: (held) => (d.historyHeld = held),
      pluginStateRoot: () => d.pluginStateRoot,
      userData: () => app.getPath("userData"),
      dialog,
      shell,
      guards: d.guards,
      folderBusy: d.hold.folderBusy,
      plainTasks: d.plainTasks,
      restores: d.restores,
      documentSessions: d.documentSessions,
      events: d.events,
      validConfig: d.validConfig,
      baseOf: d.baseOf,
      standaloneHistory: d.standaloneHistory,
      openHistory: d.openHistory,
      flushTurns: d.flushTurns,
      flushFileIndexes,
      closeRuntime: d.closeRuntime,
      pluginLog: d.pluginLog,
      rebasePlugins: d.rebasePlugins,
      backendRebase: d.backendRebase,
      appState: d.appState,
      dropDataStoresUnder: d.dropDataStoresUnder,
    }),
  );
}
