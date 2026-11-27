// The core mods' `folderChanged` and `windowClosed` (minimal core step 4): said where the documents mod must close the
// reader's watches (a folder move or change, a window closed or reloaded). The profile switch is in scope-stores-refresh.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/move-folder", async (original) => ({ ...(await original<object>()), guardedMove: async () => ({ ok: false, error: "failed" }) }));
vi.mock("../src/main/validate", async (original) => ({ ...(await original<object>()), configProblem: async () => null }));
const windows = vi.hoisted(() => [] as { window: Map<string, () => void>; contents: Map<string, () => void> }[]);
vi.mock("electron", () => ({
  app: { getPath: () => "/nowhere" },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
  BrowserWindow: class {
    on: (name: string, fn: () => void) => void;
    webContents: object;
    constructor() {
      const heard = { window: new Map<string, () => void>(), contents: new Map<string, () => void>() };
      windows.push(heard);
      this.on = (name, fn) => void heard.window.set(name, fn);
      this.webContents = {
        id: 12,
        session: { protocol: { isProtocolHandled: () => true } },
        on: (name: string, fn: () => void) => void heard.contents.set(name, fn),
        setWindowOpenHandler: () => {},
      };
    }
    loadFile = async () => {};
  },
}));

const { folderIpc } = await import("../src/main/folder-ipc");
const { settingsIpc } = await import("../src/main/settings-ipc");
const { createWindow } = await import("../src/main/window");

/** Records the mods' moment. */
function recorder() {
  const order: string[] = [];
  return { order, events: { folderChanged: () => void order.push("folderChanged"), baseGone: async () => {} } };
}

describe("folderChanged", () => {
  it("a folder move says it, moved or not", async () => {
    const r = recorder();
    const ipc = folderIpc({
      events: r.events,
      quitting: () => false,
      validConfig: async () => ({ folder: "/old", engineId: "claude" }) as never,
      userData: () => "/nowhere",
      profilesCtl: () => null,
      pluginStateRoot: () => null,
      moving: () => null,
      setMoving: () => {},
      host: () => null,
      appState: async () => ({}) as never,
      baseOf: (c: { folder: string }) => c.folder,
      guards: {},
      restores: {},
      plainTasks: {},
      shell: {},
      dialog: {},
    } as never);
    expect(await ipc["hh:moveFolder"]("/new")).toMatchObject({ ok: false, error: "failed" });
    expect(r.order).toEqual(["folderChanged"]);
  });

  async function save(patch: object) {
    const r = recorder();
    const ipc = settingsIpc({
      events: r.events,
      harness: () => ({ actions: {}, data: {} }) as never,
      config: () => ({ load: async () => ({ folder: "/old", engineId: "claude" }) }) as never,
      validation: () => ({}) as never,
      pluginsCtl: () => null,
      setupCtl: () => null,
      settingsCtl: () => null,
      host: () => null,
      setJobSettings: () => {},
      currentBase: async () => null,
      hasNotice: async () => true,
      folderBusy: () => false,
      guards: { beginFolderChange: () => {}, endFolderChange: () => {} },
      interruptTasks: async () => {},
      dropRuntime: async () => {},
      saveConfigPatch: async () => {},
      dropDataStoresUnder: () => {},
      settleScopes: async () => {},
      scopesChanged: async () => {},
      validConfig: async () => null,
      jobsReady: async () => {},
      backendRebase: async () => {},
      backendReady: async () => {},
      appState: async () => ({}) as never,
    } as never);
    await ipc["hh:saveConfig"](patch);
    return r.order;
  }

  it("a new folder in Settings says it; any other change does not", async () => {
    expect(await save({ folder: "/new" })).toEqual(["folderChanged"]);
    expect(await save({ folder: "/old" })).toEqual([]);
    expect(await save({})).toEqual([]);
  });
});

describe("windowClosed", () => {
  it.each([true, false])("a window's reload and its close say whose watches go (mod host: %s)", async (withHost) => {
    const heard: number[] = [];
    await createWindow({
      harness: { name: "H" },
      hooks: {},
      here: "/app",
      paper: { light: "#fff", dark: "#000" },
      window: null,
      modHost: withHost ? { windowClosed: async (id: number) => void heard.push(id) } : null,
      pluginsCtl: null,
      devUrl: undefined,
      rendererFile: "/app/index.html",
    } as never);
    const w = windows.at(-1)!;
    w.contents.get("did-navigate")!();
    w.window.get("closed")!();
    expect(heard).toEqual(withHost ? [12, 12] : []);
  });
});
