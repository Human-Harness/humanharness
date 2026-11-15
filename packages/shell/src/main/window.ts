import path from "node:path";
import { BrowserWindow, app, nativeTheme, shell } from "electron";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import { type TextSize, stepTextSize } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import type { ConfigStore } from "./config";
import type { DocumentSessions } from "./document-sessions";
import type { ModHost } from "./mods/host";
import { MOD_SCHEME, serveModUi } from "./mods/mod-scheme";
import { isEscapeHatch } from "./mods/safe";
import { modBuildRoot } from "./mods/user-layer";
import type { PluginPanelsOnDemand } from "./plugin-ipc";
import type { PluginsController } from "./plugins";
import type { TestHooks } from "./test-hooks";
import { textSizeShortcut } from "./text-size";

/** What createWindow reads from the main entry. Getters (and a setter) for what changes after start-up. */
export interface WindowDeps {
  readonly harness: LoadedHarness;
  readonly config: ConfigStore;
  readonly hooks: TestHooks;
  /** The main bundle's folder: the preload sits beside it. */
  readonly here: string;
  readonly paper: { light: string; dark: string };
  /** The app window; createWindow sets it, and clears it when that window closes. */
  window: BrowserWindow | null;
  readonly modHost: ModHost | null;
  readonly pluginsCtl: PluginsController | null;
  readonly pluginPanels: PluginPanelsOnDemand<BrowserWindow>;
  readonly documentSessions: DocumentSessions;
  readonly devUrl: string | undefined;
  readonly rendererFile: string;
  appUrl(url: string): boolean;
  sendToWindow(channel: PushChannel, value: unknown): void;
  pluginLog(message: string, err?: unknown): void;
  applyTextSize(size: TextSize | undefined): void;
  safeMode(running: boolean): Promise<void>;
}

let textSizeSteps: Promise<void> = Promise.resolve();

export async function createWindow(d: WindowDeps) {
  const { harness, hooks, here, documentSessions, pluginPanels, sendToWindow, pluginLog, applyTextSize, safeMode } = d;
  const PAPER = d.paper;
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: harness.name,
    // Native look (spec 2026-10-11-app-look-design.md): on macOS the page draws the top bar (--hh-topbar-h, 40 px);
    // y 13 centres the traffic lights in it; text size moves them with trafficLightY.
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 13 } } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light,
    // Test background mode (HH_TEST_BACKGROUND, development builds only): headless, the window is never shown,
    // and it keeps rendering at full speed although nobody looks at it.
    ...(hooks.background ? { show: false } : {}),
    webPreferences: {
      preload: path.join(here, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
      ...(hooks.background ? { backgroundThrottling: false } : {}),
    },
  });
  d.window = win;
  // Read now: once closed, the window's webContents can no longer be asked.
  const contentsId = win.webContents.id;
  // hh-mod (0b2): the built ui of an on, non-core mod, on the window's session; once per session.
  const modProtocol = win.webContents.session.protocol;
  if (!modProtocol.isProtocolHandled(MOD_SCHEME.scheme)) {
    modProtocol.handle(MOD_SCHEME.scheme, (req) =>
      serveModUi(req.url, { mod: (id) => d.modHost?.info(id), buildDir: (id) => path.join(modBuildRoot(app.getPath("userData"), harness.id), id) }),
    );
  }
  win.on("closed", () => {
    if (d.window === win) d.window = null;
    documentSessions.closeOwner(contentsId);
  });
  // The agent may have edited attention.json (no listener fires for it): the inbox is read again when the window comes back.
  const plugins = d.pluginsCtl;
  if (plugins) {
    // Every app window, once a plugin with panels has started: the panel-only handler, the request filter and the
    // frame guard (D0: none without plugins, none while no plugin with panels has run).
    pluginPanels.window(win);
    win.on("focus", () => {
      void plugins.attention.view().then(
        (view) => sendToWindow("hh:attention", view),
        (err: unknown) => pluginLog("Could not read the Attention inbox", err),
      );
    });
  }
  // A reload starts a new page with no watches of its own: the old page's go.
  win.webContents.on("did-navigate", () => documentSessions.closeOwner(contentsId));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (!d.appUrl(event.url)) event.preventDefault();
  });
  // A reload starts at the browser's zoom: put the saved size back.
  win.webContents.on("did-finish-load", () => {
    void d.config.load().then((c) => applyTextSize(c.textSize), () => applyTextSize(undefined));
  });
  // ⌘+, ⌘− and ⌘0 change the saved size (not the browser's own zoom, which would be forgotten).
  win.webContents.on("before-input-event", (event, input) => {
    // The escape hatch (0b2), before any other shortcut and never rebound: local mods off, the harness's layout.
    if (isEscapeHatch(input, process.platform)) {
      event.preventDefault();
      void safeMode(true).catch((err: unknown) => console.error("Could not enter safe mode", err));
      return;
    }
    const step = textSizeShortcut(input, process.platform);
    if (!step) return;
    event.preventDefault();
    // One after another: a held key or quick presses each step from the size the last one saved.
    textSizeSteps = textSizeSteps
      .then(async () => {
        const c = await d.config.load();
        const textSize = stepTextSize(c.textSize, step);
        if (textSize === (c.textSize ?? "normal")) return;
        await d.config.save({ textSize });
        applyTextSize(textSize);
        sendToWindow("hh:textSize", textSize);
      })
      .catch((err: unknown) => console.error("Could not change the text size", err));
  });
  if (d.devUrl) await win.loadURL(d.devUrl);
  else await win.loadFile(d.rendererFile);
}
