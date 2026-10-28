import { describe, expect, it } from "vitest";
import { PLUGIN_IPC_CHANNELS, registerPluginsIpc, safeStorageCrypto } from "../src/main/plugin-ipc";

const HASH = "a".repeat(64);
const TOKEN = "0123456789abcdef0123456789abcdef";

function wire(over: Record<string, unknown> = {}, now = { t: 0 }) {
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
    attention: {
      view: rec("attention.view", { items: [], badge: 0, show: false }),
      dismiss: rec("attention.dismiss", undefined),
      read: rec("attention.read", undefined),
    },
    ...over,
  };
  registerPluginsIpc((ch, fn) => void handlers.set(ch, fn), ctl as never, { now: () => now.t });
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { handlers, call, calls };
}

const INVALID = { ok: false, message: "Invalid request" };

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
