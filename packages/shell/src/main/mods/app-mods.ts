import { promises as fs } from "node:fs";
import path from "node:path";
import { type BrowserWindow, app, dialog } from "electron";
import type { ModelProfile } from "@humanharness/engines";
import { getEngine } from "@humanharness/engines";
import { type LoadedHarness, hasEnginePresets } from "@humanharness/harness-sdk";
import { modJsonSchema } from "@humanharness/mod-sdk";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import type { PickInput } from "@humanharness/policies";
import type { ConfiguredApp, ModsConfig, ModsView } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { SidekickSession } from "@humanharness/runtime";
import { MAIN_SCOPE, notesPrefix, readNotes } from "@humanharness/workspace";
import { type ConfigStore, historyDir } from "../config";
import { engineCommand, type CommandDeps } from "../engine-command";
import { cleanModels } from "../models";
import type { TaskManager } from "../task-manager";
import type { TestHooks } from "../test-hooks";
import { UsageLog, modRecord } from "../usage-log";
import { type ModsSettings, cleanModsConfig } from "./config";
import { CORE_MODS } from "./core-mods";
import { HomeHistory } from "./home-history";
import { ModHost } from "./host";
import { shownLayout } from "./layout";
import type { ModsIpcDeps } from "./mods-ipc";
import { type ResolveProblem, type ResolvedMod, resolveMods } from "./resolve";
import { enterSafeMode } from "./safe";
import { type ServiceDeps, appHome, buildServices } from "./services";
import { ModBuilds, UserLayer, modBuildRoot, userConsent, userModFolders, userModsDir, watchLayouts, watchUserLayer, writeMainShims } from "./user-layer";
import { needsHost } from "./wiring";

/** What the mods' wiring reads from the main entry. Getters for what changes after it is built. */
export interface AppModsDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  hooks: TestHooks;
  commandDeps: CommandDeps;
  window(): BrowserWindow | null;
  tasks(): Pick<TaskManager, "runningTask">;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  scoped(): boolean;
  hasNotice(engineId: string): Promise<boolean>;
  pickProfile(policyId: string | undefined, input: Omit<PickInput, "offer">): Promise<ModelProfile>;
  showNotice(text: string): void;
  sendToWindow(channel: PushChannel, value: unknown): void;
}

/** The mods' state the main entry reads (and its quit closes). */
export interface AppModsState {
  /** The mod host (minimal-core spec §4); null with no mod that could run (D0). */
  modHost: ModHost | null;
  /** Folders `resolveMods` couldn't read as mods, for Settings › Mods (the user layer keeps its own). */
  modProblems: ResolveProblem[];
  /** The home folder's `mods/` as the host runs them (minimal-core 0b2); null without a host. */
  userLayer: UserLayer | null;
  /** The watcher on the home folder's `mods/`; closed on quit. */
  userLayerWatch: { close(): void } | null;
  /** The watch on the home folder's `layouts/` and `settings.json` (0b2). */
  layoutsWatch: { close(): void } | null;
  /** The home folder's own history (0b2): every change to `mods/`, `layouts/` and `settings.json`, undoable. */
  homeHistory: HomeHistory | null;
  /** Safe mode was entered this run (the escape hatch, `--safe` or HH_SAFE=1): the window shows its notice. */
  safeEntered: boolean;
  /** The last resolved mods: their data folders stay out of the work-folder history unless a mod asks (spec §4.1). */
  resolvedMods: ResolvedMod[];
}

