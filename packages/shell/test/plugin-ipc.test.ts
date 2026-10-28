import { describe, expect, it, vi } from "vitest";
import { PLUGIN_IPC_CHANNELS, installPluginPanels, PluginPanelsOnDemand, registerPluginsIpc, safeStorageCrypto } from "../src/main/plugin-ipc";
import { ScopeRequired } from "../src/main/task-manager";

const HASH = "a".repeat(64);
const TOKEN = "0123456789abcdef0123456789abcdef";

function wire(over: Record<string, unknown> = {}, now = { t: 0 }, deps: Record<string, unknown> = {}) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const calls: unknown[][] = [];
  const rec =
    (name: string, answer: unknown = { ok: true }) =>
    async (...args: unknown[]) => (calls.push([name, ...args]), answer);
  const ctl = {
    view: rec("view", { local: true, plugins: [] }),
    rescan: rec("rescan", { local: true, plugins: [] }),
    setOn: rec("setOn"),
    pick: rec("pick", { ok: false, cancelled: true }),
    add: rec("add"),
    approve: rec("approve"),
    remove: rec("remove"),
    detail: rec("detail", { row: { id: "x" }, secrets: [{ id: "token", label: "Token", stored: true }] }),
    setSetting: rec("setSetting"),
    resetSettings: rec("resetSettings"),
    setWorkHours: rec("setWorkHours"),
    setSecret: rec("setSecret", { ok: true, value: "leaked?" }),
    deleteSecret: rec("deleteSecret"),
    setNotify: rec("setNotify"),
    test: rec("test", [{ source: "s", ok: true }]),
    refresh: rec("refresh"),
    surface: (...args: unknown[]) => (calls.push(["surface", ...args]), SURFACE),
    panelCall: rec("panelCall", { ok: true, value: [] }),
    takePrepared: rec("takePrepared", START),
    cancelPrepared: (...args: unknown[]) => void calls.push(["cancelPrepared", ...args]),
    attention: {
      view: rec("attention.view", { items: [], badge: 0, show: false }),
      dismiss: rec("attention.dismiss", undefined),
      read: rec("attention.read", undefined),
      open: rec("attention.open", { kind: "panel", plugin: "jira", panel: "queue", focus: "k" }),
    },
    ...over,
  };
  registerPluginsIpc((ch, fn) => void handlers.set(ch, fn), ctl as never, {
    now: () => now.t,
    log: () => {},
    startPrepared: async (p: unknown) => void calls.push(["startPrepared", p]),
    ...deps,
  });
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { handlers, call, calls };
}

const INVALID = { ok: false, message: "Invalid request" };
const START = { prompt: "Triage DOC-1 now.", display: "On-call · Triage DOC-1", tier: "light", plugin: "jira", scope: "none" };
const CARD = { token: TOKEN, plugin: "jira", pluginName: "Jira", title: "On-call · Triage DOC-1", prompt: "Triage DOC-1 now.", tier: "light", scope: "app", expiresAt: "2026-10-28T10:10:00.000Z" };
const SURFACE = { panels: [], chips: [], prepared: CARD, reloads: {} };

