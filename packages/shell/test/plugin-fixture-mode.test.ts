import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { PluginBroker } from "../src/main/plugin-broker";
import { watchPluginFolder } from "../src/main/plugins";
import { type Ctx, bundled, setup, tmp, until, writePlugin } from "./plugins-fixtures";

const FIXTURE = {
  kind: "fetch",
  request: { method: "GET", url: "https://api.example.com/q", headers: { authorization: "Bearer {{secret:jira}}" } },
  response: { status: 200, headers: { "content-type": "text/plain" }, text: "from the fixture" },
};
const ONCALL = {
  permissions: { hosts: ["api.example.com"], secrets: [{ id: "jira", label: "Jira" }] },
  sources: [{ id: "queues", ttl: 600 }],
};

async function writeFixtures(folder: string, source: string, files: Record<string, unknown>) {
  const dir = path.join(folder, "fixtures", source);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
}

/** On-call (bundled, on) whose `queues` source fetches the queue with its Jira key; the outcome is kept. */
async function oncall(o: { fixtures?: boolean; files?: Record<string, unknown> } = {}) {
  const got: { value?: unknown; error?: string }[] = [];
  const fetchSpy = vi.fn(async () => new Response("live"));
  const t = await setup({
    plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
    backends: {
      oncall: {
        queues: async (ctx: Ctx) => {
          try {
            got.push({ value: await ctx.call("fetch", "https://api.example.com/q", { headers: { authorization: "Bearer {{secret:jira}}" } }) });
          } catch (e) {
            got.push({ error: (e as Error).message });
            throw e;
          }
        },
      },
    },
    over: { fetch: fetchSpy as unknown as typeof fetch, ...(o.fixtures !== undefined ? { fixtures: o.fixtures } : {}) },
  });
  const dist = await bundled(t.root, "oncall", ONCALL);
  if (o.files) await writeFixtures(path.dirname(dist), "queues", o.files);
  const values = vi.spyOn(t.deps.secrets, "values");
  await t.deps.secrets.set("oncall", "jira", "real-secret-123");
  await t.ctl.start();
  return { ...t, got, fetchSpy, values };
}

const errors = async (t: Awaited<ReturnType<typeof oncall>>) => ((await t.ctl.detail("oncall"))?.errors ?? []).map((e) => e.message).join("\n");

describe("PluginBroker transport seam (fixture mode)", () => {
  const manifest = parsePluginManifest({
    id: "oncall", name: "On-call", version: "1.0.0", api: 1, harness: "*",
    permissions: { hosts: ["api.example.com"], exec: [{ cmd: "gh", args: ["api", "*"] }] },
    sources: [{ id: "a", ttl: 300 }, { id: "b", ttl: 300 }],
  });
  function broker() {
    const calls: string[] = [];
    const transport = vi.fn((source: string) => ({
      fetch: (async (url: string) => (calls.push(`${source} fetch ${url}`), new Response("t"))) as unknown as typeof fetch,
      run: (async (file: string, args: string[]) => (calls.push(`${source} run ${file} ${args.join(" ")}`), { code: 0, stdout: "o", stderr: "" })) as never,
    }));
    const live = vi.fn(async () => new Response("live"));
    const liveRun = vi.fn();
    const b = new PluginBroker({
      manifest,
      data: { run: async () => null },
      secrets: async () => ({}),
      settings: async () => ({}),
      attention: { raise: async () => {}, resolve: async () => {} },
      chips: () => {},
      log: async () => {},
      fetch: live as unknown as typeof fetch,
      exec: { resolve: async () => "/bin/gh", run: liveRun as never, cwd: async () => "/c", env: async () => ({}) },
      transport,
    });
    return { b, calls, transport, live, liveRun };
  }

  it("each run's fetch and exec go through the transport of that run's source, never the live ones", async () => {
    const { b, calls, live, liveRun } = broker();
    const a = b.startRun("a");
    const r = b.startRun("b");
    expect(await b.call(a.id, "fetch", ["https://api.example.com/x"])).toMatchObject({ ok: true, value: { status: 200, text: "t" } });
    expect(await b.call(r.id, "exec", ["gh", ["api", "y"]])).toMatchObject({ ok: true, value: { stdout: "o" } });
    expect(calls).toEqual(["a fetch https://api.example.com/x", "b run /bin/gh api y"]);
    expect(live).not.toHaveBeenCalled();
    expect(liveRun).not.toHaveBeenCalled();
  });

  it("B2/B7 still hold: an undeclared host, http, or an undeclared command is refused before the transport is called", async () => {
    const { b, calls, transport } = broker();
    const run = b.startRun("a");
    expect(await b.call(run.id, "fetch", ["https://evil.example.org/x"])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "fetch", ["http://api.example.com/x"])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "exec", ["rm", ["-rf", "/"]])).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    // The transport may be looked up, but nothing went through it.
    expect(transport.mock.calls.every(([s]) => s === "a")).toBe(true);
  });
});