/** The mod host, the home folder's mods, layouts and history, safe mode and Settings › Mods (minimal-core spec). */
export function createAppMods(d: AppModsDeps) {
  const { hooks, commandDeps, validConfig, baseOf, sendToWindow, showNotice } = d;
  const state: AppModsState = {
    modHost: null,
    modProblems: [],
    userLayer: null,
    userLayerWatch: null,
    layoutsWatch: null,
    homeHistory: null,
    safeEntered: false,
    resolvedMods: [],
  };
  const home = () => appHome(app.getPath("userData"), d.harness().id);

  /** What Settings › Mods shows: every resolved mod (none without a host, D0) and the folders that couldn't be read. */
  const modsView = async (): Promise<ModsView> => ({
    mods: state.modHost?.view() ?? [],
    problems: [...state.modProblems, ...(state.userLayer?.problems() ?? [])],
  });

  /** A mod's own tool-less engine turn (minimal-core spec §5), on SidekickSession like Sidekick's; usage tagged `mod:<id>`. */
  const modEngineRun: ServiceDeps["engineRun"] = async ({ process: proc, tier, prompt, workDir, signal }) => {
    const c = await validConfig();
    if (!c) return { ok: false, text: "", error: "not set up" };
    if (!(await d.hasNotice(c.engineId))) return { ok: false, text: "", error: "the engine notice is not accepted" };
    const engine = getEngine(c.engineId);
    const cmd = hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(d.harness()) }).catch(() => null));
    if (!cmd) return { ok: false, text: "", error: "the engine isn't installed" };
    const saved = await d.config().load();
    const profile = await d.pickProfile(saved.policies?.model, { engine: engine.id, tier, models: cleanModels(saved.models) });
    await fs.mkdir(workDir, { recursive: true });
    const session = new SidekickSession({ engine, command: cmd.command, env: cmd.env, folder: workDir, profile });
    try {
      const a = await session.ask(prompt, signal ?? new AbortController().signal);
      if (a.usage) {
        const record = modRecord({ engine: engine.id, process: proc as `mod:${string}`, profile, ok: a.ok, usage: a.usage, ...(a.limits ? { limits: a.limits } : {}) });
        await new UsageLog(baseOf(c)).append(record).catch((err: unknown) => console.error("Could not record the mod's turn", err));
      }
      return a.ok ? { ok: true, text: a.text } : { ok: false, text: "", error: a.error ? (a.error.detail ?? a.error.code) : "failed" };
    } finally {
      await session.close();
    }
  };

  /** Reads the mods again and builds the host when some mod could run (D0); without one, `modHost` stays null. */
  async function startModHost(): Promise<void> {
    const harness = d.harness();
    const modsConfig = (await d.config().load()).mods;
    const local = modsConfig?.local ?? [];
    const userData = app.getPath("userData");
    const home = appHome(userData, harness.id);
    const user = await userModFolders(home);
    if (!needsHost({ declared: harness.mods, local: [...local, ...user], coreIds: Object.keys(CORE_MODS) })) {
      state.resolvedMods = [];
      state.modProblems = [];
      state.userLayer = null;
      return;
    }
    const resolved = await resolveMods({ declared: harness.mods, harnessModsDir: path.join(harness.root, "mods"), local, user, core: CORE_MODS });
    for (const p of resolved.problems) console.error(`Mod ${p.id}: ${p.reason}`);
    state.resolvedMods = resolved.mods;
    // The user layer's folders that couldn't be read are its own (they come and go with the watcher).
    state.modProblems = resolved.problems.filter((p) => path.dirname(p.id) !== userModsDir(home));
    // A user-layer mod's main imports the app's own zod and mod-sdk, through small files beside its builds.
    const buildRoot = modBuildRoot(userData, harness.id);
    const resolveShared = await writeMainShims(path.join(buildRoot, ".shared"), MAIN_SHARED_MODULES);
    const runningTask = async () => {
      const t = await d.tasks().runningTask();
      return t ? { id: t.id, scope: t.scope, ...(t.action ? { action: t.action } : {}) } : null;
    };
    const mods = new ModHost({
      config: {
        load: async () => (await d.config().load()).mods,
        saveFailed: (id, reason) => saveMods((m) => ({ ...m, failed: { ...m?.failed, [id]: reason } })),
      },
      services: buildServices({
        harnessId: harness.id,
        userData: app.getPath("userData"),
        base: async () => {
          const c = await validConfig();
          return c ? baseOf(c) : null;
        },
        engineRun: modEngineRun,
        runningTask,
        noteTitles: async (scope) => {
          const c = await validConfig();
          return c ? (await readNotes(baseOf(c), notesPrefix(d.scoped(), scope ?? MAIN_SCOPE)).catch(() => [])).map((n) => n.title) : [];
        },
        notify: showNotice,
      }),
      notice: showNotice,
      changed: () => void modsView().then((v) => sendToWindow("hh:modsChanged", v)),
      // A user-layer mod rebuilt after an edit: the window imports its ui again (hh:modReloaded, 0b2).
      reloaded: (id, version) => sendToWindow("hh:modReloaded", { id, version }),
      builds: new ModBuilds(buildRoot, resolveShared),
    });
    state.modHost = mods;
    state.userLayer = new UserLayer({ home, host: mods, mods: resolved.mods, problems: resolved.problems, changed: () => void modsView().then((v) => sendToWindow("hh:modsChanged", v)) });
    await mods.start(resolved.mods);
  }

  /** Watches the home folder's `mods/` once: a change syncs the folder with whatever host runs now. */
  function watchUserMods(): void {
    if (state.userLayerWatch) return;
    state.userLayerWatch = watchUserLayer(home(), (dir) => void state.userLayer?.sync(dir));
  }

  /** Watches the home folder's layouts and pick once: a change sends the layout to show now (hh:layoutChanged, 0b2). */
  function watchUserLayouts(): void {
    if (state.layoutsWatch) return;
    const dir = home();
    state.layoutsWatch = watchLayouts(dir, () => {
      void shownLayout(dir)
        .then((v) => sendToWindow("hh:layoutChanged", v))
        .catch((err: unknown) => console.error("Could not read the layout again", err));
    });
  }

  /** config.json's `mods`, read and saved for the safe mode and the user layer's consent. */
  const modsSettings = {
    load: async () => (await d.config().load()).mods as ModsSettings | undefined,
    save: async (m: ModsSettings | undefined) => void (await d.config().save({ mods: cleanModsConfig(m) })),
  };

  /**
   * Safe mode (0b2): the layout pick goes and every local mod (the home folder's and the added folders) is set off; with
   * a running host, it restarts. The window gets the layout and shows the notice. At start it runs before the host.
   */
  async function safeMode(running: boolean): Promise<void> {
    const dir = home();
    const { layout } = await enterSafeMode({
      home: dir,
      folders: [...((await d.config().load()).mods?.local ?? []), ...(await userModFolders(dir))],
      mods: modsSettings,
    });
    state.safeEntered = true;
    if (running) await restartModHost();
    sendToWindow("hh:layoutChanged", layout);
    sendToWindow("hh:safeModeEntered", true);
  }

  /** The home folder's history (0b2): made once, then every quiet change is committed; Settings › Mods hears each. */
  async function startHomeHistory(): Promise<void> {
    const userData = app.getPath("userData");
    const dir = appHome(userData, d.harness().id);
    const h = new HomeHistory(dir, historyDir(userData, dir));
    await h.init();
    h.onChange((c) => sendToWindow("hh:homeHistoryChanged", c));
    h.watch();
    state.homeHistory = h;
  }

  /** Stops the host and builds it again from config.json (a local mod added or removed). */
  async function restartModHost(): Promise<void> {
    const old = state.modHost;
    state.modHost = null;
    await old?.stop().catch((err: unknown) => console.error("Could not stop the mods", err));
    await startModHost();
    sendToWindow("hh:modsChanged", await modsView());
  }

  /** Changes config.json's `mods` (cleaned, so an empty one goes away). */
  async function saveMods(fn: (m: ModsConfig | undefined) => ModsConfig | undefined): Promise<void> {
    const config = d.config();
    await config.save({ mods: cleanModsConfig(fn((await config.load()).mods)) });
  }

  /**
   * An id a local folder can't take: a resolved mod's, or one the manifest declares or the core ships even when it
   * couldn't be read (its `on` switch is that mod's).
   */
  const modIdTaken = (id: string): boolean =>
    state.resolvedMods.some((m) => m.json.id === id) ||
    Object.hasOwn(d.harness().mods ?? {}, id) ||
    Object.hasOwn(CORE_MODS, id) ||
    (state.modHost?.has(id) ?? false);

  /** The id in a folder's mod.json, or null when it has none. */
  async function modIdIn(folder: string): Promise<string | null> {
    try {
      return modJsonSchema.parse(JSON.parse(await fs.readFile(path.join(folder, "mod.json"), "utf8"))).id;
    } catch {
      return null;
    }
  }

  /** Settings › Mods (minimal-core spec §4, §6): with or without a host, so the page always answers (empty). */
  const modsIpcDeps = (): ModsIpcDeps => ({
    view: modsView,
    // A mod in the home folder's `mods/`: turned on the first time only through the warning (spec D2, `mods.trusted`).
    ...userConsent({
      config: modsSettings,
      host: { set: async (id, on) => state.modHost?.set(id, on) },
      layer: { dirOf: (id) => state.userLayer?.dirOf(id) },
    }),
    set: async (id, on) => {
      // Turning a mod on clears its three-strikes failure.
      await saveMods((m) => ({ ...m, on: { ...m?.on, [id]: on }, ...(on && m?.failed ? { failed: Object.fromEntries(Object.entries(m.failed).filter(([k]) => k !== id)) } : {}) }));
      await state.modHost?.set(id, on);
    },
    pickFolder: async () => {
      const window = d.window();
      if (!window || window.isDestroyed()) return null;
      const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    // The person confirmed the warning: the mod starts on.
    addLocal: async (folder) => {
      // Read again (the folder may have changed since the review); a taken id never reaches config.json.
      const id = await modIdIn(folder);
      if (!id) throw new Error("This folder has no valid mod.json");
      if (modIdTaken(id)) throw new Error(`A mod with the id "${id}" is already in this app`);
      await saveMods((m) => ({
        ...m,
        local: [...new Set([...(m?.local ?? []), folder])],
        on: { ...m?.on, [id]: true },
        failed: Object.fromEntries(Object.entries(m?.failed ?? {}).filter(([k]) => k !== id)),
      }));
      await restartModHost();
    },
    removeLocal: async (id) => {
      const dir = state.resolvedMods.find((m) => m.json.id === id && m.shipped === "local")?.dir;
      const drop = <T>(r: Record<string, T> | undefined) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => k !== id));
      await saveMods((m) => ({ ...m, local: (m?.local ?? []).filter((f) => f !== dir), on: drop(m?.on), failed: drop(m?.failed) }));
      await restartModHost();
    },
    // A user-layer mod goes by deleting its folder, not from config.json's `local`.
    isLocal: (id) => state.resolvedMods.some((m) => m.json.id === id && m.shipped === "local" && !m.user),
    taken: modIdTaken,
  });

  return {
    state,
    modsView,
    modEngineRun,
    startModHost,
    watchUserMods,
    watchUserLayouts,
    safeMode,
    startHomeHistory,
    restartModHost,
    saveMods,
    modIdTaken,
    modIdIn,
    modsIpcDeps,
  };
}