describe("plugins IPC", () => {
  it("registers exactly the plugins and attention channels", () => {
    const w = wire();
    expect([...w.handlers.keys()].sort()).toEqual(
      [
        "hh:pluginsGet",
        "hh:pluginsRescan",
        "hh:pluginsSetOn",
        "hh:pluginsPick",
        "hh:pluginsAdd",
        "hh:pluginsApprove",
        "hh:pluginsRemove",
        "hh:pluginsDetail",
        "hh:pluginsSetSetting",
        "hh:pluginsResetSettings",
        "hh:pluginsSetWorkHours",
        "hh:pluginsSetSecret",
        "hh:pluginsDeleteSecret",
        "hh:pluginsSetNotify",
        "hh:pluginsTest",
        "hh:pluginsRefresh",
        "hh:attentionGet",
        "hh:attentionDismiss",
        "hh:attentionRead",
        "hh:pluginsSurface",
        "hh:pluginsPanel",
        "hh:pluginsStartPrepared",
        "hh:pluginsCancelPrepared",
        "hh:attentionOpen",
      ].sort(),
    );
    expect([...PLUGIN_IPC_CHANNELS].sort()).toEqual([...w.handlers.keys()].sort());
  });

  it("passes valid requests through", async () => {
    const w = wire();
    expect(await w.call("hh:pluginsGet")).toEqual({ local: true, plugins: [] });
    await w.call("hh:pluginsRescan");
    await w.call("hh:pluginsSetOn", "jira", true);
    await w.call("hh:pluginsPick");
    await w.call("hh:pluginsAdd", TOKEN);
    await w.call("hh:pluginsApprove", "jira", HASH);
    await w.call("hh:pluginsRemove", "jira");
    await w.call("hh:pluginsDetail", "jira");
    await w.call("hh:pluginsSetSetting", "jira", "team", "docs");
    await w.call("hh:pluginsResetSettings", "jira");
    await w.call("hh:pluginsSetWorkHours", "jira", { days: [1, 2], from: "09:00", to: "18:00", timezone: "Europe/Madrid", extra: 1 });
    await w.call("hh:pluginsSetSecret", "jira", "token", "s3cret-value");
    await w.call("hh:pluginsDeleteSecret", "jira", "token");
    await w.call("hh:pluginsSetNotify", "jira", false);
    await w.call("hh:pluginsTest", "jira");
    await w.call("hh:pluginsRefresh", "jira", "issues");
    await w.call("hh:attentionGet");
    await w.call("hh:attentionDismiss", "jira", "sync-failing:issues");
    await w.call("hh:attentionRead");
    await w.call("hh:attentionRead", "jira");
    await w.call("hh:attentionRead", "jira", "k.1");
    expect(w.calls).toEqual([
      ["view"],
      ["rescan"],
      ["setOn", "jira", true],
      ["pick"],
      ["add", TOKEN],
      ["approve", "jira", HASH],
      ["remove", "jira"],
      ["detail", "jira"],
      ["setSetting", "jira", "team", "docs"],
      ["resetSettings", "jira"],
      ["setWorkHours", "jira", { days: [1, 2], from: "09:00", to: "18:00", timezone: "Europe/Madrid" }],
      ["setSecret", "jira", "token", "s3cret-value"],
      ["deleteSecret", "jira", "token"],
      ["setNotify", "jira", false],
      ["test", "jira"],
      ["refresh", "jira", "issues"],
      ["attention.view"],
      ["attention.dismiss", "jira", "sync-failing:issues"],
      ["attention.read", undefined, undefined],
      ["attention.read", "jira", undefined],
      ["attention.read", "jira", "k.1"],
    ]);
  });

  it("refuses malformed requests without calling the controller", async () => {
    const w = wire();
    const bad = [
      ["hh:pluginsSetOn", "Jira", true],
      ["hh:pluginsSetOn", "jira", "yes"],
      ["hh:pluginsSetOn", "../x", true],
      ["hh:pluginsApprove", "jira", "nothex"],
      ["hh:pluginsApprove", "jira"],
      ["hh:pluginsRemove", 3],
      ["hh:pluginsSetSetting", "jira", "1bad", 1],
      ["hh:pluginsSetSetting", "jira", "__proto__", 1],
      ["hh:pluginsSetSetting", "jira", "team", "x".repeat(9000)],
      ["hh:pluginsResetSettings", ""],
      ["hh:pluginsSetWorkHours", "jira", null],
      ["hh:pluginsSetWorkHours", "jira", { days: "1", from: "09:00", to: "18:00", timezone: "UTC" }],
      ["hh:pluginsSetWorkHours", "jira", { days: [1], from: "9".repeat(100), to: "18:00", timezone: "UTC" }],
      ["hh:pluginsSetWorkHours", "jira", { days: new Array(8).fill(1), from: "09:00", to: "18:00", timezone: "UTC" }],
      ["hh:pluginsSetSecret", "jira", "Token!", "v"],
      ["hh:pluginsSetSecret", "jira", "token", 42],
      ["hh:pluginsSetSecret", "jira", "token", "x".repeat(8193)],
      ["hh:pluginsDeleteSecret", "jira", "-x"],
      ["hh:pluginsSetNotify", "jira", 1],
      ["hh:pluginsRefresh", "jira", "Bad Source"],
    ] as const;
    for (const [ch, ...args] of bad) expect(await w.call(ch, ...args), `${ch} ${JSON.stringify(args).slice(0, 60)}`).toEqual(INVALID);
    expect(await w.call("hh:pluginsDetail", "NOPE")).toBeNull();
    expect(await w.call("hh:pluginsTest", { id: "jira" })).toEqual([]);
    await w.call("hh:attentionDismiss", "jira", "bad key with spaces");
    await w.call("hh:attentionDismiss", "jira", "x".repeat(81));
    await w.call("hh:attentionDismiss", "JIRA", "k");
    // A key without a plugin, or a plugin that isn't an id.
    await w.call("hh:attentionRead", undefined, "k");
    await w.call("hh:attentionRead", 7);
    expect(w.calls).toEqual([]);
  });

  it("never takes a path from the renderer: Add takes only a pick's token", async () => {
    const w = wire();
    expect(await w.call("hh:pluginsAdd", { folder: "/x" })).toEqual(INVALID);
    expect(await w.call("hh:pluginsAdd", "/Users/me/plugin")).toEqual(INVALID);
    expect(await w.call("hh:pluginsAdd", { token: TOKEN, folder: "/x" })).toEqual(INVALID);
    expect(await w.call("hh:pluginsAdd", TOKEN.toUpperCase())).toEqual(INVALID);
    expect(w.calls).toEqual([]);
  });

  it("B6: setSecret answers ok or a message, never anything the controller added; detail passes through", async () => {
    const w = wire();
    expect(await w.call("hh:pluginsSetSecret", "jira", "token", "s3cret-value")).toEqual({ ok: true });
    const w2 = wire({ setSecret: async () => ({ ok: false, message: "This computer can't encrypt keys for this app", value: "s3cret-value" }) });
    expect(await w2.call("hh:pluginsSetSecret", "jira", "token", "s3cret-value")).toEqual({ ok: false, message: "This computer can't encrypt keys for this app" });
    expect(await w.call("hh:pluginsDetail", "jira")).toEqual({ row: { id: "x" }, secrets: [{ id: "token", label: "Token", stored: true }] });
  });

  it("an approve refused with the current review passes its message and review, nothing else", async () => {
    const review = { id: "jira", name: "Jira", version: "1.0.0", distHash: HASH, lines: [] };
    const w = wire({ approve: async () => ({ ok: false, message: "This plugin changed; review it again", review, extra: "x" }) });
    expect(await w.call("hh:pluginsApprove", "jira", HASH)).toEqual({ ok: false, message: "This plugin changed; review it again", review });
  });

  it("a controller that rejects answers a refusal, null or an empty list, never a thrown error", async () => {
    const boom = async () => {
      throw new Error("/Users/me/secret/path exploded");
    };
    const w = wire({ view: boom, setOn: boom, detail: boom, test: boom, setSecret: boom, attention: { view: boom, dismiss: boom, read: boom } });
    expect(await w.call("hh:pluginsGet")).toBeNull();
    expect(await w.call("hh:pluginsSetOn", "jira", true)).toEqual({ ok: false, message: "Something went wrong" });
    expect(await w.call("hh:pluginsDetail", "jira")).toBeNull();
    expect(await w.call("hh:pluginsTest", "jira")).toEqual([]);
    expect(await w.call("hh:pluginsSetSecret", "jira", "token", "s3cret-value")).toEqual({ ok: false, message: "Something went wrong" });
    expect(await w.call("hh:attentionGet")).toBeNull();
    await expect(w.call("hh:attentionDismiss", "jira", "k")).resolves.toBeUndefined();
    await expect(w.call("hh:attentionRead")).resolves.toBeUndefined();
  });

  it("Refresh is rate-limited: one at a time per source, and a few per minute", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const now = { t: 0 };
    const w = wire({ refresh: async (...a: unknown[]) => (await gate, { ok: true, a }) }, now);
    const first = w.call("hh:pluginsRefresh", "jira", "issues");
    expect(await w.call("hh:pluginsRefresh", "jira", "issues")).toEqual({ ok: false, message: "A refresh of this source is already running" });
    release();
    expect(await first).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) expect(await w.call("hh:pluginsRefresh", "jira", `s${i}`)).toEqual({ ok: true });
    expect(await w.call("hh:pluginsRefresh", "jira", "other")).toEqual({ ok: false, message: "Too many refreshes; try again in a minute" });
    now.t += 60_001;
    expect(await w.call("hh:pluginsRefresh", "jira", "other")).toEqual({ ok: true });
  });

  it("Test goes through the same limiter: one at a time per plugin, and the same per-minute budget as Refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const now = { t: 0 };
    let tests = 0;
    const w = wire({ test: async () => (tests++, await gate, [{ source: "s", ok: true }]) }, now);
    const first = w.call("hh:pluginsTest", "jira");
    expect(await w.call("hh:pluginsTest", "jira")).toEqual([{ source: "jira", ok: false, error: "A test of this plugin is already running" }]);
    release();
    expect(await first).toEqual([{ source: "s", ok: true }]);
    expect(tests).toBe(1);
    // Tests and refreshes share the budget: 1 test + 3 refreshes + 1 test = 5.
    for (let i = 0; i < 3; i++) expect(await w.call("hh:pluginsRefresh", "jira", `s${i}`)).toEqual({ ok: true });
    expect(await w.call("hh:pluginsTest", "other")).toEqual([{ source: "s", ok: true }]);
    expect(await w.call("hh:pluginsTest", "jira")).toEqual([{ source: "jira", ok: false, error: "Too many tests; try again in a minute" }]);
    expect(await w.call("hh:pluginsRefresh", "jira", "s9")).toEqual({ ok: false, message: "Too many refreshes; try again in a minute" });
    expect(tests).toBe(2);
    now.t += 60_001;
    expect(await w.call("hh:pluginsTest", "jira")).toEqual([{ source: "s", ok: true }]);
  });
});