describe("PluginsController in fixture mode (P10)", () => {
  it("a run plays the plugin's fixture; the live fetch and the key store are never touched", async () => {
    const t = await oncall({ fixtures: true, files: { "001.json": FIXTURE } });
    await until(() => t.got.length > 0);
    expect(t.got[0]).toEqual({ value: expect.objectContaining({ status: 200, text: "from the fixture" }) });
    expect(t.fetchSpy).not.toHaveBeenCalled();
    expect(t.values).not.toHaveBeenCalled();
  });

  it("keys are fixture-<id>: the broker fills and redacts that, never the stored value", async () => {
    let seen: { text?: string } = {};
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { queues: async (ctx: Ctx) => void (seen = (await ctx.call("fetch", "https://api.example.com/echo", { headers: { a: "{{secret:jira}}" } })) as typeof seen) } },
      over: { fixtures: true },
    });
    const dist = await bundled(t.root, "oncall", ONCALL);
    // A response that echoes a key: the broker redacts the value it filled in, so this shows which value that was.
    await writeFixtures(path.dirname(dist), "queues", {
      "001.json": { ...FIXTURE, request: { method: "GET", url: "https://api.example.com/echo" }, response: { status: 200, headers: {}, text: "fixture-jira|real-secret-123" } },
    });
    const values = vi.spyOn(t.deps.secrets, "values");
    await t.deps.secrets.set("oncall", "jira", "real-secret-123");
    await t.ctl.start();
    await until(() => seen.text !== undefined);
    expect(seen.text).toBe("[redacted]|real-secret-123");
    expect(values).not.toHaveBeenCalled();
  });

  it("a request with no fixture fails the run with 'No fixture for GET …' in the error log", async () => {
    const t = await oncall({ fixtures: true });
    await until(async () => /No fixture for GET https:\/\/api\.example\.com\/q/.test(await errors(t)));
    expect(t.fetchSpy).not.toHaveBeenCalled();
    expect(t.values).not.toHaveBeenCalled();
  });

  it("bad fixture files are logged and skipped; links and other files are not read", async () => {
    const log = vi.fn();
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { queues: async (ctx: Ctx) => void (await ctx.call("fetch", "https://api.example.com/q")) } },
      over: { fixtures: true, log },
    });
    const dist = await bundled(t.root, "oncall", ONCALL);
    const outside = path.join(await tmp(), "outside.json");
    await fs.writeFile(outside, JSON.stringify(FIXTURE));
    await writeFixtures(path.dirname(dist), "queues", { "001.json": "{ not json", "002.json": { kind: "fetch" }, "notes.txt": JSON.stringify(FIXTURE) });
    await fs.symlink(outside, path.join(path.dirname(dist), "fixtures", "queues", "003.json"));
    await t.ctl.start();
    await until(async () => /No fixture for GET/.test(((await t.ctl.detail("oncall"))?.errors ?? []).map((e) => e.message).join("\n")));
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/001\.json/);
    expect(logged).toMatch(/002\.json/);
    expect(logged).not.toMatch(/notes\.txt/);
  });

  it("reads at most 200 fixture files per source", async () => {
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { queues: async (ctx: Ctx) => void (await ctx.call("fetch", "https://api.example.com/q")) } },
      over: { fixtures: true },
    });
    const dist = await bundled(t.root, "oncall", ONCALL);
    const files: Record<string, unknown> = {};
    // 200 files that answer nothing, then the one that would answer (file-name order).
    for (let i = 1; i <= 200; i++) files[`${String(i).padStart(3, "0")}.json`] = { ...FIXTURE, request: { method: "GET", url: "https://api.example.com/other" } };
    files["201.json"] = FIXTURE;
    await writeFixtures(path.dirname(dist), "queues", files);
    await t.ctl.start();
    await until(async () => /No fixture for GET/.test(((await t.ctl.detail("oncall"))?.errors ?? []).map((e) => e.message).join("\n")));
  });

  it("dev plugins read fixtures from their folder (the parent of dist/)", async () => {
    let got: unknown;
    const dist = await writePlugin(await tmp(), "devp", ONCALL);
    await writeFixtures(path.dirname(dist), "queues", { "001.json": FIXTURE });
    const t = await setup({
      backends: { devp: { queues: async (ctx: Ctx) => void (got = await ctx.call("fetch", "https://api.example.com/q")) } },
      over: { devDirs: [dist], fixtures: true },
    });
    await t.ctl.start();
    await until(() => got !== undefined);
    expect(got).toMatchObject({ text: "from the fixture" });
  });

  it("the host check (allowHost) is skipped in fixture mode only", async () => {
    for (const fixtures of [true, false]) {
      const allowHost = vi.fn(async () => true);
      let done = false;
      const t = await setup({
        plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
        backends: { oncall: { queues: async (ctx: Ctx) => void (await ctx.call("fetch", "https://api.example.com/q").finally(() => (done = true))) } },
        over: { fixtures, allowHost, fetch: (async () => new Response("live")) as unknown as typeof fetch },
      });
      const dist = await bundled(t.root, "oncall", ONCALL);
      await writeFixtures(path.dirname(dist), "queues", { "001.json": FIXTURE });
      await t.ctl.start();
      await until(() => done);
      if (fixtures) expect(allowHost).not.toHaveBeenCalled();
      else expect(allowHost).toHaveBeenCalledWith("api.example.com");
    }
  });

  it("a command in fixture mode spawns nothing for its env: no login-shell env lookup, a fixed minimal env", async () => {
    let got: unknown;
    const env = vi.fn(async () => ({ PATH: "/bin", HOME: "/h", LANG: "C" }));
    const run = vi.fn();
    const resolve = vi.fn(async () => "/bin/gh");
    const t = await setup({
      plugins: { bundled: ["oncall"], on: ["oncall"], local: false },
      backends: { oncall: { queues: async (ctx: Ctx) => void (got = await ctx.call("exec", "gh", ["api", "user"])) } },
      over: { fixtures: true, exec: { resolve, run: run as never, env } },
    });
    const dist = await bundled(t.root, "oncall", { permissions: { exec: [{ cmd: "gh", args: ["api", "*"] }] }, sources: [{ id: "queues", ttl: 600 }] });
    await writeFixtures(path.dirname(dist), "queues", { "001.json": { kind: "exec", request: { cmd: "gh", args: ["api", "user"] }, response: { code: 0, stdout: "me", stderr: "" } } });
    await t.ctl.start();
    await until(() => got !== undefined);
    expect(got).toMatchObject({ code: 0, stdout: "me" });
    expect(env).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("D0: without fixtures the live fetch and the stored key are used, as before", async () => {
    for (const fixtures of [undefined, false]) {
      const t = await oncall({ fixtures, files: { "001.json": FIXTURE } });
      await until(() => t.got.length > 0);
      expect(t.got[0]).toEqual({ value: expect.objectContaining({ text: "live" }) });
      expect(t.fetchSpy).toHaveBeenCalledTimes(1);
      expect(new Headers((t.fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("authorization")).toBe("Bearer real-secret-123");
      expect(t.values).toHaveBeenCalled();
    }
  });
});

describe("PluginsController dev watcher (Decision 22)", () => {
  function watcher() {
    const watched = new Map<string, (name: string | null) => void>();
    const unwatched: string[] = [];
    const watch = vi.fn((dir: string, onChange: (name: string | null) => void) => {
      watched.set(dir, onChange);
      return () => void unwatched.push(dir);
    });
    return { watch, watched, unwatched };
  }

  it("a change in a dev plugin's dist/ → after 300 ms: rescan (new code restarts) and its frames remount", async () => {
    const dist = await writePlugin(await tmp(), "devp", { panels: [{ id: "main", title: "Main" }] });
    const w = watcher();
    const surfaceChanged = vi.fn();
    const t = await setup({ over: { devDirs: [path.dirname(dist)], watch: w.watch, surfaceChanged } });
    await t.ctl.start();
    // The plugin folder is watched, not dist/: every `plugin build` renames dist/ away and a new one in.
    const real = path.dirname(await fs.realpath(dist));
    expect([...w.watched.keys()]).toEqual([real]);
    expect(t.host.started).toEqual(["devp"]);
    await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => { /* v2 */ } } };\n");
    const fire = w.watched.get(real)!;
    fire("dist");
    fire(path.join("dist", "backend.js"));
    await new Promise((r) => setTimeout(r, 150));
    fire(null);
    expect(t.host.started).toEqual(["devp"]);
    await until(() => t.ctl.surface().reloads.devp === 1, 2000);
    expect(t.host.started).toEqual(["devp", "devp"]);
    await new Promise((r) => setTimeout(r, 400));
    expect(t.ctl.surface().reloads.devp).toBe(1);
    await t.ctl.stop();
    expect(w.unwatched).toEqual([real]);
  });

  it("only dist/ counts: a build's dist.tmp-*/dist.old-* folders, sources and fixtures don't reload", async () => {
    const dist = await writePlugin(await tmp(), "devp", { panels: [{ id: "main", title: "Main" }] });
    const w = watcher();
    const t = await setup({ over: { devDirs: [path.dirname(dist)], watch: w.watch } });
    await t.ctl.start();
    const fire = w.watched.get(path.dirname(await fs.realpath(dist)))!;
    for (const name of ["dist.tmp-1a2b", path.join("dist.tmp-1a2b", "backend.js"), "dist.old-3c4d", path.join("dist.old-3c4d", "plugin.json"), "backend.ts", path.join("fixtures", "s", "001.json"), "distx"]) fire(name);
    await new Promise((r) => setTimeout(r, 450));
    expect(t.ctl.surface().reloads.devp ?? 0).toBe(0);
    expect(t.host.started).toEqual(["devp"]);
    // The swap landing: the rename into dist/ is the change.
    fire("dist");
    await until(() => t.ctl.surface().reloads.devp === 1, 2000);
  });

  it("reload survives repeated build swaps (out.tmp → out, old → out.old) with the app's real watcher", async () => {
    const dist = await writePlugin(await tmp(), "devp", { panels: [{ id: "main", title: "Main" }] });
    const folder = path.dirname(dist);
    const log = vi.fn();
    const t = await setup({ over: { devDirs: [folder], watch: watchPluginFolder, log } });
    await t.ctl.start();
    // As `plugin build` does: build into dist.tmp-<hex>, move dist/ away, move the new one in, delete the old.
    // Counted from before each swap: the OS may still deliver events from writing the plugin in the first place.
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const reloads = t.ctl.surface().reloads.devp ?? 0;
      const started = t.host.started.length;
      const tmpDir = path.join(folder, `dist.tmp-${i}abc`);
      const oldDir = path.join(folder, `dist.old-${i}def`);
      await fs.mkdir(tmpDir);
      await fs.copyFile(path.join(dist, "plugin.json"), path.join(tmpDir, "plugin.json"));
      await fs.writeFile(path.join(tmpDir, "backend.js"), `export default { sources: { s: async () => { /* v${i + 1} */ } } };\n`);
      await fs.rename(dist, oldDir);
      await fs.rename(tmpDir, dist);
      await fs.rm(oldDir, { recursive: true });
      await until(() => (t.ctl.surface().reloads.devp ?? 0) > reloads && t.host.started.length > started, 4000);
    }
    await t.ctl.stop();
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });

  it("bundled and local plugins are never watched; no dev plugins → watch is never called", async () => {
    const w = watcher();
    const t = await setup({ plugins: { bundled: ["oncall"], on: ["oncall"], local: true }, over: { watch: w.watch } });
    await bundled(t.root, "oncall", ONCALL);
    await t.ctl.start();
    await t.ctl.rescan();
    expect(w.watch).not.toHaveBeenCalled();
  });
});
