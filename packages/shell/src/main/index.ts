import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { availableEngines, getEngine } from "@humanharness/engines";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type HarnessRuntime, type RunningTurn, createRuntime, fail } from "@humanharness/runtime";
import { type AppConfig, type AppState, isConfigured } from "@humanharness/ui";
import { ChatLog, TurnRecorder } from "./chat-log";
import { ConfigStore } from "./config";
import { type CommandDeps, engineCommand } from "./engine-command";

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
let runtime: HarnessRuntime | null = null;
let current: RunningTurn | null = null;
let window: BrowserWindow | null = null;

const mode = () => (app.isPackaged ? "distribution" : "development");
const stateBlocks = () => new Set(Object.entries(harness.blocks).filter(([, b]) => !b.visible).map(([n]) => n));

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

async function ensureRuntime(c: Required<AppConfig>): Promise<HarnessRuntime | null> {
  if (runtime) return runtime;
  const engine = getEngine(c.engineId);
  const cmd = await engineCommand(engine, commandDeps);
  if (!cmd) return null;
  runtime = await createRuntime({
    harness,
    engine,
    folder: c.folder,
    gitdir: path.join(app.getPath("userData"), "history"),
    language: c.language,
    launcher: electronLauncher(process.execPath),
    uiServerEntry: path.join(__dirname, "ui-server.js"),
    command: cmd.command,
    env: cmd.env,
  });
  return runtime;
}

function emit(event: unknown) {
  window?.webContents.send("hh:event", event);
}

function registerIpc() {
  ipcMain.handle("hh:getState", () => appState());
  ipcMain.handle("hh:pickFolder", async (_e, defaultPath: string) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("hh:saveConfig", async (_e, patch: AppConfig) => {
    await config.save(patch);
    return appState();
  });
  ipcMain.handle("hh:loadChat", async () => {
    const c = await config.load();
    return c.folder ? new ChatLog(c.folder).load() : [];
  });
  ipcMain.handle("hh:send", async (_e, message: string) => {
    const c = await config.load();
    if (!isConfigured(c) || current) return;
    const log = new ChatLog(c.folder);
    await log.append({ id: crypto.randomUUID(), role: "user", text: message, blocks: [], activities: [], at: new Date().toISOString() });
    const recorder = new TurnRecorder(stateBlocks());
    let rt: HarnessRuntime | null;
    try {
      rt = await ensureRuntime(c);
    } catch (e) {
      rt = null;
      const done = fail("agent-crashed", (e as Error).message);
      emit(done);
      await log.append(recorder.finish(done as Extract<typeof done, { type: "done" }>));
      return;
    }
    if (!rt) {
      const done = fail("engine-not-installed");
      emit(done);
      await log.append(recorder.finish(done as Extract<typeof done, { type: "done" }>));
      return;
    }
    current = rt.send(message, (e) => {
      emit(e);
      if (e.type === "done") void log.append(recorder.finish(e));
      else recorder.add(e);
    });
    await current.done;
    current = null;
  });
  ipcMain.handle("hh:cancel", () => current?.cancel());
  ipcMain.handle("hh:history", async () =>
    runtime ? (await runtime.history.list()).map((h) => ({ ...h, date: h.date.toISOString() })) : [],
  );
  ipcMain.handle("hh:restore", async (_e, sha: string) => {
    if (runtime && !current) await runtime.history.restore(sha, "Went back to an earlier point");
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1100,
    height: 760,
    title: harness.name.en,
    webPreferences: { preload: path.join(__dirname, "../preload/index.mjs"), contextIsolation: true, sandbox: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// Each harness is its own app: keep its config, history and caches apart from other harnesses.
// Set before "ready" (ESM top-level await delays it) so Chromium uses the same folder.
harness = await loadHarness(path.join(__dirname, "harness.js"), { root: __HARNESS_DIR__ });
app.setName(harness.name.en);
app.setPath("userData", path.join(app.getPath("appData"), "Human Harness", harness.id));

app.whenReady().then(async () => {
  config = new ConfigStore(app.getPath("userData"));
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (!runtime) return;
  event.preventDefault();
  const r = runtime;
  runtime = null;
  void r.close().finally(() => app.quit());
});
