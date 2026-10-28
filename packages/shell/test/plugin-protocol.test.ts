import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_CSP,
  PLUGIN_FILE_MAX_BYTES,
  RPC_MAX_BYTES,
  allowPluginRequest,
  isPluginFrame,
  parsePluginRpc,
  pluginHostUrl,
  pluginOfSender,
  readPluginFile,
  resolvePluginFile,
} from "../src/main/plugin-protocol";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-proto-"));
  const dist = path.join(root, "oncall", "dist");
  await fs.mkdir(path.join(dist, "assets"), { recursive: true });
  await fs.mkdir(path.join(dist, "_hh"), { recursive: true });
  await fs.writeFile(path.join(dist, "backend.js"), "x");
  await fs.writeFile(path.join(dist, "assets", "logo.svg"), "<svg/>");
  await fs.writeFile(path.join(dist, "_hh", "host.js"), "plugin's own");
  await fs.writeFile(path.join(dist, ".env"), "SECRET=1");
  await fs.writeFile(path.join(dist, "notes.md"), "x");
  await fs.writeFile(path.join(root, "outside.js"), "x");
  await fs.symlink(path.join(root, "outside.js"), path.join(dist, "link.js"));
  await fs.symlink(path.join(dist, "backend.js"), path.join(dist, "inner-link.js"));
  await fs.symlink(path.join(root), path.join(dist, "up"));
  await fs.link(path.join(root, "outside.js"), path.join(dist, "hard.js"));
  const other = path.join(root, "other", "dist");
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(path.join(other, "backend.js"), "other");
  const core = path.join(root, "core");
  await fs.mkdir(core);
  await fs.writeFile(path.join(core, "plugin-host.html"), "<html>");
  await fs.writeFile(path.join(core, "plugin-host.mjs"), "x");
  return { root, dist: await fs.realpath(dist), core: await fs.realpath(core) };
}

