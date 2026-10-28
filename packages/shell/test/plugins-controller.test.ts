import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessPlugins } from "@humanharness/harness-sdk";
import type { PluginReview } from "@humanharness/ui/client";
import type { PluginChannel } from "../src/main/plugin-channel";
import { PluginPointers } from "../src/main/plugin-load";
import { SecretStore } from "../src/main/plugin-secrets";
import { type BackendHost, PluginsController, type PluginsDeps } from "../src/main/plugins";

/** A reversible fake of safeStorage (never the real Keychain). */
const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString(),
};
const tmp = (p = "hh-pl-ctl-") => fs.mkdtemp(path.join(os.tmpdir(), p));

const QUEUES = { key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" }, n: { type: "number" } }, required: ["key"] } };
const HIDDEN = { key: "key", agent: "none", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } };
const TEAM = { schema: { type: "string", enum: ["docs", "web"] }, default: "docs", control: "select", label: "Team", agent: "Our team is {{value}}." };

async function writePlugin(root: string, name: string, over: Record<string, unknown> = {}) {
  const dist = path.join(root, name, "dist");
  await fs.mkdir(dist, { recursive: true });
  const manifest = { id: name, name: name, version: "1.0.0", api: 1, harness: "*", permissions: {}, sources: [{ id: "s", ttl: 600 }], ...over };
  await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => {} } };\n");
  return dist;
}

/** Every file under `dir` (relative), for "nothing was written" checks. */
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)));
  return out;
}

async function until(f: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

type Ctx = {
  call(name: string, ...args: unknown[]): Promise<unknown>;
  data: { put(c: string, r: unknown): Promise<unknown>; query(c: string, q?: unknown): Promise<unknown> };
  settings: { get(): Promise<Record<string, unknown>> };
  attention: { raise(i: unknown): Promise<unknown> };
};
type Source = (ctx: Ctx) => Promise<void>;

/** Plays the core host script's part over a real PluginChannel (Decision 10). */
function fakeHost(backends: Record<string, Record<string, Source>>) {
  const channels = new Map<string, PluginChannel>();
  const gones = new Map<string, (reason: string) => void>();
  /** One page per window load: a reload kills the old page, which then drops whatever it is handed. */
  const pages = new Map<string, { alive: boolean }>();
  const open = (p: { id: string; channel: PluginChannel; gone(reason: string): void }) => {
    const old = pages.get(p.id);
    if (old) old.alive = false;
    const page = { alive: true };
    pages.set(p.id, page);
    channels.set(p.id, p.channel);
    gones.set(p.id, p.gone);
    void loop(p.id, p.channel, page);
  };
  const loop = async (id: string, channel: PluginChannel, page: { alive: boolean }) => {
    const sources = backends[id] ?? {};
    await channel.handle("ready", { sources: Object.keys(sources) });
    while (!channel.isClosed) {
      let cmd: { kind: string; runId?: string; source?: string };
      try {
        cmd = (await channel.handle("next", null)) as typeof cmd;
      } catch {
        return;
      }
      if (cmd.kind !== "run" || !page.alive) continue;
      const runId = cmd.runId!;
      const call = async (name: string, ...args: unknown[]) => {
        const a = (await channel.handle("ctx", { runId, name, args })) as { ok: boolean; value?: unknown; refused?: string };
        if (!a.ok) throw Object.assign(new Error(a.refused), { name: "PluginRefused" });
        return a.value;
      };
      const ctx: Ctx = {
        call,
        data: { put: (c, r) => call("data.put", c, r), query: (c, q) => call("data.query", c, q) },
        settings: { get: () => call("settings.get") as Promise<Record<string, unknown>> },
        attention: { raise: (i) => call("attention.raise", i) },
      };
      const fn = Object.hasOwn(sources, cmd.source!) ? sources[cmd.source!] : async () => {};
      void fn(ctx).then(
        () => channel.handle("done", { runId, ok: true }).catch(() => {}),
        (e: Error) => channel.handle("done", { runId, ok: false, error: e.message }).catch(() => {}),
      );
    }
  };
  const host: BackendHost & { started: string[]; stopped: string[] } = {
    started: [],
    stopped: [],
    start: vi.fn(async (p) => {
      host.started.push(p.id);
      open(p);
    }),
    stop: vi.fn(async (id: string) => {
      host.stopped.push(id);
    }),
    reload: vi.fn(async (p: { id: string; channel: PluginChannel; gone(reason: string): void }) => open(p)),
    stopAll: vi.fn(async () => {}),
  };
  return { host, channels, gone: (id: string, reason = "crashed") => gones.get(id)!(reason) };
}

interface Setup {
  plugins?: HarnessPlugins;
  backends?: Record<string, Record<string, Source>>;
  over?: Partial<PluginsDeps>;
}

const controllers: PluginsController[] = [];
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.stop();
  vi.useRealTimers();
});

