import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, app, dialog, ipcMain, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { availableEngines, getEngine } from "@humanharness/engines";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, createRuntime } from "@humanharness/runtime";
import { type AppConfig, type AppState, isConfigured } from "@humanharness/ui";
import { History } from "@humanharness/workspace";
import { ChatLog } from "./chat-log";
import { ConfigStore, historyDir } from "./config";
import { type CommandDeps, engineCommand } from "./engine-command";
import { TurnController, memoise } from "./turn-controller";
import { type ValidationContext, configProblem, isAppUrl } from "./validate";

declare const __HARNESS_DIR__: string;

const requireFromHere = createRequire(import.meta.url);
const commandDeps: CommandDeps = {
  shell: process.env.SHELL || "/bin/zsh",
  home: os.homedir(),
  run: (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve({ stdout: String(stdout), code: err ? 1 : 0 }));
    }),
  isExecutable: (file) => fs.access(file, constants.X_OK).then(() => true, () => false),
  electronPath: process.execPath,
  resolveModule: (id) => requireFromHere.resolve(id),
};

let harness: LoadedHarness;
let config: ConfigStore;
let window: BrowserWindow | null = null;
/** Settles when the last restore done without a runtime has finished. */
let restoring: Promise<unknown> = Promise.resolve();

const mode = () => (app.isPackaged ? "distribution" : "development");
const stateBlocks = () => new Set(Object.entries(harness.blocks).filter(([, b]) => !b.visible).map(([n]) => n));
const rendererFile = path.join(__dirname, "../renderer/index.html");
const appUrl = (url: string) => isAppUrl(url, { devUrl: process.env.ELECTRON_RENDERER_URL, rendererFile });
const validation = (): ValidationContext => ({
  engineIds: availableEngines(harness.engines, mode()).map((e) => e.id),
  languages: harness.languages,
  home: os.homedir(),
});

async function appState(): Promise<AppState> {
  return {
    harness: { id: harness.id, name: harness.name, languages: harness.languages },
    config: await config.load(),
    suggestedFolder: path.join(os.homedir(), harness.folder.suggested),
    engines: availableEngines(harness.engines, mode()).map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status as "allowed" | "pending",
      requires: e.requires,
      dataLocation: e.dataLocation,
    })),
  };
}

/** The saved config, only when it is complete and valid. */
async function validConfig(): Promise<Required<AppConfig> | null> {
  const c = await config.load();
  return isConfigured(c) && configProblem(c, validation()) === null ? c : null;
}

const runtime = memoise<HarnessRuntime>(async () => {
  const c = await config.load();
  if (!isConfigured(c)) throw new Error("The app is not set up yet");
  const problem = configProblem(c, validation());
  if (problem) throw new Error(problem);
  await restoring;
  const engine = getEngine(c.engineId);
  const cmd = await engineCommand(engine, commandDeps);
  if (!cmd) return null;
  return createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: historyDir(app.getPath("userData"), c.folder),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(__dirname, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
  });
});

/** The running runtime's history, or one opened on the configured folder when there is no runtime. */
async function currentHistory(): Promise<History | null> {
  const rt = await runtime.peek()?.catch(() => null);
  if (rt) return rt.history;
  const c = await validConfig();
  if (!c) return null;
  const extra = getEngine(c.engineId).instructionsFile?.path;
  // Same ignore list as the runtime's: its files under .harness/ and the generated instructions.
  const history = new History(c.folder, historyDir(app.getPath("userData"), c.folder), [".harness/", "AGENTS.md", ...(extra ? [extra] : [])]);
  await history.init();
  return history;
}

function emit(event: Event) {
  try {
    if (window && !window.isDestroyed()) window.webContents.send("hh:event", event);
  } catch (err) {
    console.error("Could not send an event to the window", err);
  }
}

const turns = new TurnController({
  ensureRuntime: () => runtime.get(),
  chatLog: async () => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason;
    // nothing is written into a folder that didn't pass validation.
    return configProblem(c, validation()) === null ? new ChatLog(c.folder) : { append: async () => {} };
  },
  stateBlocks,
  emit,
});

/** Registers an IPC handler that only answers the app's own page. */
function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame || !appUrl(event.senderFrame.url)) throw new Error("Unexpected sender");
    return fn(...(args as never[]));
  });
}

function registerIpc() {
  handle("hh:getState", () => appState());
  handle("hh:pickFolder", async (defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("hh:saveConfig", async (patch: AppConfig) => {
    const problem = configProblem(patch, validation());
    if (problem) throw new Error(problem);
    await config.save(patch);
    return appState();
  });
  handle("hh:loadChat", async () => {
    const c = await config.load();
    return c.folder ? new ChatLog(c.folder).load() : [];
  });
  handle("hh:send", (message: string) => turns.send(message));
  handle("hh:cancel", () => turns.cancel());
  handle("hh:history", async () => {
    const history = await currentHistory();
    return history ? (await history.list()).map((h) => ({ ...h, date: h.date.toISOString() })) : [];
  });
  handle("hh:restore", async (sha: string) => {
    if (turns.isBusy()) return;
    const history = await currentHistory();
    if (!history || turns.isBusy()) return;
    const done = history.restore(sha, "Went back to an earlier point");
    restoring = done.catch(() => undefined);
    await done;
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: harness.name.en,
    webPreferences: { preload: path.join(__dirname, "../preload/index.mjs"), contextIsolation: true, sandbox: false },
  });
  window = win;
  win.on("closed", () => {
    if (window === win) window = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (!appUrl(event.url)) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(rendererFile);
}

// Each harness is its own app: keep its config, history and caches apart from other harnesses.
// Set before "ready" (ESM top-level await delays it) so Chromium uses the same folder.
const loaded = await loadHarness(path.join(__dirname, "harness.js"), { root: __HARNESS_DIR__ }).catch((err: unknown) => {
  // showErrorBox is safe before "ready".
  dialog.showErrorBox("This app could not start", err instanceof Error ? err.message : String(err));
  app.exit(1);
  return null;
});

if (loaded) {
  harness = loaded;
  app.setName(harness.name.en);
  app.setPath("userData", path.join(app.getPath("appData"), "Human Harness", harness.id));

  app.whenReady().then(async () => {
    config = new ConfigStore(app.getPath("userData"));
    registerIpc();
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    turns.cancel();
    void (async () => {
      try {
        const rt = await runtime.peek()?.catch(() => null);
        runtime.clear();
        await rt?.close();
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await turns.flush();
    })().finally(() => app.quit());
  });
}
