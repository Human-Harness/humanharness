import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, app, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { electronLauncher } from "@humanharness/blocks";
import { type EngineDef, NOTICE_VERSION, availableEngines, getEngine } from "@humanharness/engines";
import { type LoadedHarness, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, createRuntime } from "@humanharness/runtime";
import {
  type AppConfig,
  type AppState,
  type ChatLoad,
  type ConfiguredApp,
  type FolderPick,
  type RunningSetup as SetupInfo,
  type SendOptions,
  type SetupOutput,
  type SetupStep,
  type TestResult,
  type UsageSummary,
  isConfigured,
} from "@humanharness/ui/client";
import { History } from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { ChatLog } from "./chat-log";
import { ConfigStore, historyDir } from "./config";
import { testPrompt } from "./engine-check";
import { type CommandDeps, cliCommand, engineCommand, loginShellPath } from "./engine-command";
import { EngineGuards } from "./engine-guards";
import { installCommandOf, terminalCommand } from "./install-help";
import { detectEngine, hasAcceptedNotice } from "./engine-status";
import { requireNoticeForChoice, requireNoticeForTurn } from "./notice-policy";
import { archiveStaleChat, startNewChatIfEngineChanged } from "./engine-switch";
import { type RunningSetup, runSetupProcess, setupCommand, stopSetupProcess } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import { SharedConfigStore, sharedConfigDir } from "./shared-config";
import { EngineUnavailable, TurnController, memoise } from "./turn-controller";
import { UsageLog, summarizeUsage, usageRecord } from "./usage-log";
import { type ValidationContext, checkFolder, configProblem, isAppUrl } from "./validate";

declare const __HARNESS_DIR__: string;

/** The window's background before the page paints (the `paper` token), so there is no white flash. */
const PAPER = { light: "#F4F4F1", dark: "#161819" };
const SETUP_STEPS: SetupStep[] = ["install", "update", "login", "logout"];
/** How long each setup step may run before it is stopped (a sign-in left open in the browser, a stuck download). */
const SETUP_TIMEOUT_MS: Record<SetupStep, number> = { install: 20 * 60_000, update: 20 * 60_000, login: 10 * 60_000, logout: 60_000 };

const requireFromHere = createRequire(import.meta.url);
const commandDeps: CommandDeps = {
  shell: process.env.SHELL || "/bin/zsh",
  home: os.homedir(),
  run: (cmd, args, env) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 10_000, env: { ...process.env, ...env } }, (err, stdout) => {
        const e = err as (Error & { code?: unknown; killed?: boolean }) | null;
        const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
        resolve({
          stdout: String(stdout),
          code,
          // Killed by the timeout, or never started (e.g. ENOENT): no real answer.
          ...(e?.killed ? { timedOut: true } : {}),
          ...(e && typeof e.code === "string" ? { spawnError: true } : {}),
        });
      });
    }),
  isExecutable: (file) => fs.access(file, constants.X_OK).then(() => true, () => false),
  electronPath: process.execPath,
  resolveModule: (id, from) => (from ? createRequire(from) : requireFromHere).resolve(id),
};

let harness: LoadedHarness;
let config: ConfigStore;
let shared: SharedConfigStore;
let window: BrowserWindow | null = null;
/** Settles when the last restore done without a runtime has finished. */
let restoring: Promise<unknown> = Promise.resolve();
/** A restore was asked for and hasn't finished (including finding the history). */
let restorePending = false;
/** Set on the first before-quit: from then on, no new turns or restores. */
let quitting = false;
/** The install, update, login or logout process running now, if any. */
let setupRun: RunningSetup | null = null;
/** The first web address the running step printed, for a screen that reopens while it runs. */
let setupUrl: string | undefined;
/** How long quitting waits for the test prompt to clean up (its temporary folder, the CLI it started). */
const QUIT_TEST_WAIT_MS = 5_000;
/** Engine changes, setup steps and test prompts against turns (see EngineGuards). */
const guards = new EngineGuards();
/** Logos as data: URLs, read once. */
const logos = new Map<string, Promise<string | null>>();