async function setup(s: Setup = {}) {
  const root = await tmp();
  const base = await tmp("hh-pl-base-");
  const shared = await tmp("hh-pl-shared-");
  const userData = await tmp("hh-pl-ud-");
  const appDir = path.join(shared, "h");
  const fake = fakeHost(s.backends ?? {});
  let currentBase: string | null = base;
  const deps = {
    harness: { id: "h", name: "H", root, ...(s.plugins ? { plugins: s.plugins } : {}) },
    devDirs: [],
    pointers: new PluginPointers(path.join(appDir, "plugins.json")),
    secrets: new SecretStore(path.join(appDir, "secrets"), crypto),
    appDir,
    base: async () => currentBase,
    host: fake.host,
    fetch: vi.fn(async () => new Response("nope")) as unknown as typeof fetch,
    exec: { resolve: async () => null, run: vi.fn(), env: async () => ({ PATH: "/bin", HOME: "/h", LANG: "C", HH_SECRET: "x" }) },
    userData,
    tagKey: async () => Buffer.alloc(32, 7),
    pickFolder: vi.fn(async () => null as string | null),
    notify: vi.fn(),
    whenNoTask: vi.fn(async () => false),
    refreshInstructions: vi.fn(async () => true),
    runLimitMs: 120_000,
    changed: vi.fn(),
    attentionChanged: vi.fn(),
    idleMs: 30,
    log: () => {},
    ...s.over,
  } as PluginsDeps & { pickFolder: ReturnType<typeof vi.fn>; refreshInstructions: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
  const ctl = new PluginsController(deps);
  controllers.push(ctl);
  return { ctl, deps, root, base, shared, userData, appDir, ...fake, setBase: (b: string | null) => (currentBase = b) };
}

const bundled = async (root: string, id: string, over: Record<string, unknown> = {}) => writePlugin(path.join(root, "plugins"), id, over);

describe("PluginsController D0", () => {
  it("a harness without plugins loads nothing, starts nothing, writes nothing", async () => {
    const t = await setup();
    await t.ctl.start();
    expect(await t.ctl.view()).toEqual({ local: false, plugins: [] });
    expect(await t.ctl.sentences()).toEqual([]);
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
    expect(t.host.start).not.toHaveBeenCalled();
    expect(t.deps.changed).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
    expect(await files(t.userData)).toEqual([]);
  });

  it("plugins accepted (local) but none added: same", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    await t.ctl.start();
    expect(await t.ctl.view()).toEqual({ local: true, plugins: [] });
    expect(await t.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
    expect(t.deps.refreshInstructions).not.toHaveBeenCalled();
  });

  it("a bundled plugin not in plugins.on stays off and writes nothing", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    expect((await t.ctl.view()).plugins).toMatchObject([{ id: "oncall", status: "off", origin: "bundled" }]);
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await files(t.base)).toEqual([]);
    expect(await files(t.shared)).toEqual([]);
  });
});

