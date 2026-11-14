import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEngine } from "@humanharness/engines";
import type { AppState, ConfiguredApp, FolderPick, MoveResult } from "@humanharness/protocol";
import { type History, profileDir } from "@humanharness/workspace";
import type { BrowserWindow, Dialog } from "electron";
import { type ConfigStore, historyDir } from "./config";
import { type GuardedMoveDeps, type MoveDeps, guardedMove, moveFolder, moveJournal, precheckMove } from "./move-folder";
import type { Profiles } from "./profiles";
import { checkFolder } from "./validate";

export interface FolderIpcDeps {
  window(): BrowserWindow | null;
  config(): ConfigStore;
  quitting(): boolean;
  /** The profiles, or null without them. */
  profilesCtl(): Profiles | null;
  /** The plugins, or null without them. */
  pluginsCtl(): { stop(): Promise<void> } | null;
  /** The harness's backend, or null without one. */
  backend(): { stop(): Promise<void> } | null;
  /** Board mode's host, or null. */
  host(): { board: { checkpointAllBeforeMove(): Promise<void>; moveEnded(): void } } | null;
  /** The open task(s): a TaskManager, or board mode's TaskBoard. */
  tasks(): { resumeFromNotes(): Promise<void> };
  /** The folder move running now, or null. */
  moving(): Promise<unknown> | null;
  setMoving(run: Promise<unknown> | null): void;
  setHistoryHeld(held: boolean): void;
  pluginStateRoot(): string | null;
  userData(): string;
  dialog: Pick<Dialog, "showOpenDialog">;
  shell: { openPath(p: string): Promise<string>; trashItem(p: string): Promise<void> };
  guards: GuardedMoveDeps["guards"];
  folderBusy(): boolean;
  plainTasks: { checkpointBeforeMove(): Promise<void> };
  restores: { settled(): Promise<unknown> };
  documentSessions: { closeAll(): void };
  searchSvc: { discard(base: string): Promise<void> };
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  standaloneHistory(key: string): Promise<History>;
  openHistory(): Promise<History | null>;
  flushTurns(): Promise<void>;
  flushFileIndexes(): Promise<void>;
  closeRuntime(): Promise<void>;
  pluginLog(message: string, err?: unknown): void;
  rebasePlugins(): Promise<void>;
  backendRebase(): Promise<void>;
  appState(): Promise<AppState>;
  dropDataStoresUnder(root: string): void;
}

