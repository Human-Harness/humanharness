import { APP_SCOPE, MAIN_SCOPE, flushFileIndexes, noteSlug, notesPrefix, readNotes, tasksFile, writeNote } from "@humanharness/workspace";
import { BrowserWindow, Notification, app, dialog, ipcMain, nativeImage, nativeTheme, powerMonitor, protocol, session, shell } from "electron";
import { CORE_MODS } from "./mods/core-mods";
import type { CoreAppParts } from "./mods/core-app";
import { ConfigStore, historyDir } from "./config";
import { DEFAULT_LANGUAGE, PROFILE_COLLECTION, hasEnginePresets, hasJobs, hasSecrets, hasTools, languageName, pluginsAccepted, resolveInHarness } from "@humanharness/harness-sdk";
import { MOD_SCHEME } from "./mods/mod-scheme";
import { PLUGIN_SCHEME, PluginBackendHost } from "./plugin-host";
import { PLUGIN_STATE_DIR } from "./plugin-state";
import { PluginPointers } from "./plugin-load";
import { PluginsController, watchPluginFolder } from "./plugins";
import { Profiles } from "./profiles";
import { SettingsController } from "./settings";
import { SetupSteps, recordSetup } from "./setup-steps";
import { SharedConfigStore, sharedConfigDir } from "./shared-config";
import { EngineSession } from "@humanharness/runtime";
import { TOOLS_CHANGE_CHANNEL, registerToolsIpc } from "./tools/tools-ipc";
import { TOOL_SCHEME } from "./tools/tool-protocol";
import { ToolHost } from "./tools/tool-host";
import { startPackagedUpdater } from "./updater";
import { UsageLog, dayTokens } from "./usage-log";
import { appHome } from "./mods/services";
import { localDay } from "./mods/host";
import { sessionWorkDir, writeSessionBrief } from "./mods/core-sessions";
import { sourceTagKey } from "./linked-ipc";
import { attentionStores } from "./attention-stores";
import { buildBoardHost } from "./board-host-wiring";
import { buildJobsHost, buildSingleJobs } from "./jobs/jobs-wiring";
import { buildMaterial, buildMaterialJobs } from "./material-wiring";
import { buildTaskAttention, keepNotification } from "./task-attention";
import { buildTranslation } from "./translation";
import { cleanModels } from "./models";
import { createToolsHost, slotTaskOf } from "./tools/tools-host";
import defaultLayoutJson from "./mods/default-layout.json";
import { devDockIcon } from "./dock-icon";
import { devEngine, mockToolsDir } from "./test-hooks";
import { engineCommand, loginShellPath, resolveBinary } from "./engine-command";
import { promises as fs } from "node:fs";
import { getEngine } from "@humanharness/engines";
import { harnessLayer, writeLayers } from "./mods/home-folder";
import { hostMode } from "./board-host";
import { isPublicHost } from "./material-fetch";
import { jobOriginKnown } from "./jobs/jobs-host";
import { manualFiles } from "./mods/manual";
import { moveJournal, recoverMove } from "./move-folder";
import os from "node:os";
import path from "node:path";
import { registerConnectionsIpc } from "./secrets/connections-ipc";
import { resolveReferences } from "./references";
import { runFile } from "./plugin-exec";
import { runningPlugins } from "./search/data-sources";
import { safeAtStart } from "./mods/safe";
import { saveAppChange } from "./app-change";
import { shownLayout } from "./mods/layout";
import { startControl } from "./mods/control";
import { stopSetupProcess } from "./setup-runner";
import { toolDataRequests } from "./data-requests";
import type { LifecycleDeps } from "./index";

/**
 * The main entry's start-up, once the harness is loaded and before "ready": app name and userData, the controllers the
 * harness declares, the privileged schemes (Electron takes them only before "ready"). index.ts sets `harness` first.
 */