describe("PluginsController: starting and reviews", () => {
  it("a bundled plugin in plugins.on starts, takes its snapshot, syncs once, and its data lands in plugin-data", async () => {
    const ran: string[] = [];
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: async (ctx) => (ran.push("s"), void (await ctx.data.put("queues", { key: "a", n: 1 }))) } },
    });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    expect(t.host.started).toEqual(["oncall"]);
    await until(async () => (await files(t.base)).length > 0);
    expect(ran).toEqual(["s"]);
    expect(await files(t.base)).toContain(path.join(".harness", "plugin-data", "oncall", "_app", "queues.json"));
    // The approval lives in the app's folder, never in the base (B8).
    expect((await files(t.appDir)).some((f) => f.startsWith("plugin-state"))).toBe(true);
    expect((await t.ctl.view()).plugins[0]).toMatchObject({ status: "on" });
  });

  it("a local plugin: pick → review and token; add → off; approve → on; duplicates and reused tokens refused", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { permissions: { hosts: ["api.example.com"] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = await t.ctl.pick();
    expect(pick).toMatchObject({ ok: true, review: { id: "mine", lines: [{ kind: "hosts", hosts: ["api.example.com"] }] } });
    const token = (pick as { token: string }).token;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(await t.ctl.add(token)).toEqual({ ok: true });
    expect(await t.ctl.add(token)).toMatchObject({ ok: false });
    expect((await t.ctl.view()).plugins).toMatchObject([{ id: "mine", status: "off", origin: "local", folder }]);
    expect(t.host.start).not.toHaveBeenCalled();
    expect(await t.ctl.pick()).toMatchObject({ ok: false, message: expect.stringMatching(/already/) });
    expect(await t.ctl.approve("mine", (pick as { review: PluginReview }).review.distHash)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["mine"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("on");
  });

  it("pick: cancelled, no plugin.json, or a harness that takes no local plugins", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true } });
    expect(await t.ctl.pick()).toEqual({ ok: false, cancelled: true });
    t.deps.pickFolder.mockResolvedValue(await tmp());
    expect(await t.ctl.pick()).toMatchObject({ ok: false, message: expect.any(String) });
    const u = await setup({ plugins: { bundled: ["x"], on: [], local: false } });
    expect(await u.ctl.pick()).toMatchObject({ ok: false });
    expect(u.deps.pickFolder).not.toHaveBeenCalled();
  });

  it("B8: a dist that adds a host turns the plugin off for review; approve turns it on; code-only stays on, updated until detail", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    const dist = await bundled(t.root, "oncall", { permissions: { hosts: ["a.example.com"] } });
    await t.ctl.start();
    const manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
    await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify({ ...manifest, permissions: { hosts: ["a.example.com", "evil.example.org"] } }));
    const v = await t.ctl.rescan();
    expect(v.plugins[0]).toMatchObject({ status: "review" });
    expect(t.host.stopped).toEqual(["oncall"]);
    const asked = await t.ctl.setOn("oncall", true);
    expect(asked).toMatchObject({ ok: false, review: { added: [{ kind: "host", value: "evil.example.org" }] } });
    expect(await t.ctl.approve("oncall", (asked as { review: PluginReview }).review.distHash)).toEqual({ ok: true });
    expect((await t.ctl.view()).plugins[0].status).toBe("on");
    await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => { /* v2 */ } } };\n");
    const v2 = await t.ctl.rescan();
    expect(v2.plugins[0]).toMatchObject({ status: "on", updated: true });
    await t.ctl.detail("oncall");
    expect((await t.ctl.view()).plugins[0].updated).toBeUndefined();
  });

  it("B8: approve carries the hash the review showed; a plugin.json widened after the review is refused", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    const dist = await bundled(t.root, "oncall", { permissions: { hosts: ["a.example.com"] } });
    await t.ctl.start();
    const manifest = JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8"));
    const widen = async (hosts: string[]) => {
      await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify({ ...manifest, permissions: { hosts } }));
      await t.ctl.rescan();
    };
    await widen(["a.example.com", "b.example.org"]);
    const shown = (await t.ctl.setOn("oncall", true)) as { review: PluginReview };
    expect(shown.review.distHash).toMatch(/^[0-9a-f]{64}$/);
    // Between the review and the click the plugin asks for more.
    await widen(["a.example.com", "b.example.org", "evil.example.org"]);
    expect(await t.ctl.approve("oncall", shown.review.distHash)).toEqual({ ok: false, message: "This plugin changed; review it again" });
    expect(await t.ctl.approve("oncall", undefined as unknown as string)).toMatchObject({ ok: false });
    expect(t.host.started).toEqual(["oncall"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("review");
    const again = (await t.ctl.setOn("oncall", true)) as { review: PluginReview };
    expect(again.review.added).toContainEqual({ kind: "host", value: "evil.example.org" });
    expect(await t.ctl.approve("oncall", again.review.distHash)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["oncall", "oncall"]);
  });

  it("a dev plugin turned off stays off across a rescan, until turned on", async () => {
    const dev = path.dirname(await writePlugin(await tmp(), "devp"));
    const t = await setup({ over: { devDirs: [dev] } });
    await t.ctl.start();
    expect(t.host.started).toEqual(["devp"]);
    expect(await t.ctl.setOn("devp", false)).toEqual({ ok: true });
    await t.ctl.rescan();
    expect(t.host.started).toEqual(["devp"]);
    expect((await t.ctl.view()).plugins[0].status).toBe("off");
    expect(await t.ctl.setOn("devp", true)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["devp", "devp"]);
  });

  it("turning off or removing during a run logs nothing and leaves no error log behind", async () => {
    const t = await setup({ plugins: { bundled: [], on: [], local: true }, backends: { mine: { s: () => new Promise(() => {}) } } });
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { permissions: { secrets: [{ id: "tok", label: "Token" }] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = (await t.ctl.pick()) as { token: string; review: PluginReview };
    await t.ctl.add(pick.token);
    await t.ctl.setSecret("mine", "tok", "secret-value-123");
    await t.ctl.approve("mine", pick.review.distHash);
    await until(async () => (await t.ctl.detail("mine"))!.sources[0].running);
    await t.ctl.setOn("mine", false);
    await new Promise((r) => setTimeout(r, 50));
    expect((await t.ctl.detail("mine"))?.errors).toEqual([]);
    await t.ctl.setOn("mine", true);
    await until(async () => (await t.ctl.detail("mine"))!.sources[0].running);
    expect(await t.ctl.remove("mine")).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 100));
    expect((await files(t.base)).filter((f) => f.includes("mine"))).toEqual([]);
  });

  it("setOn false stops the backend; setOn true without an approval returns the review and starts nothing", async () => {
    const t = await setup({ plugins: { bundled: ["a", "b"], on: ["a"], local: false } });
    await bundled(t.root, "a");
    await bundled(t.root, "b", { permissions: { hosts: ["b.example.com"] } });
    await t.ctl.start();
    expect(await t.ctl.setOn("a", false)).toEqual({ ok: true });
    expect(t.host.stopped).toEqual(["a"]);
    expect(t.ctl.channelOf("a")).toBeNull();
    expect(await t.ctl.setOn("a", true)).toEqual({ ok: true });
    expect(t.host.started).toEqual(["a", "a"]);
    expect(await t.ctl.setOn("b", true)).toMatchObject({ ok: false, review: { id: "b" } });
    expect(t.host.started).toEqual(["a", "a"]);
  });

  it("remove: local only; deletes pointer, state, data, attention items and keys; never the folder", async () => {
    const t = await setup({
      plugins: { bundled: ["bun"], on: [], local: true },
      backends: { mine: { s: async (ctx) => (await ctx.data.put("queues", { key: "a" }), void (await ctx.attention.raise({ key: "k", severity: "action", title: "Look" }))) } },
    });
    await bundled(t.root, "bun");
    const folder = path.dirname(await writePlugin(await tmp(), "mine", { data: { queues: QUEUES }, permissions: { secrets: [{ id: "tok", label: "Token" }] } }));
    t.deps.pickFolder.mockResolvedValue(folder);
    await t.ctl.start();
    const pick = (await t.ctl.pick()) as { token: string; review: PluginReview };
    await t.ctl.add(pick.token);
    await t.ctl.approve("mine", pick.review.distHash);
    expect(await t.ctl.setSecret("mine", "tok", "secret-value-123")).toEqual({ ok: true });
    await until(async () => (await t.ctl.attention.view()).items.length === 1);
    expect(await t.ctl.remove("bun")).toMatchObject({ ok: false });
    expect(await t.ctl.remove("mine")).toEqual({ ok: true });
    expect(await t.deps.pointers.list()).toEqual([]);
    const left = await files(t.base);
    expect(left.filter((f) => f.includes("mine"))).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(t.base, ".harness", "attention.json"), "utf8"))).toEqual([]);
    expect(await t.deps.secrets.stored("mine")).toEqual([]);
    expect(await files(folder)).toEqual([path.join("dist", "backend.js"), path.join("dist", "plugin.json")].sort());
    expect((await t.ctl.view()).plugins.map((p) => p.id)).toEqual(["bun"]);
  });
});