describe("plugins IPC, part 2: the surface, panel calls, prepared tasks and attention targets", () => {
  const BAD = { ok: false, error: "Invalid request" };

  it("the surface is the controller's; a controller that throws answers an empty one", async () => {
    expect(await wire().call("hh:pluginsSurface")).toEqual(SURFACE);
    const boom = () => {
      throw new Error("/Users/me/x");
    };
    expect(await wire({ surface: boom }).call("hh:pluginsSurface")).toEqual({ panels: [], chips: [], reloads: {} });
  });

  it("a panel call passes plugin, panel, call and args through; anything malformed is refused before the controller", async () => {
    const w = wire();
    expect(await w.call("hh:pluginsPanel", "jira", "queue", "data.query", { collection: "issues" })).toEqual({ ok: true, value: [] });
    await w.call("hh:pluginsPanel", "jira", "queue", "settings.get");
    await w.call("hh:pluginsPanel", "jira", "queue", "refresh", { source: "issues" });
    await w.call("hh:pluginsPanel", "jira", "queue", "requestAction", { action: "triage", vars: { issue: "DOC-1" } });
    expect(w.calls).toEqual([
      ["panelCall", "jira", "queue", "data.query", { collection: "issues" }],
      ["panelCall", "jira", "queue", "settings.get", undefined],
      ["panelCall", "jira", "queue", "refresh", { source: "issues" }],
      ["panelCall", "jira", "queue", "requestAction", { action: "triage", vars: { issue: "DOC-1" } }],
    ]);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const bad: unknown[][] = [
      ["JIRA", "queue", "data.query", {}],
      ["../x", "queue", "data.query", {}],
      ["jira", "Queue", "data.query", {}],
      ["jira", "queue/../x", "data.query", {}],
      ["jira", 1, "data.query", {}],
      ["jira", "queue", "resize", { height: 100 }],
      ["jira", "queue", "data.put", {}],
      ["jira", "queue", "attention.open", {}],
      ["jira", "queue", "startPrepared", {}],
      ["jira", "queue", "__proto__", {}],
      ["jira", "queue", "data.query", { where: "x".repeat(16 * 1024) }],
      ["jira", "queue", "data.query", cyclic],
      ["jira", "queue", "data.query", { n: 10n }],
    ];
    for (const args of bad) expect(await w.call("hh:pluginsPanel", ...args), String(args.slice(0, 3))).toEqual(BAD);
    expect(w.calls).toHaveLength(4);
  });

  it("a panel call whose controller throws answers a refusal, never the thrown error", async () => {
    const w = wire({
      panelCall: async () => {
        throw new Error("/Users/me/secret/path");
      },
    });
    expect(await w.call("hh:pluginsPanel", "jira", "queue", "settings.get", {})).toEqual({ ok: false, error: "Something went wrong" });
  });

  it("Start takes the token once and hands exactly what takePrepared gave to startPrepared (P6, P13)", async () => {
    const w = wire();
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: true });
    expect(w.calls).toEqual([["surface"], ["takePrepared", TOKEN], ["startPrepared", START]]);
  });

  it("a dead token starts nothing", async () => {
    const w = wire({ takePrepared: async () => null });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "This task is no longer prepared" });
    expect(w.calls.filter(([n]) => n === "startPrepared")).toEqual([]);
  });

  it("Start takes only a token: anything else is refused before the token is touched", async () => {
    const w = wire();
    for (const bad of [undefined, "", TOKEN.toUpperCase(), `${TOKEN}0`, { token: TOKEN }, { prompt: "rm -rf" }, 42]) {
      expect(await w.call("hh:pluginsStartPrepared", bad)).toEqual(INVALID);
    }
    // Extra arguments (a prompt, a tier, a scope) are never read.
    expect(await w.call("hh:pluginsStartPrepared", TOKEN, { prompt: "other", tier: "deep", scope: "required", plugin: "x" })).toEqual({ ok: true });
    expect(w.calls.filter(([n]) => n !== "surface")).toEqual([
      ["takePrepared", TOKEN],
      ["startPrepared", START],
    ]);
  });

  it("a blocked start (the app closing, a turn running) answers why and leaves the token alone", async () => {
    const w = wire({}, { t: 0 }, { startBlocked: () => "A turn is already running" });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "A turn is already running" });
    expect(w.calls.filter(([n]) => n === "takePrepared" || n === "startPrepared")).toEqual([]);
  });

  it("a turn that starts while Start awaits: the spent card answers why, and nothing starts", async () => {
    let busy = false;
    const w = wire({ takePrepared: async () => ((busy = true), START) }, { t: 0 }, { startBlocked: () => (busy ? "A turn is already running" : null) });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "A turn is already running" });
    expect(w.calls.filter(([n]) => n === "startPrepared")).toEqual([]);
  });

  it("a card that needs the open scope: with none open Start answers 'Open a <scope> first' before the token is used", async () => {
    let open = false;
    const taken: unknown[] = [];
    const surface = () => ({ ...SURFACE, prepared: { ...CARD, scope: "open" } });
    const w = wire({ surface, takePrepared: async (token: unknown) => (taken.push(token), { ...START, scope: "required" }) }, { t: 0 }, { scopes: { label: "topic", open: async () => open } });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "Open a topic first" });
    expect(taken).toEqual([]);
    expect(w.calls).toEqual([]);
    open = true;
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: true });
    expect(taken).toEqual([TOKEN]);
    expect(w.calls).toEqual([["startPrepared", { ...START, scope: "required" }]]);
  });

  it("an app-wide card starts with no scope open; a harness without scopes never asks", async () => {
    const asked: string[] = [];
    const w = wire({}, { t: 0 }, { scopes: { label: "topic", open: async () => (asked.push("open"), false) } });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: true });
    expect(asked).toEqual([]);
    const u = wire({ surface: () => ({ ...SURFACE, prepared: { ...CARD, scope: "open" } }) });
    expect(await u.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: true });
  });

  it("a scope closed between the check and the start answers a refusal; a start that fails once begun says it began", async () => {
    const scopeGone = async () => {
      throw new ScopeRequired();
    };
    const w = wire({}, { t: 0 }, { scopes: { label: "topic", open: async () => true }, startPrepared: scopeGone });
    expect(await w.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "Open a topic first" });
    const failed = async () => {
      throw new Error("/Users/me/secret");
    };
    // The task manager had the task: a turn may have run (the chat keeps the person's line), so the answer says so.
    expect(await wire({}, { t: 0 }, { startPrepared: failed }).call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "Something went wrong", started: true });
    const v = wire({ takePrepared: async () => Promise.reject(new Error("boom")) });
    expect(await v.call("hh:pluginsStartPrepared", TOKEN)).toEqual({ ok: false, message: "Something went wrong" });
  });

  it("Cancel drops the token; a malformed one is ignored", async () => {
    const w = wire();
    await w.call("hh:pluginsCancelPrepared", TOKEN);
    await w.call("hh:pluginsCancelPrepared", "nope");
    await w.call("hh:pluginsCancelPrepared", { token: TOKEN });
    expect(w.calls).toEqual([["cancelPrepared", TOKEN]]);
  });

  it("an attention item opens its target; a malformed request or a failure opens nothing", async () => {
    const w = wire();
    expect(await w.call("hh:attentionOpen", "jira", "round-1925")).toEqual({ kind: "panel", plugin: "jira", panel: "queue", focus: "k" });
    expect(await w.call("hh:attentionOpen", "JIRA", "k")).toEqual({ kind: "none" });
    expect(await w.call("hh:attentionOpen", "jira", "bad key")).toEqual({ kind: "none" });
    expect(await w.call("hh:attentionOpen", "jira")).toEqual({ kind: "none" });
    expect(w.calls).toEqual([["attention.open", "jira", "round-1925"]]);
    const u = wire({ attention: { open: async () => Promise.reject(new Error("x")) } });
    expect(await u.call("hh:attentionOpen", "jira", "k")).toEqual({ kind: "none" });
  });
});