describe("resolvePluginFile (plugins spec §4.1, B3, B4)", () => {
  it("serves the plugin's own files and the core's _hh files", async () => {
    const s = await setup();
    const r = (url: string) => resolvePluginFile(url, { id: "oncall", dist: s.dist, core: s.core });
    expect(await r("hh-plugin://oncall/backend.js")).toEqual({ file: path.join(s.dist, "backend.js"), type: "text/javascript" });
    expect(await r("hh-plugin://oncall/backend.js?v=1")).toEqual({ file: path.join(s.dist, "backend.js"), type: "text/javascript" });
    expect(await r("hh-plugin://oncall/assets/logo.svg")).toMatchObject({ type: "image/svg+xml" });
    expect(await r("hh-plugin://oncall/_hh/host.html")).toEqual({ file: path.join(s.core, "plugin-host.html"), type: "text/html" });
    expect(await r("hh-plugin://oncall/_hh/host.js")).toEqual({ file: path.join(s.core, "plugin-host.mjs"), type: "text/javascript" });
  });

  it.each([
    "hh-plugin://other/backend.js",
    "hh-plugin://oncall/../other/dist/backend.js",
    "hh-plugin://oncall/%2e%2e/%2e%2e/outside.js",
    "hh-plugin://oncall/%2E%2E/%2E%2E/outside.js",
    "hh-plugin://oncall/..%2f..%2foutside.js",
    "hh-plugin://oncall/assets%2f..%2f..%2f..%2foutside.js",
    "hh-plugin://oncall/assets%5c..%5c..%5coutside.js",
    "hh-plugin://oncall/assets\\..\\..\\outside.js",
    "hh-plugin://oncall//etc/hosts",
    "hh-plugin://oncall/%2fetc%2fhosts",
    "hh-plugin://oncall/backend.js%00.svg",
    "hh-plugin://oncall/backend.js%00",
    "hh-plugin://oncall/%E0%A4%A",
    "hh-plugin://oncall/./backend.js",
    "hh-plugin://oncall/.env",
    "hh-plugin://oncall/notes.md",
    "hh-plugin://oncall/link.js",
    "hh-plugin://oncall/inner-link.js",
    "hh-plugin://oncall/up/outside.js",
    "hh-plugin://oncall/up/oncall/dist/backend.js",
    "hh-plugin://oncall/hard.js",
    "hh-plugin://oncall/_hh/../backend.js",
    "hh-plugin://oncall/_hh/other.js",
    "hh-plugin://oncall/_hh/host.js/x.js",
    "hh-plugin://oncall/_hh/__proto__",
    "hh-plugin://oncall/_hh/constructor",
    "hh-plugin://oncall/missing.js",
    "hh-plugin://oncall/assets",
    "hh-plugin://oncall/",
    "hh-plugin://oncall",
    "hh-plugin://oncall:80/backend.js",
    "hh-plugin://ONCALL/backend.js",
    "file:///etc/hosts",
    "hh-plugin://x@oncall/backend.js",
    "hh-plugin://x:y@oncall/backend.js",
    "http://oncall/backend.js",
    "not a url",
  ])("refuses %s", async (url) => {
    const s = await setup();
    expect(await resolvePluginFile(url, { id: "oncall", dist: s.dist, core: s.core })).toBeNull();
  });

  it("refuses an id that isn't a plugin id", async () => {
    const s = await setup();
    expect(await resolvePluginFile("hh-plugin://oncall/backend.js", { id: "../oncall", dist: s.dist, core: s.core })).toBeNull();
  });

  it("checks every request again: a file swapped for a link after load is refused", async () => {
    const s = await setup();
    const o = { id: "oncall", dist: s.dist, core: s.core };
    expect(await resolvePluginFile("hh-plugin://oncall/backend.js", o)).not.toBeNull();
    await fs.rm(path.join(s.dist, "backend.js"));
    await fs.symlink(path.join(s.root, "outside.js"), path.join(s.dist, "backend.js"));
    expect(await resolvePluginFile("hh-plugin://oncall/backend.js", o)).toBeNull();
    expect(await readPluginFile("hh-plugin://oncall/backend.js", o)).toBeNull();
  });

  it("a folder inside dist swapped for a link is refused", async () => {
    const s = await setup();
    const o = { id: "oncall", dist: s.dist, core: s.core };
    await fs.rm(path.join(s.dist, "assets"), { recursive: true });
    await fs.mkdir(path.join(s.root, "elsewhere"));
    await fs.writeFile(path.join(s.root, "elsewhere", "logo.svg"), "<svg/>");
    await fs.symlink(path.join(s.root, "elsewhere"), path.join(s.dist, "assets"));
    expect(await resolvePluginFile("hh-plugin://oncall/assets/logo.svg", o)).toBeNull();
  });

  it("the CSP allows no network, no frames, no workers", () => {
    expect(PLUGIN_CSP).toBe("default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  });
});

describe("readPluginFile (B3)", () => {
  it("reads the plugin's own file and the core's", async () => {
    const s = await setup();
    const o = { id: "oncall", dist: s.dist, core: s.core };
    const hit = await readPluginFile("hh-plugin://oncall/backend.js", o);
    expect(hit?.type).toBe("text/javascript");
    expect(hit?.body.toString()).toBe("x");
    expect((await readPluginFile("hh-plugin://oncall/_hh/host.js", o))?.body.toString()).toBe("x");
  });

  it("never serves the plugin's own dist/_hh files", async () => {
    const s = await setup();
    const hit = await readPluginFile("hh-plugin://oncall/_hh/host.js", { id: "oncall", dist: s.dist, core: s.core });
    expect(hit?.body.toString()).not.toBe("plugin's own");
  });

  it("refuses links, hard links, other plugins and files over the cap", async () => {
    const s = await setup();
    const o = { id: "oncall", dist: s.dist, core: s.core };
    for (const url of ["hh-plugin://oncall/link.js", "hh-plugin://oncall/hard.js", "hh-plugin://other/backend.js", "hh-plugin://oncall/..%2f..%2fother%2fdist%2fbackend.js"]) {
      expect(await readPluginFile(url, o)).toBeNull();
    }
    await fs.writeFile(path.join(s.dist, "big.js"), Buffer.alloc(PLUGIN_FILE_MAX_BYTES + 1));
    expect(await readPluginFile("hh-plugin://oncall/big.js", o)).toBeNull();
  });
});

describe("allowPluginRequest (B2, spike S4: the session cancels every non-hh-plugin: request)", () => {
  it.each([
    ["hh-plugin://oncall/backend.js", true],
    ["hh-plugin://oncall/_hh/host.html", true],
    ["hh-plugin://other/backend.js", false],
    ["hh-plugin://oncall:8080/backend.js", false],
    ["hh-plugin://x@oncall/backend.js", false],
    ["https://evil.com/", false],
    ["http://127.0.0.1:1234/", false],
    ["ws://127.0.0.1:1234/", false],
    ["wss://evil.com/", false],
    ["file:///etc/hosts", false],
    ["data:text/html,x", false],
    ["blob:hh-plugin://oncall/123", false],
    ["devtools://devtools/x", false],
    ["chrome-extension://abc/x", false],
    ["chrome-error://chromewebdata/", false],
    ["about:blank", false],
    ["", false],
  ])("%s → %s", (url, ok) => {
    expect(allowPluginRequest(url, "oncall")).toBe(ok);
  });
});

describe("isPluginFrame and pluginOfSender (the plugin channel's sender check, B5)", () => {
  it("only the plugin's own main frame at its host page", () => {
    expect(pluginHostUrl("oncall")).toBe("hh-plugin://oncall/_hh/host.html");
    expect(isPluginFrame({ url: "hh-plugin://oncall/_hh/host.html", isMain: true }, "oncall")).toBe(true);
    expect(isPluginFrame({ url: "hh-plugin://other/_hh/host.html", isMain: true }, "oncall")).toBe(false);
    expect(isPluginFrame({ url: "hh-plugin://oncall/_hh/host.html", isMain: false }, "oncall")).toBe(false);
    expect(isPluginFrame({ url: "hh-plugin://oncall/backend.js", isMain: true }, "oncall")).toBe(false);
    expect(isPluginFrame({ url: "hh-plugin://x@oncall/_hh/host.html", isMain: true }, "oncall")).toBe(false);
    expect(isPluginFrame({ url: "file:///app/index.html", isMain: true }, "oncall")).toBe(false);
  });

  const windows = new Map([
    [1, "oncall"],
    [2, "other"],
  ]);
  const host = { url: "hh-plugin://oncall/_hh/host.html", isMain: true };

  it("takes the plugin from the registered window, never from anything the page says", () => {
    expect(pluginOfSender({ webContentsId: 1, frame: host }, windows)).toBe("oncall");
    expect(pluginOfSender({ webContentsId: 2, frame: { url: "hh-plugin://other/_hh/host.html", isMain: true } }, windows)).toBe("other");
    // Window 2 showing oncall's page is still not oncall.
    expect(pluginOfSender({ webContentsId: 2, frame: host }, windows)).toBeNull();
  });

  it("refuses an unknown sender (the app's page, any other window)", () => {
    expect(pluginOfSender({ webContentsId: 3, frame: host }, windows)).toBeNull();
    expect(pluginOfSender({ webContentsId: 3, frame: { url: "file:///app/out/renderer/index.html", isMain: true } }, windows)).toBeNull();
  });

  it("refuses a known sender id calling from an error page after a blocked navigation (spike S9)", () => {
    for (const url of ["http://127.0.0.1:4321/nav", "chrome-error://chromewebdata/", "about:blank", "data:text/html,x"]) {
      expect(pluginOfSender({ webContentsId: 1, frame: { url, isMain: true } }, windows)).toBeNull();
    }
  });

  it("refuses a subframe or a missing frame of a known sender", () => {
    expect(pluginOfSender({ webContentsId: 1, frame: { ...host, isMain: false } }, windows)).toBeNull();
    expect(pluginOfSender({ webContentsId: 1, frame: null }, windows)).toBeNull();
    expect(pluginOfSender({ webContentsId: 1, frame: undefined }, windows)).toBeNull();
  });
});

describe("parsePluginRpc (every rpc argument checked before anything sees it)", () => {
  const rpc = (method: unknown, args: unknown) => parsePluginRpc(method, JSON.stringify(args ?? null));

  it("accepts the host script's calls, each payload one JSON string", () => {
    expect(parsePluginRpc("next", "null")).toEqual({ method: "next" });
    expect(rpc("ready", { sources: ["queues"] })).toEqual({ method: "ready", sources: ["queues"] });
    expect(rpc("ready", { error: "SyntaxError: x" })).toEqual({ method: "ready", error: "SyntaxError: x" });
    expect(rpc("done", { runId: "r1", ok: true })).toEqual({ method: "done", runId: "r1", ok: true });
    expect(rpc("done", { runId: "r1", ok: false, error: "x".repeat(900) })).toEqual({ method: "done", runId: "r1", ok: false, error: "x".repeat(500) });
    expect(rpc("ctx", { runId: "r1", name: "settings.get", args: [] })).toEqual({ method: "ctx", runId: "r1", name: "settings.get", args: [] });
  });

  it("refuses a payload that isn't a string: structured clone keeps shared references (one big string many times)", () => {
    const big = "x".repeat(1024);
    const shared = { runId: "r1", name: "log", args: Array.from({ length: 8 }, () => big) };
    expect(parsePluginRpc("ctx", shared)).toBeNull();
    expect(parsePluginRpc("next", undefined)).toBeNull();
    expect(parsePluginRpc("next", null)).toBeNull();
    expect(parsePluginRpc("ready", { sources: ["queues"] })).toBeNull();
    expect(parsePluginRpc("ctx", Buffer.from(JSON.stringify({ runId: "r1", name: "log", args: [] })))).toBeNull();
  });

  it("refuses a payload over RPC_MAX_BYTES (counted in UTF-8 bytes) and one that isn't JSON", () => {
    const at = (n: number) => JSON.stringify({ runId: "r1", name: "log", args: ["info", "x".repeat(n)] });
    const overhead = at(0).length;
    expect(parsePluginRpc("ctx", at(RPC_MAX_BYTES - overhead))).not.toBeNull();
    expect(parsePluginRpc("ctx", at(RPC_MAX_BYTES - overhead + 1))).toBeNull();
    // Under the cap in UTF-16 units, over it in bytes.
    expect(parsePluginRpc("ctx", at(0).replace('""', `"${"é".repeat(RPC_MAX_BYTES / 2)}"`))).toBeNull();
    expect(parsePluginRpc("ctx", "{not json")).toBeNull();
    expect(parsePluginRpc("next", "")).toBeNull();
  });

  it.each([
    ["tasks", {}],
    ["__proto__", {}],
    [5, {}],
    [undefined, undefined],
    ["next", { sneaky: 1 }],
    ["ready", null],
    ["ready", { sources: "queues" }],
    ["ready", { sources: [1] }],
    ["ready", { sources: [""] }],
    ["ready", { sources: ["x".repeat(65)] }],
    ["ready", { sources: Array.from({ length: 101 }, (_, i) => `s${i}`) }],
    ["ready", { sources: [], extra: 1 }],
    ["ready", { error: 5 }],
    ["done", { runId: 5, ok: true }],
    ["done", { runId: "r1" }],
    ["done", { runId: "r1", ok: "yes" }],
    ["done", { runId: "r1", ok: false, error: {} }],
    ["done", { runId: "x".repeat(65), ok: true }],
    ["done", { runId: "r1", ok: true, plugin: "other" }],
    ["done", [["runId", "r1"]]],
    ["ctx", { runId: "r1", name: "settings.get" }],
    ["ctx", { runId: "r1", name: "settings.get", args: "x" }],
    ["ctx", { runId: "r1", name: "settings.get", args: Array.from({ length: 9 }, () => 0) }],
    ["ctx", { runId: "r1", name: 7, args: [] }],
    ["ctx", { runId: "r1", name: "x".repeat(41), args: [] }],
    ["ctx", { runId: "r1", name: "fetch", args: [], plugin: "other" }],
  ])("refuses %s %j", (method, args) => {
    expect(rpc(method, args)).toBeNull();
  });

  it("refuses a smuggled __proto__ key in the envelope", () => {
    expect(parsePluginRpc("ctx", '{"runId":"r1","name":"log","args":[],"__proto__":{"x":1}}')).toBeNull();
  });
});