describe("PluginsController: settings, keys, test", () => {
  it("validates settings, stores only changes, and the backend sees them with its work hours", async () => {
    let seen: Record<string, unknown> | undefined;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: async (ctx) => void (seen = await ctx.settings.get()) } },
    });
    await bundled(t.root, "oncall", { name: "On-call", sources: [{ id: "s", ttl: 600, workHoursOnly: true }], settings: { fields: { team: TEAM } } });
    await t.ctl.start();
    expect(await t.ctl.setSetting("oncall", "team", "nope")).toMatchObject({ ok: false, message: expect.any(String) });
    expect(await t.ctl.setSetting("oncall", "nope", "web")).toMatchObject({ ok: false });
    expect(await t.ctl.setSetting("oncall", "team", "web")).toEqual({ ok: true });
    expect(await t.ctl.setWorkHours("oncall", { days: [1, 1], from: "09:00", to: "17:00", timezone: "UTC" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1], from: "9:00", to: "17:00", timezone: "UTC" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1], from: "09:00", to: "17:00", timezone: "Mars/Olympus" })).toMatchObject({ ok: false });
    expect(await t.ctl.setWorkHours("oncall", { days: [1, 2], from: "09:00", to: "17:00", timezone: "UTC" })).toEqual({ ok: true });
    const results = await t.ctl.test("oncall");
    expect(results).toEqual([{ source: "s", ok: true, writes: 0 }]);
    expect(seen).toEqual({ team: "web", workHours: { days: [1, 2], from: "09:00", to: "17:00", timezone: "UTC" } });
    const detail = await t.ctl.detail("oncall");
    expect(detail).toMatchObject({ values: { team: "web" }, workHours: { days: [1, 2] }, settings: { fields: [{ name: "team" }] } });
    expect(await t.ctl.setSetting("oncall", "team", "docs")).toEqual({ ok: true });
    expect(await t.ctl.resetSettings("oncall")).toEqual({ ok: true });
    expect((await t.ctl.detail("oncall"))?.workHours).toMatchObject({ days: [1, 2] });
  });

  it("B6: keys go through the SecretStore and no value appears in the detail or the view", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    await bundled(t.root, "oncall", { permissions: { secrets: [{ id: "tok", label: "Token", help: "From settings" }] } });
    await t.ctl.start();
    expect(await t.ctl.setSecret("oncall", "other", "secret-value-123")).toMatchObject({ ok: false });
    expect(await t.ctl.setSecret("oncall", "tok", "secret-value-123")).toEqual({ ok: true });
    const detail = await t.ctl.detail("oncall");
    expect(detail?.secrets).toEqual([{ id: "tok", label: "Token", help: "From settings", stored: true }]);
    expect(JSON.stringify(detail)).not.toContain("secret-value-123");
    expect(JSON.stringify(await t.ctl.view())).not.toContain("secret-value-123");
    expect(JSON.stringify((t.deps.changed as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("secret-value-123");
    await t.ctl.deleteSecret("oncall", "tok");
    expect((await t.ctl.detail("oncall"))?.secrets[0].stored).toBe(false);
  });

  let runs = 0;
  it("a failing run's error is redacted of the plugin's keys before the log and the status", async () => {
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      // The first run (at start, before the key is stored) succeeds; later ones echo the key back.
      backends: { oncall: { s: async () => (runs++ === 0 ? undefined : Promise.reject(new Error("bad token secret-value-123"))) } },
    });
    await bundled(t.root, "oncall", { permissions: { secrets: [{ id: "tok", label: "Token" }] } });
    await t.ctl.start();
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.setSecret("oncall", "tok", "secret-value-123")).toEqual({ ok: true });
    const [r] = await t.ctl.test("oncall");
    expect(r).toMatchObject({ ok: false, error: "bad token [redacted]" });
    const detail = await t.ctl.detail("oncall");
    expect(JSON.stringify(detail)).not.toContain("secret-value-123");
    expect(detail?.errors[0]).toMatchObject({ source: "s", message: "bad token [redacted]" });
  });

  it("refresh is refused for a plugin that is off or a source it doesn't declare", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    expect(await t.ctl.refresh("oncall", "s")).toMatchObject({ ok: false });
    expect(await t.ctl.test("oncall")).toEqual([{ source: "s", ok: false, error: expect.any(String) }]);
  });
});