/** The app's folder: picking one, showing it, and moving it (spec 3d). */
export function folderIpc(d: FolderIpcDeps) {
  const {
    dialog,
    shell,
    guards,
    plainTasks,
    restores,
    documentSessions,
    searchSvc,
    validConfig,
    baseOf,
    standaloneHistory,
    openHistory,
    flushTurns,
    flushFileIndexes,
    closeRuntime,
    pluginLog,
    rebasePlugins,
    backendRebase,
    appState,
    dropDataStoresUnder,
  } = d;
  return {
    "hh:pickFolder": async (defaultPath: string) => {
      const result = await dialog.showOpenDialog(d.window()!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
      const folder = result.canceled ? undefined : result.filePaths[0];
      if (!folder) return null;
      return { folder, problem: await checkFolder(folder, os.homedir()) } satisfies FolderPick;
    },
    "hh:revealFolder": async () => {
      const c = await validConfig();
      if (c) await shell.openPath(c.folder);
    },
    // Spec 3d §2: refused while a turn or a restore runs; turns and restores are held off until it is over.
    "hh:moveFolder": async (to: unknown): Promise<MoveResult> => {
      if (d.quitting()) throw new Error("The app is closing");
      if (typeof to !== "string" || !path.isAbsolute(to) || to.length > 1000 || to.includes("\0")) return { ok: false, error: "unsuitable" };
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      const userData = d.userData();
      // Read without creating a history: a folder that has none yet has no tracked files.
      const hasHistory = (folder: string) => fs.access(historyDir(userData, folder)).then(() => true, () => false);
      // With profiles every profile's history moves with the folder (spec §4); without them, the folder's own (D0).
      const people = d.profilesCtl();
      const profileIds = async () => (people ? (await people.state()).list.map((p) => p.id) : []);
      const pluginStateRoot = d.pluginStateRoot();
      const deps: MoveDeps = {
        check: (folder) => checkFolder(folder, os.homedir()),
        tracked: people
          ? async () => {
              // Every profile's tracked files, relative to the app's folder. The runtime is closed by now
              // (`guardedMove` closes it before `move()`), so each history is opened on its own.
              const extra = getEngine(c.engineId).instructionsFile?.path;
              const ignore = [".harness/", "AGENTS.md", ...(extra ? [extra] : [])];
              const out: string[] = [];
              for (const id of await profileIds()) {
                const folder = profileDir(c.folder, id);
                if (!(await hasHistory(folder))) continue;
                const history = await standaloneHistory(JSON.stringify({ folder, ignore }));
                out.push(...(await history.trackedFiles()).map((f) => `${id}/${f}`));
              }
              return out;
            }
          : async () => ((await hasHistory(baseOf(c))) ? ((await (await openHistory())?.trackedFiles()) ?? []) : []),
        ...(people ? { subfolders: profileIds } : {}),
        saveFolder: async (folder) => void (await d.config().replaceFolder(folder)),
        historyDir: (folder) => historyDir(userData, folder),
        journal: moveJournal(userData),
        ...(pluginStateRoot ? { pluginStateRoot } : {}),
        ops: { trash: (p) => shell.trashItem(p) },
      };
      // Checked and set with no await in between, so two requests can't both start a move.
      if (d.moving()) return { ok: false, error: "busy" };
      let pluginsStopped = false;
      let backendStopped = false;
      const run = guardedMove({
        guards,
        isBusy: d.folderBusy,
        precheck: () => precheckMove(c.folder, to, deps),
        quitting: d.quitting,
        // Board mode: each open task's checkpoint, one at a time, then the queues pause until the move ends (Decision 15).
        checkpoint: () => {
          const host = d.host();
          return host ? host.board.checkpointAllBeforeMove() : plainTasks.checkpointBeforeMove();
        },
        holdHistory: (held) => d.setHistoryHeld(held),
        flush: async () => {
          await flushTurns();
          // The file indexes waiting to be written go with the history, not after it.
          await flushFileIndexes();
        },
        // The plugins work on the old folder too: stopped with the runtime, started again after (rebase, below).
        closeRuntime: async () => {
          await closeRuntime();
          pluginsStopped = true;
          await d.pluginsCtl()?.stop().catch((err: unknown) => pluginLog("Could not stop the plugins before the move", err));
          // The backend works in the old folder too: stopped with the runtime, started again after (below).
          const backend = d.backend();
          backendStopped = backend !== null;
          await backend?.stop().catch((err: unknown) => console.error("Could not stop the backend before the move", err));
        },
        restoresSettled: () => restores.settled(),
        resumeFromNotes: () => d.tasks().resumeFromNotes(),
        move: () => moveFolder(c.folder, to, deps),
      });
      d.setMoving(run);
      let result: Awaited<typeof run>;
      try {
        result = await run;
      } finally {
        d.setMoving(null);
        // Done, refused or failed (guardedMove may return before its checkpoint): the queues go on.
        d.host()?.board.moveEnded();
        // Moved or not, the plugins start again in whichever folder is the app's now.
        if (pluginsStopped) await rebasePlugins();
        // Moved or not, the backend starts again in whichever folder is the app's now (never while quitting).
        if (backendStopped) void backendRebase().catch((err: unknown) => console.error("Could not start the backend after the move", err));
        // The reader's watches were checked against the folder as it was.
        documentSessions.closeAll();
      }
      // The window always gets the state as it is now, whatever happened.
      const state = await appState().catch((err: unknown) => {
        console.error("Could not read the app state after the move", err);
        return null;
      });
      if (!result.ok) return { ...result, ...(state ? { state } : {}) };
      dropDataStoresUnder(c.folder);
      // Search's indexes are caches keyed by the base (plan deviation 2): the old ones go, the next ⌘K rebuilds.
      // `c` is the config from before the move, so these are the old bases; the profile ids did not change.
      const oldBases = people ? (await profileIds()).map((id) => profileDir(c.folder, id)) : [c.folder];
      for (const b of oldBases) void searchSvc.discard(b).catch((err: unknown) => console.error("Could not drop the old search index", err));
      if (!state) throw new Error("Could not read the app state after the move");
      const { oldRemoved, historyMoved } = result.done;
      return { ok: true, state, ...(oldRemoved ? {} : { leftBehind: c.folder }), ...(historyMoved ? {} : { historyLeftBehind: true }) };
    },
  };
}