describe("installPluginPanels (P1–P3, P7)", () => {
  const win = { id: 1 };

  it("D0: without a controller nothing is installed — no handler, request filter or navigation guard", () => {
    const host = { installPanels: vi.fn() };
    installPluginPanels(win as never, host as never, null);
    installPluginPanels(win as never, null, null);
    expect(host.installPanels).not.toHaveBeenCalled();
  });

  it("with a controller, the window's panels are served for what the controller says runs, asked at each request", () => {
    const host = { installPanels: vi.fn() };
    let running: { dist: string; panels: string[] } | null = { dist: "/d", panels: ["queue"] };
    const ctl = { panelHost: vi.fn((id: string) => (id === "jira" ? running : null)) };
    installPluginPanels(win as never, host as never, ctl as never);
    expect(host.installPanels).toHaveBeenCalledTimes(1);
    const [w, lookup] = host.installPanels.mock.calls[0] as [unknown, (id: string) => unknown];
    expect(w).toBe(win);
    expect(lookup("jira")).toEqual({ dist: "/d", panels: ["queue"] });
    expect(lookup("other")).toBeNull();
    running = null;
    expect(lookup("jira")).toBeNull();
  });
});

describe("PluginPanelsOnDemand (D0: panels installed from the first plugin with panels)", () => {
  it("installs nothing until needed; then the current window, and every later window; once per need", () => {
    const install = vi.fn();
    let current: { id: number } | null = null;
    const lazy = new PluginPanelsOnDemand(install, () => current);
    lazy.window({ id: 1 });
    expect(install).not.toHaveBeenCalled();
    lazy.needed();
    expect(install).not.toHaveBeenCalled();
    lazy.window({ id: 2 });
    expect(install.mock.calls).toEqual([[{ id: 2 }]]);
    current = { id: 3 };
    lazy.needed();
    expect(install).toHaveBeenCalledTimes(1);
    const fresh = new PluginPanelsOnDemand(install, () => current);
    fresh.needed();
    fresh.needed();
    expect(install.mock.calls.slice(1)).toEqual([[{ id: 3 }]]);
  });
});

describe("safeStorageCrypto", () => {
  const storage = (available: boolean, backend?: string | (() => string)) => ({
    isEncryptionAvailable: () => available,
    encryptString: (t: string) => Buffer.from(t),
    decryptString: (b: Buffer) => b.toString(),
    getSelectedStorageBackend: () => (typeof backend === "function" ? backend() : (backend ?? "unknown")),
  });

  it("is available only when the OS can encrypt, and on Linux never with the plain-text backend", () => {
    expect(safeStorageCrypto(storage(true) as never, "darwin").available()).toBe(true);
    expect(safeStorageCrypto(storage(false) as never, "darwin").available()).toBe(false);
    expect(safeStorageCrypto(storage(true, "basic_text") as never, "linux").available()).toBe(false);
    expect(safeStorageCrypto(storage(true, "gnome_libsecret") as never, "linux").available()).toBe(true);
    const throws = () => {
      throw new Error("not ready");
    };
    expect(safeStorageCrypto(storage(true, throws) as never, "linux").available()).toBe(false);
  });
});