describe("PluginsController: crashes and the run limit", () => {
  it("restarts a crashed backend after the policy's delay; the 5th crash in an hour turns it off with an action item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, over: { clock: () => now } });
    await bundled(t.root, "oncall", { name: "On-call" });
    await t.ctl.start();
    for (let i = 0; i < 4; i++) {
      t.gone("oncall");
      t.gone("oncall"); // the same window twice counts once
      await vi.advanceTimersByTimeAsync(0);
      const starts = t.host.started.length;
      await vi.advanceTimersByTimeAsync(1000 * 2 ** i - 1);
      expect(t.host.started.length).toBe(starts);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(t.host.started.length).toBe(starts + 1));
      now += 1000;
    }
    t.gone("oncall");
    vi.useRealTimers();
    await until(async () => (await t.ctl.view()).plugins[0].status === "crashed");
    expect(t.ctl.channelOf("oncall")).toBeNull();
    const att = await t.ctl.attention.view();
    expect(att.items).toMatchObject([{ plugin: "oncall", key: "crashed", severity: "action", title: "On-call was turned off" }]);
    expect(att.badge).toBe(1);
    expect(await t.ctl.setOn("oncall", true)).toEqual({ ok: true });
  });

  it("a run over the limit fails, the window reloads, and its run id is dead", async () => {
    let late: Ctx | undefined;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (ctx) => ((late = ctx), new Promise(() => {})) } },
      over: { runLimitMs: 50 },
    });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await until(() => (t.host.reload as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    // The old page's channel is closed and its run ids are dead.
    await expect(late!.data.put("queues", { key: "x" })).rejects.toThrow(/ended|stopped/);
    // The log lines are written after the reload.
    await until(async () => /took too long/.test(((await t.ctl.detail("oncall"))?.errors ?? []).map((e) => e.message).join("\n")));
  });
  it("after a reload a queued run reaches the new page, not the old page's waiting next", async () => {
    let calls = 0;
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      // The first run hangs past the limit; later ones finish.
      backends: { oncall: { s: () => (calls++ === 0 ? new Promise<void>(() => {}) : Promise.resolve()) } },
      over: { runLimitMs: 100, idleMs: 60_000 },
    });
    await bundled(t.root, "oncall");
    await t.ctl.start();
    await until(() => (t.host.reload as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(await t.ctl.refresh("oncall", "s")).toEqual({ ok: true });
    expect(t.host.reload).toHaveBeenCalledTimes(1);
  });
});

