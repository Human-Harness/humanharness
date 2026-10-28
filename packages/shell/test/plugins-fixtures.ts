import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import type { HarnessPlugins, SlotDef } from "@humanharness/harness-sdk";
import type { PluginChannel } from "../src/main/plugin-channel";
import { PluginPointers } from "../src/main/plugin-load";
import { SecretStore } from "../src/main/plugin-secrets";
import { type BackendHost, PluginsController, type PluginsDeps } from "../src/main/plugins";

/** Shared by the PluginsController tests: a fake backend host over a real PluginChannel, temp folders, setup(). */

/** A reversible fake of safeStorage (never the real Keychain). */
export const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString(),
};
export const tmp = (p = "hh-pl-ctl-") => fs.mkdtemp(path.join(os.tmpdir(), p));

export const QUEUES = { key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" }, n: { type: "number" } }, required: ["key"] } };
export const HIDDEN = { key: "key", agent: "none", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } };
export const TEAM = { schema: { type: "string", enum: ["docs", "web"] }, default: "docs", control: "select", label: "Team", agent: "Our team is {{value}}." };

export async function writePlugin(root: string, name: string, over: Record<string, unknown> = {}) {
  const dist = path.join(root, name, "dist");
  await fs.mkdir(dist, { recursive: true });
  const manifest = { id: name, name: name, version: "1.0.0", api: 1, harness: "*", permissions: {}, sources: [{ id: "s", ttl: 600 }], ...over };
  await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => {} } };\n");
  return dist;
}

/** Every file under `dir` (relative), for "nothing was written" checks. */
export async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)));
  return out;
}

export async function until(f: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

export type Ctx = {
  call(name: string, ...args: unknown[]): Promise<unknown>;
  data: { put(c: string, r: unknown): Promise<unknown>; query(c: string, q?: unknown): Promise<unknown> };
  settings: { get(): Promise<Record<string, unknown>> };
  attention: { raise(i: unknown): Promise<unknown> };
};
export type Source = (ctx: Ctx) => Promise<void>;

/** Plays the core host script's part over a real PluginChannel (Decision 10). */
export function fakeHost(backends: Record<string, Record<string, Source>>) {
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

export interface Setup {
  plugins?: HarnessPlugins;
  slots?: SlotDef[];
  backends?: Record<string, Record<string, Source>>;
  over?: Partial<PluginsDeps>;
}

const controllers: PluginsController[] = [];
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.stop();
  vi.useRealTimers();
});

export async function setup(s: Setup = {}) {
  const root = await tmp();
  const base = await tmp("hh-pl-base-");
  const shared = await tmp("hh-pl-shared-");
  const userData = await tmp("hh-pl-ud-");
  const appDir = path.join(shared, "h");
  const fake = fakeHost(s.backends ?? {});
  let currentBase: string | null = base;
  const deps = {
    harness: { id: "h", name: "H", root, ...(s.plugins ? { plugins: s.plugins } : {}), ...(s.slots ? { slots: s.slots } : {}) },
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

export const bundled = async (root: string, id: string, over: Record<string, unknown> = {}) => writePlugin(path.join(root, "plugins"), id, over);