export async function onLoaded(d: LifecycleDeps): Promise<void> {
  const { activeScope, baseOf, boardHost, commandDeps, connections, currentBase, currentHistory, dataStoreFor, dataWrites, emit, handle, hasNotice, here, hold, hooks, kickMaterial, materialStageDeps, ownCommits, personData, pickProfile, pluginLog, pluginPanels, readPhaseBrief, refreshDockBadge, runtime, scopeStoreFor, scoped, searchSvc, secretStore, sendToWindow, shellResources, switches, toolsLog, translateEngine, turnBlocked, turns, validConfig, workReferences } = d;
  const harness = d.harness;
  app.setName(harness.name);
  app.setPath("userData", hooks.userData ?? path.join(app.getPath("appData"), "Human Harness", harness.id));
  if (harness.settings) {
    d.settingsCtl = new SettingsController({
      settings: harness.settings,
      modes: harness.modes,
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: settings` commit (open task's trailer).
      write: (request) => personData(request, { scope: APP_SCOPE }),
      taskOpen: async () => (await d.tasks.runningTask()) !== null,
      whenNoTask: (fn) => d.tasks.whenNoTask(fn),
      // Only from betweenTasks or a whenNoTask callback (the task queue, which also creates runtimes); peek, never get.
      refresh: async () => {
        // Board mode: a refusal (a lane runs a turn) throws, so the change stays stale for the next gap.
        if (d.host) return d.host.refreshInstructions();
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      changed: (state) => sendToWindow("hh:settings", state),
    });
  }
  // The app's parts, built once: core mods get them through `ctx.app` (mods/core-app.ts).
  const core: CoreAppParts = {
    harness: { name: harness.name, ...(harness.tagline ? { tagline: harness.tagline } : {}), ...(harness.mods ? { mods: harness.mods } : {}) },
    phases: (action) => (action && Object.hasOwn(harness.actions, action) ? (harness.actions[action].phases ?? []) : []),
    phaseBrief: (action, phase) => readPhaseBrief(action, phase).catch(() => null),
    dataTables: () =>
      Object.entries(harness.data)
        .filter(([, c]) => c.agent !== "none")
        .map(([name]) => name),
    setup: async () => {
      const c = await validConfig();
      return c ? { engineId: c.engineId, base: baseOf(c) } : null;
    },
    task: async () => {
      const t = await d.tasks.runningTask();
      if (!t) return null;
      const phase = await d.tasks.openPhase();
      return { ...t, ...(phase ? { phase } : {}) };
    },
    hasNotice,
    engine: getEngine,
    command: async (engine) => hooks.engines?.[engine.id] ?? engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }),
    // The process in Settings › Models (`sidekick` for Sidekick), light by default (plan 3c), resolved when a session
    // opens; a sidekick's own tier (or the routing turn's light one) uses that tier's model instead.
    profile: async (engine, tier, process) => {
      const c = await d.config.load();
      const models = cleanModels(c.models);
      return pickProfile(c.policies?.model, tier ? { engine: engine.id, tier, models } : { engine: engine.id, action: process, manifestTier: "light", models });
    },
    // Outside the base (plan Decision 1), so the task's CLAUDE.md/AGENTS.md never load in a mod's session.
    workDir: (mod, base, id) => sessionWorkDir(app.getPath("userData"), mod, base, id),
    writeBrief: writeSessionBrief,
    open: (o) => new EngineSession(o),
    uiLanguage: async () => languageName((await d.config.load()).language ?? DEFAULT_LANGUAGE),
    // The daily card (sidekick plan Decision 12): the day's note titles in every scope and its tokens, titles only.
    // The task manager can't list open tasks (Open question 7): nothing is open.
    dailyInput: async (base, day) => {
      const scopes = scoped() ? [MAIN_SCOPE, ...(await scopeStoreFor(base).list().catch(() => [])).map((sc) => sc.id)] : [MAIN_SCOPE];
      const notes: string[] = [];
      for (const scope of new Set(scopes)) {
        for (const n of await readNotes(base, notesPrefix(scoped(), scope)).catch(() => [])) {
          if (n.date && localDay(new Date(n.date)) === day) notes.push(n.title);
        }
      }
      return { day, notes, tokens: dayTokens(await new UsageLog(base).load(Infinity), day, localDay), open: [] };
    },
    pickImportFiles: async () => {
      if (!d.window || d.window.isDestroyed()) return [];
      const r = await dialog.showOpenDialog(d.window, { properties: ["openFile", "multiSelections"], filters: [{ name: "Text", extensions: ["md", "txt"] }] });
      return r.canceled ? [] : r.filePaths;
    },
    // The tag key of imported files sources: in userData, where the agent can't reach it (never in the data folder).
    tagKey: (id, create) => sourceTagKey(path.join(app.getPath("userData"), id, "source-key"), create),
    personData,
    // "Save as decision" (sidekick plan Decision 7): a note like any other, written as the person when they press the button.
    saveDecision: async ({ scope, action, title, decision }) => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      const base = baseOf(c);
      const prefix = notesPrefix(scoped(), scope === APP_SCOPE ? MAIN_SCOPE : scope);
      // Never over another note of the scope: numbered (`-2`, `-3`…) like a question's note.
      const exists = (slug: string) => fs.access(path.join(base, prefix, `${slug}.md`)).then(() => true, () => false);
      const first = noteSlug(title);
      let slug = first;
      for (let i = 2; await exists(slug); i++) slug = `${first}-${i}`;
      await writeNote(base, slug, { title, summary: [decision], decisions: [decision], files: [], open: [] }, { ...(action ? { action } : {}), date: new Date().toISOString(), engine: c.engineId }, prefix);
      await saveAppChange(await currentHistory(), ownCommits(), [`${prefix}${slug}.md`], `Note: ${title}`, await d.tasks.trailerNow());
    },
  };
  d.appMods.setCoreApp(core);
  // Board and single mode (parallel spec §9.2): one Attention store per base for the plugins, the waiting tasks and
  // the jobs, with the plugins' tag key (outside every base, P5). A task's items show while it is an open lane; a job's
  // while the harness declares it; the harness tools' item while it has tools (tools Decision 7). Plain mode: none (D0).
  if (hostMode(harness) !== "plain") {
    const stores = attentionStores({ tagKey: (create) => sourceTagKey(path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id, "attention-key"), create), log: pluginLog });
    stores.registerKnown("task", (id) => d.host?.board.laneIds().includes(id) ?? false);
    if (harness.jobs) stores.registerKnown("job", jobOriginKnown(harness.jobs));
    if (hasTools(harness)) stores.registerKnown("tool", (id) => id === harness.id);
    d.sharedAttention = stores;
  }
  // Plugins (plugins spec): only a harness that takes them, or dev folders (HH_PLUGIN_DIRS, development builds). D0:
  // otherwise no scheme, no controller, no window, no IPC handler and no file.
  if (pluginsAccepted(harness) || (hooks.pluginDirs?.length ?? 0) > 0) {
    // Before "ready" (spike S2): the backend windows' own scheme. Nothing else registers one.
    protocol.registerSchemesAsPrivileged(hasTools(harness) ? [MOD_SCHEME, PLUGIN_SCHEME, TOOL_SCHEME] : [MOD_SCHEME, PLUGIN_SCHEME]);
    // The app's own per-harness folder (outside every base, B8/B13): pointers, approvals, keys, the inbox's tag key.
    const appDir = path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id);
    const host = new PluginBackendHost({ resources: shellResources, devTools: !app.isPackaged, electron: { BrowserWindow, session, ipcMain }, log: pluginLog });
    d.pluginHost = host;
    d.pluginStateRoot = path.join(appDir, PLUGIN_STATE_DIR);
    // Board mode: the inbox's store is shared with the waiting tasks (Decision 10). Plain mode passes nothing (D0).
    const attentionShared = d.sharedAttention;
    d.pluginsCtl = new PluginsController({
      harness: { id: harness.id, name: harness.name, root: harness.root, ...(harness.plugins ? { plugins: harness.plugins } : {}), ...(harness.slots ? { slots: harness.slots } : {}) },
      devDirs: hooks.pluginDirs ?? [],
      pointers: new PluginPointers(path.join(appDir, "plugins.json")),
      // Keys only where the OS encrypts them (Decision 17): never in the clear on a Linux without a keyring. The one
      // store, shared with Settings › Connections; never null here (this block runs only when it is built).
      secrets: secretStore()!,
      appDir,
      base: currentBase,
      host,
      fetch: globalThis.fetch,
      exec: {
        resolve: async (cmd) => resolveBinary(cmd, await loginShellPath(commandDeps), commandDeps),
        run: runFile,
        // The controller keeps only PATH, HOME and LANG of this, and sets TERM=dumb (B7).
        env: async () => ({ PATH: await loginShellPath(commandDeps), HOME: os.homedir(), LANG: process.env.LANG ?? "en_US.UTF-8" }),
      },
      userData: app.getPath("userData"),
      // The inbox's HMAC key (Attention review): its own file, not a mod's, where the agent can't reach it.
      tagKey: (create) => sourceTagKey(path.join(appDir, "attention-key"), create),
      ...(attentionShared
        ? {
            attentionStoreFor: (b: string, create: boolean) => attentionShared.forBase(b, create),
            registerKnown: (kind: "plugin", fn: (id: string) => boolean) => attentionShared.registerKnown(kind, fn),
          }
        : {}),
      pickFolder: async () => {
        if (!d.window || d.window.isDestroyed()) return null;
        const r = await dialog.showOpenDialog(d.window, { properties: ["openDirectory"] });
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show();
      },
      whenNoTask: (fn) => d.tasks.whenNoTask(fn),
      // As the settings' (harness-settings D4): only from betweenTasks or a whenNoTask callback; peek, never get.
      refreshInstructions: async () => {
        const board = boardHost();
        if (board) return board.refreshInstructions();
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      runLimitMs: hooks.pluginRunLimitMs ?? 120_000,
      // Mock mode and HH_PLUGIN_FIXTURES: plugins run on their fixtures, never the network or the key store (P10).
      ...(hooks.mock || hooks.pluginFixtures ? { fixtures: true } : {}),
      // `plugin dev` (Decision 22): a dev plugin's dist/ rebuilt → its backend restarts and its panels remount.
      ...(app.isPackaged
        ? {}
        : { watch: (dir: string, onChange: (name: string | null) => void) => watchPluginFolder(dir, onChange, (err) => pluginLog(`Stopped watching ${dir}`, err)) }),
      changed: (view) => {
        sendToWindow("hh:plugins", view);
        // A plugin on, off, added or removed: its searchable records come or go (search spec §7). D0 inside. Any
        // other change (a sync time, an error) leaves them as they are.
        const on = runningPlugins(view);
        if (on !== d.pluginsOn) searchSvc.dataChanged();
        d.pluginsOn = on;
      },
      attentionChanged: (view) => {
        sendToWindow("hh:attention", view);
        d.pluginBadge = view.badge;
        refreshDockBadge();
      },
      surfaceChanged: (view) => sendToWindow("hh:pluginSurface", view),
      panelsNeeded: () => pluginPanels.needed(),
      dataChanged: (plugin, collections) => {
        sendToWindow("hh:pluginData", { plugin, collections });
        searchSvc.dataChanged();
      },
      log: pluginLog,
    });
  }
  // hh-mod (minimal-core 0b2): always, in the one call Electron takes; with plugins or tools, theirs registers it.
  if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0 && !hasTools(harness)) protocol.registerSchemesAsPrivileged([MOD_SCHEME]);
  // Settings › Connections (tools spec §9): only a harness that declares secrets (D0: no channel, no controller).
  if (hasSecrets(harness)) registerConnectionsIpc(handle, connections());
  // Tools (tools spec §4, §5): only a harness that declares them. D0: otherwise no scheme, no window, no IPC handler,
  // no `tools` server and no trace.
  if (hasTools(harness)) {
    // Before "ready". Electron takes one call: with plugins, theirs above registers this scheme too.
    if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0) protocol.registerSchemesAsPrivileged([MOD_SCHEME, TOOL_SCHEME]);
    const sandbox = new ToolHost({ resources: shellResources, devTools: !app.isPackaged, electron: { BrowserWindow, session, ipcMain }, log: toolsLog });
    const toolData = toolDataRequests({
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      history: () => currentHistory(),
      board: ownCommits,
      blocked: () => (d.quitting ? "The app is closing" : turnBlocked()),
      scopeExists: async (id) => (scoped() ? activeScope(id) : id === MAIN_SCOPE),
      // A call in no scope (the UI's with none open, before a task): `_app` with scopes, `main` without.
      noScope: () => (scoped() ? APP_SCOPE : MAIN_SCOPE),
      serial: dataWrites,
    });
    const toolRecordings = mockToolsDir(hooks);
    d.toolsHost = createToolsHost({
      harness,
      base: currentBase,
      references: async () => {
        const c = await validConfig();
        return c ? (await workReferences(c, baseOf(c))).map((r) => ({ id: r.id, path: r.path })) : [];
      },
      userData: app.getPath("userData"),
      // The one key store; a harness with tools but no secrets has no key to read.
      store: secretStore() ?? { harnessValues: async () => ({}) },
      data: toolData,
      exec: {
        resolve: async (cmd) => resolveBinary(cmd, await loginShellPath(commandDeps), commandDeps),
        run: runFile,
        // The tools host keeps only PATH, HOME and LANG of this, and sets TERM=dumb (Decision 6).
        env: async () => ({ PATH: await loginShellPath(commandDeps), HOME: os.homedir(), LANG: process.env.LANG ?? "en_US.UTF-8" }),
      },
      fetch: globalThis.fetch,
      // Public addresses only, on every hop: a tool never reaches this computer or its network.
      allowHost: isPublicHost,
      host: sandbox,
      openScope: () => d.tasks.currentScope(),
      // Board mode: the lane whose slot asks; otherwise the open task (the `main` slot).
      slotTask: (key) => slotTaskOf(d.host ? d.host.lane(key)?.manager : d.tasks),
      jobRun: (key) => d.jobsHost?.runOf(key) ?? null,
      // A call during the task's turn is saved on its reply (tools spec §8.2); otherwise it is only shown.
      emitToTask: (task, event) => {
        if (d.host) {
          const lane = d.host.lane(task);
          if (lane && !lane.controller.addToTurn(task, event)) lane.emit(event);
          return;
        }
        if (turns.addToTurn(task, event)) return;
        void d.tasks.runningTask().then((t) => {
          if (t?.id === task) emit(event);
        });
      },
      changed: () => {
        if (d.toolsHost) sendToWindow(TOOLS_CHANGE_CHANNEL, d.toolsHost.info());
      },
      // Off after repeated crashes (Decision 7): an action item in the base's shared Attention store, when the app has
      // one. Without one, only the chat's top line says so.
      ...(d.sharedAttention
        ? {
            attention: async (create: boolean) => {
              const base = await currentBase().catch(() => null);
              return base && d.sharedAttention ? d.sharedAttention.forBase(base, create) : null;
            },
          }
        : {}),
      serverEntry: path.join(here, "tools-server.js"),
      // The `pre` and `expects-miss` rows (tools spec §6); written only when an action declares them.
      usage: async (record) => {
        const c = await validConfig();
        if (c) await new UsageLog(baseOf(c)).append(record);
      },
      engine: async () => (await d.config.load()).engineId ?? "",
      scoped,
      // Mock mode replaying recordings (`dev --mock`, tools spec §12): tools run for real, their fetch and exec answer
      // from <recordings>/tools/<tool>/, keys are fixture-<id>. When that applies: mockToolsDir (test-hooks.ts).
      // Otherwise the real transport (D0).
      ...(toolRecordings ? { mock: { dir: toolRecordings } } : {}),
      log: toolsLog,
    });
    registerToolsIpc(handle, d.toolsHost);
  }
  // Only a harness with setup steps gets the controller: its reads may write `.harness/setup.json` (setup-steps D0).
  if (harness.setup) {
    const settings = d.settingsCtl;
    d.setupCtl = new SetupSteps({
      steps: harness.setup,
      data: harness.data,
      ...(harness.settings ? { settings: harness.settings } : {}),
      base: async () => {
        const c = await validConfig();
        return c ? baseOf(c) : null;
      },
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: <collection>` commit.
      write: (request) => personData(request, { scope: APP_SCOPE }),
      ...(settings ? { setSetting: (field: string, value: unknown) => settings.set(field, value), settingValues: () => settings.values() } : {}),
      openAction: async () => (await d.tasks.runningTask())?.action,
      // A folder that ran tasks before these steps existed counts as set up (spec §8 Q3).
      ranBefore: (base) => fs.access(tasksFile(base)).then(() => true, () => false),
      // A connect step is done once its secrets are set (tools spec §9); the schema gives one only with `secrets`.
      ...(hasSecrets(harness) ? { secretsSet: (ids: readonly string[]) => connections().allSet(ids) } : {}),
      quitting: () => d.quitting,
      changed: (state) => sendToWindow("hh:setupSteps", state),
    });
  }
  // Only a harness with profiles gets the controller: it reads and writes `<folder>/.harness/profiles.json` (D4).
  if (harness.profiles && Object.hasOwn(harness.data, PROFILE_COLLECTION)) {
    d.profilesCtl = new Profiles({
      root: async () => (await d.config.load()).folder ?? null,
      active: async () => (await d.config.load()).profile,
      collection: harness.data[PROFILE_COLLECTION],
      ...(harness.folder.seed ? { seed: resolveInHarness(harness, harness.folder.seed) } : {}),
      // As the person, app-wide, in the new profile's own store. It has no history yet: its runtime's "Start" records it.
      writeRecord: async (base, record) => void (await dataStoreFor(base).put(PROFILE_COLLECTION, record, { who: "person", scope: APP_SCOPE })),
      readRecord: (base) => dataStoreFor(base).get(PROFILE_COLLECTION, undefined, { who: "person", scope: APP_SCOPE }),
      fields: harness.profiles.fields,
      // As the person, app-wide, in the active profile's store: its checks and its `Data: profile` commit.
      writeActive: async (record) => void (await personData({ op: "put", collection: PROFILE_COLLECTION, record }, { scope: APP_SCOPE })),
      switchTo: (target) => switches.run(target),
      trash: (p) => shell.trashItem(p),
      historyDir: (folder) => historyDir(app.getPath("userData"), folder),
      // Profile ids are reused names: the search index is keyed by the folder's path, so a deleted one's must go.
      forget: (folder) => searchSvc.discard(folder),
      changed: (state) => sendToWindow("hh:profiles", state),
      blocked: hold.profileChangeBlocked,
    });
  }
  d.materialSvc = await buildMaterial({
    harness: () => harness,
    config: () => d.config,
    validConfig,
    baseOf,
    scoped,
    activeScope,
    pickFiles: async () => {
      if (!d.window || d.window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(d.window, { properties: ["openFile", "multiSelections"] });
      return r.canceled ? null : r.filePaths;
    },
    send: sendToWindow,
    kick: kickMaterial,
    currentHistory,
    ownCommits,
    trailerNow: () => d.tasks.trailerNow(),
    here,
    stageDeps: materialStageDeps,
    trash: (file) => shell.trashItem(file),
    dataStoreFor,
  });
  // The AI stages start only when no turn, task operation, hold, move or quit is under way.
  d.materialJobs = d.materialSvc
    ? buildMaterialJobs(d.materialSvc, () => !d.quitting && d.moving === null && !d.tasks.isBusy() && hold.turnBlocked() === null && !hold.folderBusy())
    : null;
  d.translation = buildTranslation({
    userData: app.getPath("userData"),
    ...(harness.tone ? { tone: harness.tone } : {}),
    config: () => d.config,
    mock: hooks.mock === true,
    translateEngine,
    command: async (engine) => hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }).catch(() => null)),
    pickProfile,
    validConfig,
    baseOf,
    serverEntry: path.join(here, "translate-server.js"),
    send: (state) => sendToWindow("hh:language", state),
  });
}