describe("PluginsController: attention", () => {
  it("lists items of on plugins with the plugin's name; badge counts unread actions; notify only when asked", async () => {
    let ctx: Ctx | undefined;
    const u = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { s: (c) => ((ctx = c), new Promise(() => {})) } },
    });
    await bundled(u.root, "oncall", { name: "On-call" });
    await u.ctl.start();
    expect(await u.ctl.attention.view()).toEqual({ items: [], badge: 0, show: true });
    await until(() => ctx !== undefined);
    await ctx!.attention.raise({ key: "a1", severity: "action", title: "Page", body: "<img src=x onerror=alert(1)>" });
    await ctx!.attention.raise({ key: "i1", severity: "info", title: "FYI" });
    expect(u.deps.notify).not.toHaveBeenCalled();
    let v = await u.ctl.attention.view();
    expect(v.items.map((i) => [i.key, i.pluginName, i.read])).toEqual([
      ["i1", "On-call", false],
      ["a1", "On-call", false],
    ]);
    expect(v.badge).toBe(1);
    await u.ctl.setNotify("oncall", true);
    await ctx!.attention.raise({ key: "a2", severity: "action", title: "Page 2" });
    expect(u.deps.notify).toHaveBeenCalledWith("On-call: Page 2", "");
    await u.ctl.attention.read("oncall", "a1");
    await u.ctl.attention.dismiss("oncall", "i1");
    v = await u.ctl.attention.view();
    expect(v.items.map((i) => i.key)).toEqual(["a2", "a1"]);
    expect(v.badge).toBe(1);
    expect(u.deps.attentionChanged).toHaveBeenCalled();
    // Off: its items hide, and with nothing on the icon goes.
    await u.ctl.setOn("oncall", false);
    expect(await u.ctl.attention.view()).toEqual({ items: [], badge: 0, show: false });
  });
});