const mode = () => (app.isPackaged ? "distribution" : "development");
const stateBlocks = () => new Set(Object.entries(harness.blocks).filter(([, b]) => !b.visible).map(([n]) => n));
const rendererFile = path.join(__dirname, "../renderer/index.html");
// The dev server is only trusted in development: a packaged app always loads its own file.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const appUrl = (url: string) => isAppUrl(url, { devUrl, rendererFile });
const validation = (): ValidationContext => ({
  engineIds: availableEngines(harness.engines, mode()).map((e) => e.id),
  languages: harness.languages,
  home: os.homedir(),
});

/** An engine this harness offers in this build. The id comes from the window, so anything else throws. */
function engineFor(id: unknown): EngineDef {
  const engine = availableEngines(harness.engines, mode()).find((e) => e.id === id);
  if (!engine) throw new Error("This engine is not available");
  return engine;
}

function logo(key: string, file: () => string): Promise<string | null> {
  if (!logos.has(key)) {
    logos.set(
      key,
      (async () => {
        try {
          return await imageDataUrl(file());
        } catch {
          return null;
        }
      })(),
    );
  }
  return logos.get(key)!;
}

const harnessLogo = () => (harness.logo ? logo("harness", () => resolveInHarness(harness, harness.logo!)) : Promise.resolve(null));
// Engine logos ship in the engines package (exported as "./assets/*").
const engineLogo = (e: EngineDef) => (e.logo ? logo(e.id, () => requireFromHere.resolve(`@humanharness/engines/${e.logo}`)) : Promise.resolve(null));

async function appState(): Promise<AppState> {
  const harnessImage = await harnessLogo();
  return {
    harness: {
      id: harness.id,
      name: harness.name,
      languages: harness.languages,
      ...(harness.tagline ? { tagline: harness.tagline } : {}),
      ...(harnessImage ? { logo: harnessImage } : {}),
      author: harness.author,
      ...(harness.donate ? { donate: harness.donate } : {}),
      version: app.getVersion(),
    },
    config: await config.load(),
    suggestedFolder: path.join(os.homedir(), harness.folder.suggested),
    engines: await Promise.all(
      availableEngines(harness.engines, mode()).map(async (e) => {
        const image = await engineLogo(e);
        return {
          id: e.id,
          name: e.name,
          status: e.status as "allowed" | "pending",
          provider: e.provider,
          requires: e.requires,
          dataLocation: e.dataLocation,
          trainsOnData: e.trainsOnData,
          termsUrl: e.termsUrl,
          privacyUrl: e.privacyUrl,
          reportsLimits: e.reportsLimits,
          ...(e.setup?.install ? { installCommand: e.setup.install.command, installDocsUrl: e.setup.install.docsUrl } : {}),
          ...(image ? { logo: image } : {}),
        };
      }),
    ),
    actions: harness.actions,
  };
}

/** The saved config, only when it is complete and valid. */
async function validConfig(): Promise<ConfiguredApp | null> {
  const c = await config.load();
  return isConfigured(c) && (await configProblem(c, validation())) === null ? c : null;
}

function applyAppearance(appearance: AppConfig["appearance"]) {
  nativeTheme.themeSource = appearance ?? "system";
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);
}