/** The primary instance (it holds the single-instance lock): "ready", the window, and the quit. */
export function onPrimary(d: LifecycleDeps): void {
  const { PAPER, QUIT_TEST_WAIT_MS, activeScope, announceCommits, backendReady, checkTurn, closeRuntime, createWindow, currentBase, currentHistory, dropRuntime, emit, flushTurns, guards, harnessDir, hooks, interruptTasks, jobsReady, jobsWiring, kickMaterial, modsView, notifications, offered, plainTasks, pluginLog, prepareEngine, registerIpc, restores, runtime, runtimeOptions, safeMode, scoped, scopesChanged, searchSvc, sendToWindow, setDockBadge, settleScopes, shellResources, showNotice, singleMainSlot, singleParts, startHomeHistory, startModHost, taskDeps, taskStoreOptions, toolsLog, turnChatLog, turnDeps, turns, validConfig, watchUserLayouts, watchUserMods } = d;
  const harness = d.harness;
  app.on("second-instance", () => {
    if (!d.window || d.window.isDestroyed()) return;
    if (d.window.isMinimized()) d.window.restore();
    d.window.focus();
  });

  app.whenReady().then(async () => {
    // Test background mode: no Dock icon, so the run never shows up beside the person's own apps.
    if (hooks.background && process.platform === "darwin") app.dock?.hide();
    // Development builds: the harness's logo in the Dock, else Human Harness's (packages/shell/resources).
    if (process.platform === "darwin" && !app.isPackaged) {
      const icon = devDockIcon(
        [() => (harness.logo ? resolveInHarness(harness, harness.logo) : undefined), () => path.join(shellResources, "hh-logo.png")],
        (file) => nativeImage.createFromPath(file),
      );
      if (icon && !hooks.background) app.dock?.setIcon(icon);
    }
    d.config = new ConfigStore(app.getPath("userData"));
    d.jobSettings = (await d.config.load()).jobs;
    // A folder move cut short by a quit or crash: finish or undo it before anything opens the folder or its history.
    const userData = app.getPath("userData");
    const recovered = await recoverMove({
      journal: moveJournal(userData),
      currentFolder: async () => (await d.config.load()).folder,
      historyDir: (folder) => historyDir(userData, folder),
    }).catch((err: unknown) => {
      console.error("Could not settle an interrupted folder move", err);
      return null;
    });
    if (recovered?.leftBehind) console.error(`An interrupted folder move kept the old folder at ${recovered.leftBehind}`);
    d.shared = new SharedConfigStore(hooks.sharedDir ?? sharedConfigDir());
    // A harness that declares `parallel` runs the board (D7); any other keeps today's single task.
    if (hostMode(harness) === "board") {
      const board = buildBoardHost(
        {
          harness: () => harness,
          config: () => d.config,
          currentBase,
          taskStoreOptions,
          prepareEngine,
          runtimeOptions,
          jobsHost: () => d.jobsHost,
          announceCommits,
          kickMaterial,
          turnDeps,
          checkTurn,
          restoreBlocked: () => restores.turnBlocked(),
          turnChatLog,
          taskDeps,
          scoped,
          activeScope,
          emit,
          send: sendToWindow,
          currentHistory,
          attention: () =>
            (d.taskAttention = buildTaskAttention({
              currentBase,
              sharedAttention: () => d.sharedAttention,
              badge: setDockBadge,
              notify: ({ title, body }, onClick) => {
                if (!Notification.isSupported()) return;
                const n = keepNotification(new Notification({ title, body }), notifications);
                n.on("click", onClick);
                n.show();
              },
              showWindow: () => {
                if (d.window && !d.window.isDestroyed()) {
                  if (d.window.isMinimized()) d.window.restore();
                  d.window.show();
                  d.window.focus();
                }
              },
              focusTask: (id) => d.host?.board.focus(id),
              notifyOn: async () => (await d.config.load()).notifyWaiting === true,
              windowFocused: () => (d.window && !d.window.isDestroyed() ? d.window.isFocused() : false),
              otherCount: () => d.pluginBadge + d.jobBadge,
            })),
        },
        await d.config.load(),
      );
      d.host = board;
      d.tasks = board.board;
    }
    // Jobs (part 3): beside the board's lanes, or beside the single task (Decision 12). Without jobs, nothing (D0).
    if (hasJobs(harness)) {
      const board = d.host;
      d.jobsHost = board
        ? buildJobsHost(jobsWiring(), board.gate, async () => {
            const ws = await board.workspace();
            if (!ws) throw new Error("The engine isn't installed");
            return ws;
          })
        : buildSingleJobs(
            jobsWiring(),
            {
              mainSlot: singleMainSlot,
              turns,
              emit,
              workspace: async () => {
                const rt = await runtime.get();
                const parts = rt ? singleParts.get(rt) : undefined;
                if (!parts) throw new Error("The engine isn't installed");
                return parts.workspace;
              },
              setSingle: (s) => (d.single = s),
            },
            await d.config.load(),
          );
    }
    // `humanharness dev --engine <id>`: a fresh app starts with that engine chosen (development builds only).
    const preselect = devEngine(process.env, app.isPackaged, offered().map((e) => e.id));
    if (preselect && !(await d.config.load()).engineId) await d.config.save({ engineId: preselect });
    d.references = resolveReferences(harness.folder.references, { harnessDir: harnessDir, home: os.homedir(), packaged: app.isPackaged });
    nativeTheme.themeSource = (await d.config.load()).appearance ?? "system";
    nativeTheme.on("updated", () => d.window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light));
    // A profile the registry no longer lists (or lists as archived) is not active: Home asks who is using the app.
    // Before setup.json is recorded, so nothing is written into a profile that is gone.
    const saved = await d.config.load();
    if (d.profilesCtl && saved.profile && !(await d.profilesCtl.openable(saved.profile).catch(() => false))) {
      await d.config.setProfile(undefined).catch((err: unknown) => console.error("Could not clear the active profile", err));
    }
    // Before any task: a configured folder with no setup.json is recorded now, fresh or as set up before (D0: no `setup`, nothing).
    await recordSetup(d.setupCtl, async () => (await validConfig()) !== null);
    // The home folder's read-only layers (minimal-core spec §5.1), every start, before the host resolves the mods.
    await writeLayers({
      home: appHome(userData, harness.id),
      core: { mods: Object.fromEntries(Object.entries(CORE_MODS).map(([id, m]) => [id, m.dir])), layouts: {}, layoutTexts: { main: `${JSON.stringify(defaultLayoutJson, null, 2)}\n` } },
      harness: await harnessLayer(harness.root, Object.keys(harness.mods ?? {}).filter((id) => !Object.hasOwn(CORE_MODS, id))),
      notice: showNotice,
      // The folder's manual, AGENTS.md and hh.d.ts (0b2), rewritten every start.
      manual: manualFiles(),
    });
    // Safe mode at start (0b2): `--safe` or HH_SAFE=1, before the host so no local mod runs.
    if (safeAtStart(process.argv, process.env)) await safeMode(false).catch((err: unknown) => console.error("Could not enter safe mode", err));
    // The home folder's history (0b2): what changed while the app was closed is committed, then every quiet change.
    await startHomeHistory().catch((err: unknown) => console.error("Could not start the home folder's history", err));
    // The mods (minimal-core spec §4): a host only when some mod could run (D0); before the IPC, so the first send meets it.
    await startModHost().catch((err: unknown) => console.error("Could not start the mods", err));
    // The home folder's mods/ (0b2): an edit syncs and reloads the user mod live.
    watchUserMods();
    // The home folder's layouts/ and settings.json (0b2): an edit or a pick redraws the window.
    watchUserLayouts();
    registerIpc();
    // A task left open by an earlier run can't continue: its session is gone.
    void interruptTasks().catch((err: unknown) => console.error("Could not settle the last task", err));
    // After the interrupt (queued behind it): a scoped harness's earlier work moves into `main`.
    void settleScopes()
      .then(scopesChanged)
      .catch((err: unknown) => console.error("Could not prepare the scopes", err));
    // Material an earlier run left converting (a quit or crash mid-way) is converted again; other bases (profiles)
    // resume the first time they are used. Without material there is nothing (D0).
    void d.materialSvc?.settle().catch((err: unknown) => console.error("Could not resume the material", err));
    // AI stages an earlier run left to do (the queue looks only once the app is set up).
    if (await validConfig()) kickMaterial();
    await createWindow();
    // The control channel (0b2): `humanharness status` and `shot` reach the app through app/.control.json.
    const controlHome = appHome(userData, harness.id);
    void startControl({
      home: controlHome,
      window: () => d.window,
      status: async () => {
        const layout = await shownLayout(controlHome);
        return { ...(await modsView()), layout: { name: layout.name, source: layout.source, problems: layout.problems } };
      },
    })
      .then((c) => {
        // A quit that came first: the channel closes at once.
        if (d.quitting) void c.stop();
        else d.control = c;
      })
      .catch((err: unknown) => console.error("Could not start the control channel", err));
    // The plugins of the current base (none before setup); a computer that slept runs the sources that came due.
    if (d.pluginsCtl) {
      const plugins = d.pluginsCtl;
      void plugins.start().catch((err: unknown) => pluginLog("Could not start the plugins", err));
      powerMonitor.on("resume", () => plugins.resumed());
    }
    // The tools host window, warm from now (Decision 7). Without tools, nothing (D0).
    void d.toolsHost?.start().catch((err: unknown) => toolsLog("Could not start the tools", err));
    // Jobs: the `start` runs and `every` timers, once the app is set up (now, or when setup or a profile finishes).
    void jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
    // The harness's backend, the same moment (hatches Decision 5). Without one, nothing (D0).
    void backendReady().catch((err: unknown) => console.error("Could not start the backend", err));
    // A packaged app checks GitHub Releases at start and every 6 hours; a dev run never does.
    if (app.isPackaged) void startPackagedUpdater((m, err) => console.error(m, err)).then((stop) => { stopUpdater = stop; }, (err: unknown) => console.error("Could not start the updater", err));
  });

  let stopUpdater: () => void = () => undefined;

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (d.quitting) return;
    d.quitting = true;
    event.preventDefault();
    stopUpdater();
    // Jobs (Decision 11): no run starts from now on; the running ones are cancelled, the queued ones dropped.
    d.jobsHost?.stopAll();
    d.single?.gate.dropAll();
    // Board mode: every lane's turn stops now and its slot closes (Decision 16); never an interrupt, which would reopen them.
    const boardClosed = d.host?.closeAll().catch((err: unknown) => console.error("Could not close the open tasks", err));
    if (!d.host) {
      plainTasks.close();
      turns.close();
    }
    // The mods stop (their disposers run) before the app goes; the home folder is no longer watched.
    d.userLayerWatch?.close();
    d.userLayerWatch = null;
    d.layoutsWatch?.close();
    d.layoutsWatch = null;
    d.homeHistory?.close();
    const modsStopped = d.modHost?.stop().catch((err: unknown) => console.error("Could not stop the mods", err));
    // The control channel closes and app/.control.json goes.
    const controlStopped = d.control?.stop().catch((err: unknown) => console.error("Could not stop the control channel", err));
    d.control = null;
    // The test prompt cleans up (its CLI, its temporary folder) before the app goes; bounded wait.
    const testStopped = Promise.race([guards.close(), new Promise<void>((r) => setTimeout(r, QUIT_TEST_WAIT_MS))]);
    const setupStopped = d.setupRun ? stopSetupProcess(d.setupRun) : Promise.resolve();
    void (async () => {
      // A folder move under way finishes (or undoes itself) first: it is never cut short on purpose.
      await d.moving?.catch(() => undefined);
      await Promise.all([setupStopped, testStopped, modsStopped, controlStopped]);
      // Every plugin backend stops (and its window closes) before the agent goes.
      await d.pluginsCtl?.stop().catch((err: unknown) => pluginLog("Could not stop the plugins", err));
      await d.pluginHost?.stopAll().catch((err: unknown) => pluginLog("Could not close the plugin windows", err));
      // The tools host window closes; a call still running fails "Tools stopped".
      d.toolsHost?.stop();
      // The backend stops for good (SIGTERM, SIGKILL after 3 s) before the agent goes; nothing starts it again.
      await d.backend?.stop({ quit: true }).catch((err: unknown) => console.error("Could not stop the backend", err));
      // A translation run stops; the batches it saved stay.
      await d.translation?.stop().catch((err: unknown) => console.error("Could not stop the translation", err));
      try {
        if (boardClosed) await boardClosed;
        await (d.host ? closeRuntime() : dropRuntime());
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await flushTurns();
      await flushFileIndexes();
      await searchSvc.flush().catch(() => undefined);
    })().finally(() => app.quit());
  });
}