describe("PluginsController: agent surface", () => {
  it("catalogue, data route, sentences, staleness", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, backends: { oncall: { s: async (ctx) => void (await ctx.data.put("queues", { key: "a", n: 2 })) } } });
    await bundled(t.root, "oncall", { name: "On-call", data: { queues: QUEUES, hidden: HIDDEN }, settings: { fields: { team: TEAM } } });
    t.ctl.markRuntimeBuilt(false);
    await t.ctl.start();
    expect(t.ctl.agentCatalogue()).toEqual([{ name: "oncall.queues", key: "key", single: false, fields: QUEUES.schema }]);
    expect(t.ctl.takeRuntimeStale()).toBe(true);
    expect(t.ctl.takeRuntimeStale()).toBe(false);
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.agentData({ op: "query", collection: "oncall.queues" })).toMatchObject({ records: [{ key: "a", n: 2 }] });
    await expect(t.ctl.agentData({ op: "put", collection: "oncall.queues", record: { key: "b" } })).rejects.toMatchObject({ code: "refused" });
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.hidden" })).rejects.toMatchObject({ code: "refused" });
    await expect(t.ctl.agentData({ op: "query", collection: "other.queues" })).rejects.toMatchObject({ code: "refused" });
    expect(await t.ctl.sentences()).toEqual(["On-call: Our team is docs."]);
    const file = await t.ctl.catalogueFile(t.base);
    expect(JSON.parse(await fs.readFile(file!, "utf8"))).toEqual(t.ctl.agentCatalogue());

    t.deps.refreshInstructions.mockClear();
    await t.ctl.setSetting("oncall", "team", "web");
    await t.ctl.betweenTasks();
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).toHaveBeenCalledTimes(1);
    expect(await t.ctl.sentences()).toEqual(["On-call: Our team is web."]);

    t.deps.refreshInstructions.mockClear();
    await t.ctl.setOn("oncall", false);
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).toHaveBeenCalledTimes(1);
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.queues" })).rejects.toMatchObject({ code: "refused" });
    expect(await t.ctl.sentences()).toEqual([]);
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.catalogueFile(t.base)).toBeNull();
    expect(t.ctl.takeRuntimeStale()).toBe(true);
    expect(t.ctl.takeRuntimeStale()).toBe(false);
  });

  it("D0: nothing on → no staleness, no catalogue file", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: [], local: false } });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await t.ctl.betweenTasks();
    expect(t.deps.refreshInstructions).not.toHaveBeenCalled();
    expect(t.ctl.takeRuntimeStale()).toBe(false);
    expect(await t.ctl.catalogueFile(t.base)).toBeNull();
    expect(await t.ctl.contextTables(undefined)).toBe("");
    expect(await files(t.userData)).toEqual([]);
  });
});

describe("PluginsController: base changes", () => {
  it("a base switch without rebase stops the old base's plugins and shows nothing of it until rebase", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false }, backends: { oncall: { s: async (ctx) => void (await ctx.data.put("queues", { key: "a", n: 1 })) } } });
    await bundled(t.root, "oncall", { data: { queues: QUEUES } });
    await t.ctl.start();
    await until(async () => (await t.ctl.detail("oncall"))!.sources[0].lastOk !== undefined);
    expect(await t.ctl.agentData({ op: "query", collection: "oncall.queues" })).toMatchObject({ records: [{ key: "a" }] });
    const other = await tmp("hh-pl-base2-");
    t.setBase(other);
    await expect(t.ctl.agentData({ op: "query", collection: "oncall.queues" })).rejects.toMatchObject({ code: "refused" });
    await until(() => t.host.stopped.includes("oncall"));
    expect(t.ctl.channelOf("oncall")).toBeNull();
    expect(t.ctl.agentCatalogue()).toEqual([]);
    expect(await t.ctl.contextTables(undefined)).toBe("");
    expect(await t.ctl.sentences()).toEqual([]);
    const row = (await t.ctl.view()).plugins[0];
    expect(row.status).not.toBe("on");
    expect(row.lastSync).toBeUndefined();
    expect(await t.ctl.setOn("oncall", true)).toMatchObject({ ok: false });
    expect(t.host.started).toEqual(["oncall"]);
    expect(await files(other)).toEqual([]);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall", "oncall"]);
  });

  it("rebase stops the old base's backends and starts the new base's; before setup nothing starts", async () => {
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: false } });
    await bundled(t.root, "oncall");
    t.setBase(null);
    await t.ctl.start();
    expect(t.host.start).not.toHaveBeenCalled();
    t.setBase(t.base);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall"]);
    const other = await tmp("hh-pl-base2-");
    await t.ctl.setOn("oncall", false);
    t.setBase(other);
    await t.ctl.rebase();
    // The new base has its own state: the harness's plugin starts on there.
    expect(t.host.started).toEqual(["oncall", "oncall"]);
    expect(t.host.stopped).toEqual(["oncall"]);
    t.setBase(t.base);
    await t.ctl.rebase();
    expect(t.host.started).toEqual(["oncall", "oncall"]);
    expect(t.host.stopAll).toHaveBeenCalled();
  });
});