const runtime = memoise<HarnessRuntime>(async () => {
  const c = await config.load();
  if (!isConfigured(c)) throw new Error("The app is not set up yet");
  const problem = await configProblem(c, validation());
  if (problem) throw new Error(problem);
  await restoring;
  const engine = getEngine(c.engineId);
  // Spec §9 "every start": enforce detect.minVersion and a signed-in CLI before the first turn.
  const status = await detectEngine(engine, commandDeps, shared);
  if (!status.installed) return null;
  if (status.outdated) throw new EngineUnavailable("outdated-version");
  if (status.loggedIn === false) throw new EngineUnavailable("session-expired");
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

/** Closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
}

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

function sendToWindow(channel: string, value: unknown) {
  try {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  } catch (err) {
    console.error("Could not send to the window", err);
  }
}
const emit = (event: Event) => sendToWindow("hh:event", event);
const hasNotice = (engineId: string) => hasAcceptedNotice(shared, engineId);

const turns = new TurnController({
  ensureRuntime: async () => {
    const blocked = guards.turnBlocked();
    if (blocked) throw new Error(blocked);
    // Checked on every turn: the notice may have been reset (Start over) while a runtime runs.
    await requireNoticeForTurn((await config.load()).engineId, hasNotice);
    return runtime.get();
  },
  chatLog: async () => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason;
    // nothing is written into a folder that didn't pass validation.
    return (await configProblem(c, validation())) === null ? new ChatLog(c.folder, c.engineId) : { append: async () => {} };
  },
  stateBlocks,
  emit,
  recordUsage: async (entry, meta, firstLimits) => {
    const c = await validConfig();
    const record = c ? usageRecord(entry, c.engineId, meta, firstLimits) : null;
    if (c && record) await new UsageLog(c.folder).append(record);
  },
  engineId: async () => (await config.load()).engineId,
  sessionExpired: async (engineId) => {
    await shared.update(engineId, { verifiedAt: null });
  },
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
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    return { folder, problem: await checkFolder(folder, os.homedir()) } satisfies FolderPick;
  });
  handle("hh:saveConfig", async (patch: AppConfig) => {
    const problem = await configProblem(patch, validation());
    if (problem) throw new Error(problem);
    const before = await config.load();
    // Spec §9: an engine is only used once its notice is accepted.
    await requireNoticeForChoice(patch.engineId, before.engineId, hasNotice);
    if (patch.engineId && before.engineId && patch.engineId !== before.engineId) {
      const engineId = patch.engineId;
      await guards.switchEngine(
        {
          isBusy: () => turns.isBusy(),
          idle: () => turns.flush(),
          save: () => config.save(patch).then(() => undefined),
          dropRuntime,
          archiveChat: async () => {
            const c = await validConfig();
            return c && c.engineId === engineId ? startNewChatIfEngineChanged(c.folder, engineId) : null;
          },
        },
        // The new engine is saved: the window gets the new state; the next chat load archives the old chat.
        (err) => console.error("Could not finish changing the engine", err),
      );
    } else {
      await config.save(patch);
    }
    if (patch.appearance) applyAppearance(patch.appearance);
    return appState();
  });
  handle("hh:loadChat", async (): Promise<ChatLoad> => {
    const c = await validConfig();
    if (!c) return { entries: [] };
    // The engine change archives the chat; the check here only catches a change made while the app was closed.
    const switchedFrom =
      guards.takeSwitchedFrom() ?? (turns.isBusy() || guards.turnBlocked() ? null : await archiveStaleChat(c.folder, c.engineId, dropRuntime));
    return { entries: await new ChatLog(c.folder).load(), ...(switchedFrom ? { switchedFrom } : {}) };
  });
  handle("hh:send", (message: string, options?: SendOptions) => {
    const blocked = guards.turnBlocked();
    if (blocked) throw new Error(blocked);
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    return turns.send(message, action ? { action } : {});
  });
  handle("hh:cancel", () => turns.cancel());
  handle("hh:history", async () => {
    const history = await currentHistory();
    return history ? (await history.list()).map((h) => ({ ...h, date: h.date.toISOString() })) : [];
  });
  handle("hh:restore", async (sha: string) => {
    if (quitting) throw new Error("The app is closing");
    if (restorePending) throw new Error("Already going back");
    if (turns.isBusy()) throw new Error("A turn is running");
    restorePending = true;
    try {
      const history = await currentHistory();
      if (!history) throw new Error("The app is not set up yet");
      if (quitting || turns.isBusy()) throw new Error("A turn is running");
      const done = history.restore(sha, "Went back to an earlier point");
      restoring = done.catch(() => undefined);
      await done;
    } finally {
      restorePending = false;
    }
  });
  handle("hh:engineStatus", (engineId: string) => detectEngine(engineFor(engineId), commandDeps, shared));
  handle("hh:acceptNotice", async (engineId: string) => {
    engineFor(engineId);
    await shared.update(engineId, { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
  });
  handle("hh:runSetup", async (engineId: string, step: SetupStep) => {
    const engine = engineFor(engineId);
    if (!SETUP_STEPS.includes(step)) throw new Error("Unknown setup step");
    // Start and end are only reported by the call that holds the setup slot, so only it resets these.
    const output = (o: SetupOutput) => {
      if (o.kind === "start") setupUrl = undefined;
      if (o.kind === "url") setupUrl ??= o.url;
      if (o.kind === "end") {
        setupRun = null;
        setupUrl = undefined;
      }
      sendToWindow("hh:setupOutput", o);
    };
    return runSetupStep(
      {
        guards,
        hasNotice,
        currentEngine: async () => (await config.load()).engineId,
        isBusy: () => turns.isBusy(),
        quitting: () => quitting,
        command: async () => {
          const cli = step === "install" ? null : await cliCommand(engine, commandDeps);
          return setupCommand(engine, step, cli, await loginShellPath(commandDeps));
        },
        dropRuntime,
        spawn: (cmd) => (setupRun = runSetupProcess(cmd, output, { timeoutMs: SETUP_TIMEOUT_MS[step] })),
        output,
      },
      engineId,
      step,
    );
  });
  handle("hh:getSetup", (): SetupInfo | null => {
    const s = guards.setup;
    return s ? { ...s, ...(setupUrl ? { url: setupUrl } : {}) } : null;
  });
  handle("hh:setupInput", (text: string) => {
    if (typeof text === "string") setupRun?.write(text.slice(0, 2000));
  });
  handle("hh:cancelSetup", () => {
    // Remembered too, for a step whose process hasn't started yet.
    guards.cancelSetup();
    setupRun?.cancel();
  });
  handle("hh:testEngine", async (engineId: string) => {
    const engine = engineFor(engineId);
    if (quitting) throw new Error("The app is closing");
    // A second request for the same engine (the screen was reopened) gets the running test's result.
    return guards.runTest(engineId, async (signal): Promise<TestResult> => {
      if (!(await hasNotice(engineId))) return { ok: false, error: { code: "notice-required" } };
      const cmd = await engineCommand(engine, commandDeps);
      if (!cmd) return { ok: false, error: { code: "engine-not-installed" } };
      // The app may have started quitting while the CLI was being found.
      if (quitting || signal.aborted) return { ok: false, error: { code: "cancelled" } };
      const result = await testPrompt(engine, cmd, { signal });
      if (!result.ok) return result;
      try {
        await shared.update(engineId, { verifiedAt: new Date().toISOString() });
      } catch (err) {
        console.error("Could not record the test prompt", err);
        return { ok: true, recorded: false };
      }
      return { ok: true };
    });
  });
  handle("hh:getUsage", async (): Promise<UsageSummary> => {
    const c = await validConfig();
    if (!c) return { limits: null, estimates: {} };
    return summarizeUsage((await new UsageLog(c.folder).load()).filter((r) => r.engine === c.engineId));
  });
  handle("hh:revealSharedConfig", () => shell.showItemInFolder(shared.path));
  // Installing by hand: copy the official command (chosen here by engine id) and open Terminal,
  // where the user pastes it. Nothing is run for them.
  handle("hh:copyInstallCommand", (engineId: string) => clipboard.writeText(installCommandOf(engineFor(engineId))));
  handle("hh:openTerminal", async () => {
    const terminal = terminalCommand(process.platform);
    if (!terminal) throw new Error("No Terminal app to open here");
    await new Promise<void>((resolve, reject) => execFile(terminal.command, terminal.args, (err) => (err ? reject(err) : resolve())));
  });
  handle("hh:resetSharedConfig", async () => {
    await shared.reset();
  });
  handle("hh:revealFolder", async () => {
    const c = await validConfig();
    if (c) await shell.openPath(c.folder);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: harness.name.en,
    // Native look (spec 2026-10-11-app-look-design.md): on macOS the page draws the 52 px top bar.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 20, y: 18 } } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light,
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
  if (devUrl) await win.loadURL(devUrl);
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
    shared = new SharedConfigStore(sharedConfigDir());
    nativeTheme.themeSource = (await config.load()).appearance ?? "system";
    nativeTheme.on("updated", () => window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light));
    registerIpc();
    await createWindow();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    turns.close();
    // The test prompt cleans up (its CLI, its temporary folder) before the app goes; bounded wait.
    const testStopped = Promise.race([guards.close(), new Promise<void>((r) => setTimeout(r, QUIT_TEST_WAIT_MS))]);
    const setupStopped = setupRun ? stopSetupProcess(setupRun) : Promise.resolve();
    void (async () => {
      await Promise.all([setupStopped, testStopped]);
      try {
        await dropRuntime();
      } catch (err) {
        console.error("Could not close the agent cleanly", err);
      }
      // A cancelled or closed turn still writes its reply to the chat: wait for it.
      await turns.flush();
    })().finally(() => app.quit());
  });
}
