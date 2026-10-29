import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_CSP } from "../../src/main/plugin-protocol";
import {
  TOOL_CSP,
  TOOL_FILE_MAX_BYTES,
  TOOL_RPC_MAX_BYTES,
  TOOL_RPC_MAX_DEPTH,
  TOOL_SCHEME,
  allowToolRequest,
  isToolFrame,
  parseToolRpc,
  readToolFile,
  resolveToolFile,
  toolHostUrl,
  toolOfSender,
} from "../../src/main/tools/tool-protocol";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-proto-"));
  const dist = path.join(root, "demo", "dist");
  await fs.mkdir(path.join(dist, "tools", "nested"), { recursive: true });
  await fs.mkdir(path.join(dist, "_hh"), { recursive: true });
  await fs.writeFile(path.join(dist, "tools", "pr-ci.js"), "pr");
  await fs.writeFile(path.join(dist, "tools", "count_notes.js"), "count");
  await fs.writeFile(path.join(dist, "tools", "notes.txt"), "x");
  await fs.writeFile(path.join(dist, "tools", "Upper.js"), "x");
  await fs.writeFile(path.join(dist, "tools", ".hidden.js"), "x");
  await fs.writeFile(path.join(dist, "tools", "nested", "deep.js"), "x");
  await fs.writeFile(path.join(dist, "tools.json"), "{}");
  await fs.writeFile(path.join(dist, "backend.js"), "x");
  await fs.writeFile(path.join(dist, "_hh", "host.js"), "harness's own");
  await fs.writeFile(path.join(root, "outside.js"), "x");
  await fs.symlink(path.join(root, "outside.js"), path.join(dist, "tools", "link.js"));
  await fs.symlink(path.join(dist, "tools", "pr-ci.js"), path.join(dist, "tools", "inner-link.js"));
  await fs.link(path.join(root, "outside.js"), path.join(dist, "tools", "hard.js"));
  const other = path.join(root, "other", "dist", "tools");
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(path.join(other, "pr-ci.js"), "other");
  const core = path.join(root, "core");
  await fs.mkdir(core);
  await fs.writeFile(path.join(core, "tool-host.html"), "<html>");
  await fs.writeFile(path.join(core, "tool-host.mjs"), "host");
  await fs.writeFile(path.join(core, "plugin-host.mjs"), "plugin host");
  return { root, dist: await fs.realpath(dist), core: await fs.realpath(core) };
}

describe("resolveToolFile (tools spec §4.1; T1)", () => {
  it("serves only hh-tools://<harness-id>/tools/<id>.js and the core's _hh/ files", async () => {
    const s = await setup();
    const r = (url: string) => resolveToolFile(url, { id: "demo", dist: s.dist, core: s.core });
    expect(await r("hh-tools://demo/tools/pr-ci.js")).toEqual({ file: path.join(s.dist, "tools", "pr-ci.js"), type: "text/javascript" });
    expect(await r("hh-tools://demo/tools/count_notes.js")).toEqual({ file: path.join(s.dist, "tools", "count_notes.js"), type: "text/javascript" });
    expect(await r("hh-tools://demo/tools/pr-ci.js?v=1")).toMatchObject({ file: path.join(s.dist, "tools", "pr-ci.js") });
    expect(await r("hh-tools://demo/_hh/host.html")).toEqual({ file: path.join(s.core, "tool-host.html"), type: "text/html" });
    expect(await r("hh-tools://demo/_hh/host.html?tools=pr-ci,count_notes")).toEqual({ file: path.join(s.core, "tool-host.html"), type: "text/html" });
    expect(await r("hh-tools://demo/_hh/host.js")).toEqual({ file: path.join(s.core, "tool-host.mjs"), type: "text/javascript" });
  });

  it.each([
    "hh-tools://other/tools/pr-ci.js",
    "hh-tools://demo/../other/dist/tools/pr-ci.js",
    "hh-tools://demo/tools/../tools.json",
    "hh-tools://demo/tools/%2e%2e/tools.json",
    "hh-tools://demo/tools/%2E%2E/%2E%2E/outside.js",
    "hh-tools://demo/tools/..%2f..%2f..%2foutside.js",
    "hh-tools://demo/tools%2fpr-ci.js",
    "hh-tools://demo/tools%5cpr-ci.js",
    "hh-tools://demo/tools\\pr-ci.js",
    "hh-tools://demo//tools/pr-ci.js",
    "hh-tools://demo/tools/pr-ci.js%00.js",
    "hh-tools://demo/tools/%E0%A4%A",
    "hh-tools://demo/./tools/pr-ci.js",
    "hh-tools://demo/tools/./pr-ci.js",
    "hh-tools://demo/tools/.hidden.js",
    "hh-tools://demo/tools/notes.txt",
    "hh-tools://demo/tools/Upper.js",
    "hh-tools://demo/tools/nested/deep.js",
    "hh-tools://demo/tools/link.js",
    "hh-tools://demo/tools/inner-link.js",
    "hh-tools://demo/tools/hard.js",
    "hh-tools://demo/tools/missing.js",
    "hh-tools://demo/tools.json",
    "hh-tools://demo/backend.js",
    "hh-tools://demo/tools",
    "hh-tools://demo/tools/",
    "hh-tools://demo/",
    "hh-tools://demo",
    "hh-tools://demo/_hh/../tools/pr-ci.js",
    "hh-tools://demo/_hh/other.js",
    "hh-tools://demo/_hh/host.js/x.js",
    "hh-tools://demo/_hh/__proto__",
    "hh-tools://demo/_hh/constructor",
    "hh-tools://demo:80/tools/pr-ci.js",
    "hh-tools://DEMO/tools/pr-ci.js",
    "hh-tools://x@demo/tools/pr-ci.js",
    "hh-tools://x:y@demo/tools/pr-ci.js",
    "hh-plugin://demo/tools/pr-ci.js",
    "file:///etc/hosts",
    "http://demo/tools/pr-ci.js",
    "not a url",
  ])("refuses %s", async (url) => {
    const s = await setup();
    expect(await resolveToolFile(url, { id: "demo", dist: s.dist, core: s.core })).toBeNull();
  });

  it("refuses an id that isn't a harness id", async () => {
    const s = await setup();
    for (const id of ["../demo", "Demo", "", "x".repeat(64)]) {
      expect(await resolveToolFile("hh-tools://demo/tools/pr-ci.js", { id, dist: s.dist, core: s.core }), id).toBeNull();
    }
  });

  it("checks every request again: a file swapped for a link is refused, so is a tools/ folder swapped for a link", async () => {
    const s = await setup();
    const o = { id: "demo", dist: s.dist, core: s.core };
    expect(await resolveToolFile("hh-tools://demo/tools/pr-ci.js", o)).not.toBeNull();
    await fs.rm(path.join(s.dist, "tools", "pr-ci.js"));
    await fs.symlink(path.join(s.root, "outside.js"), path.join(s.dist, "tools", "pr-ci.js"));
    expect(await resolveToolFile("hh-tools://demo/tools/pr-ci.js", o)).toBeNull();
    expect(await readToolFile("hh-tools://demo/tools/pr-ci.js", o)).toBeNull();
    await fs.rename(path.join(s.dist, "tools"), path.join(s.root, "elsewhere"));
    await fs.symlink(path.join(s.root, "elsewhere"), path.join(s.dist, "tools"));
    expect(await resolveToolFile("hh-tools://demo/tools/count_notes.js", o)).toBeNull();
  });
});

describe("readToolFile", () => {
  it("reads a built tool and the core's host files, never the harness's own dist/_hh", async () => {
    const s = await setup();
    const o = { id: "demo", dist: s.dist, core: s.core };
    const hit = await readToolFile("hh-tools://demo/tools/pr-ci.js", o);
    expect(hit?.type).toBe("text/javascript");
    expect(hit?.body.toString()).toBe("pr");
    expect((await readToolFile("hh-tools://demo/_hh/host.js", o))?.body.toString()).toBe("host");
  });

  it("refuses links, hard links, another harness and a file over the cap", async () => {
    const s = await setup();
    const o = { id: "demo", dist: s.dist, core: s.core };
    for (const url of ["hh-tools://demo/tools/link.js", "hh-tools://demo/tools/hard.js", "hh-tools://other/tools/pr-ci.js", "hh-tools://demo/tools/..%2f..%2f..%2fother%2fdist%2ftools%2fpr-ci.js"]) {
      expect(await readToolFile(url, o), url).toBeNull();
    }
    await fs.writeFile(path.join(s.dist, "tools", "big.js"), Buffer.alloc(TOOL_FILE_MAX_BYTES + 1));
    expect(await readToolFile("hh-tools://demo/tools/big.js", o)).toBeNull();
  });
});

describe("the scheme and its headers", () => {
  it("is privileged as standard and secure only", () => {
    expect(TOOL_SCHEME).toEqual({ scheme: "hh-tools", privileges: { standard: true, secure: true } });
  });

  it("every response carries the plugins' CSP text: no network, no frames, no workers, no eval", () => {
    expect(TOOL_CSP).toBe(PLUGIN_CSP);
    expect(TOOL_CSP).toBe("default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  });
});

describe("allowToolRequest (T1: the session cancels everything but its own hh-tools: files)", () => {
  it.each([
    ["hh-tools://demo/tools/pr-ci.js", true],
    ["hh-tools://demo/_hh/host.html?tools=pr-ci", true],
    ["hh-tools://other/tools/pr-ci.js", false],
    ["hh-tools://demo:8080/tools/pr-ci.js", false],
    ["hh-tools://x@demo/tools/pr-ci.js", false],
    ["hh-plugin://demo/backend.js", false],
    ["https://evil.com/", false],
    ["http://127.0.0.1:1234/", false],
    ["ws://127.0.0.1:1234/", false],
    ["file:///etc/hosts", false],
    ["data:text/javascript,1", false],
    ["blob:hh-tools://demo/123", false],
    ["devtools://devtools/x", false],
    ["chrome-error://chromewebdata/", false],
    ["about:blank", false],
    ["", false],
  ])("%s → %s", (url, ok) => {
    expect(allowToolRequest(url, "demo")).toBe(ok);
  });
});

describe("isToolFrame and toolOfSender (T2: the host is the sender, never the call)", () => {
  const tools = ["count_notes", "pr-ci"];
  const page = toolHostUrl("demo", tools);

  it("the host page names the built tools in its query", () => {
    expect(page).toBe("hh-tools://demo/_hh/host.html?tools=count_notes,pr-ci");
    expect(toolHostUrl("demo", [])).toBe("hh-tools://demo/_hh/host.html?tools=");
  });

  it("only the window's main frame at exactly its host page", () => {
    expect(isToolFrame({ url: page, isMain: true }, "demo", tools)).toBe(true);
    expect(isToolFrame({ url: page, isMain: false }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: toolHostUrl("other", tools), isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: toolHostUrl("demo", ["pr-ci"]), isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: "hh-tools://demo/_hh/host.html", isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: `${page}#x`, isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: "hh-tools://demo/tools/pr-ci.js", isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: "hh-tools://x@demo/_hh/host.html?tools=count_notes,pr-ci", isMain: true }, "demo", tools)).toBe(false);
    expect(isToolFrame({ url: "file:///app/index.html", isMain: true }, "demo", tools)).toBe(false);
  });

  const windows = new Map([[1, { harness: "demo", tools }]]);
  const host = { url: page, isMain: true };

  it("a frame at another URL or another window is not the host", () => {
    expect(toolOfSender({ webContentsId: 1, frame: host }, windows)).toBe("demo");
    // The app's page, any other window, even showing the host page:
    expect(toolOfSender({ webContentsId: 2, frame: host }, windows)).toBeNull();
    // The registered window after a blocked navigation (an error page runs the preload again, spike S9):
    for (const url of ["http://127.0.0.1:4321/nav", "chrome-error://chromewebdata/", "about:blank", "data:text/html,x", "hh-tools://demo/tools/pr-ci.js"]) {
      expect(toolOfSender({ webContentsId: 1, frame: { url, isMain: true } }, windows), url).toBeNull();
    }
    expect(toolOfSender({ webContentsId: 1, frame: { ...host, isMain: false } }, windows)).toBeNull();
    expect(toolOfSender({ webContentsId: 1, frame: null }, windows)).toBeNull();
    expect(toolOfSender({ webContentsId: 1, frame: undefined }, windows)).toBeNull();
  });
});

describe("parseToolRpc (every rpc argument checked before anything sees it; T6)", () => {
  const rpc = (method: unknown, args: unknown) => parseToolRpc(method, JSON.stringify(args ?? null));

  it("accepts the host script's calls", () => {
    expect(parseToolRpc("next", "null")).toEqual({ method: "next" });
    expect(rpc("ready", { tools: ["pr-ci"], errors: [{ tool: "count_notes", error: "SyntaxError: x" }] })).toEqual({
      method: "ready",
      tools: ["pr-ci"],
      errors: [{ tool: "count_notes", error: "SyntaxError: x" }],
    });
    expect(rpc("ready", { tools: [], errors: [] })).toEqual({ method: "ready", tools: [], errors: [] });
    expect(rpc("done", { callId: "c1", ok: true, value: { items: [1, 2] }, summary: "2 items" })).toEqual({
      method: "done",
      callId: "c1",
      ok: true,
      value: { items: [1, 2] },
      summary: "2 items",
    });
    expect(rpc("done", { callId: "c1", ok: true, value: null })).toEqual({ method: "done", callId: "c1", ok: true, value: null });
    // A tool that returns nothing: JSON drops the key.
    expect(rpc("done", { callId: "c1", ok: true })).toEqual({ method: "done", callId: "c1", ok: true, value: null });
    expect(rpc("done", { callId: "c1", ok: false, error: "x".repeat(20_000) })).toEqual({ method: "done", callId: "c1", ok: false, error: "x".repeat(16_000) });
    expect(rpc("done", { callId: "c1", ok: true, value: 1, summary: "s".repeat(500) })).toEqual({ method: "done", callId: "c1", ok: true, value: 1, summary: "s".repeat(200) });
    expect(rpc("ctx", { callId: "c1", name: "files.read", args: ["notes.md"] })).toEqual({ method: "ctx", callId: "c1", name: "files.read", args: ["notes.md"] });
    expect(rpc("ready", { tools: [], errors: [{ tool: "pr-ci", error: "y".repeat(20_000) }] })).toEqual({
      method: "ready",
      tools: [],
      errors: [{ tool: "pr-ci", error: "y".repeat(16_000) }],
    });
  });

  it("a payload over TOOL_RPC_MAX_BYTES (in UTF-8 bytes) is refused unread", () => {
    expect(TOOL_RPC_MAX_BYTES).toBe(12 * 1024 * 1024);
    const at = (n: number) => JSON.stringify({ callId: "c1", ok: true, value: "x".repeat(n) });
    const overhead = at(0).length;
    expect(parseToolRpc("done", at(TOOL_RPC_MAX_BYTES - overhead))).not.toBeNull();
    expect(parseToolRpc("done", at(TOOL_RPC_MAX_BYTES - overhead + 1))).toBeNull();
    expect(parseToolRpc("done", at(0).replace('""', `"${"é".repeat(TOOL_RPC_MAX_BYTES / 2)}"`))).toBeNull();
  });

  it("a payload deeper than 40 is refused unread, fast; brackets inside strings don't count", () => {
    expect(TOOL_RPC_MAX_DEPTH).toBe(40);
    const nest = (n: number) => `${"[".repeat(n)}${"]".repeat(n)}`;
    const done = (inner: string) => `{"callId":"c1","ok":true,"value":${inner}}`;
    expect(parseToolRpc("done", done(nest(TOOL_RPC_MAX_DEPTH)))).toBeNull();
    expect(parseToolRpc("done", done(nest(TOOL_RPC_MAX_DEPTH - 1)))).not.toBeNull();
    expect(parseToolRpc("done", done(JSON.stringify(["[".repeat(100)])))).not.toBeNull();
    const deep = "[".repeat(5_000_000) + "]".repeat(5_000_000);
    const t0 = Date.now();
    expect(parseToolRpc("done", deep)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("refuses a payload that isn't a JSON string", () => {
    expect(parseToolRpc("next", null)).toBeNull();
    expect(parseToolRpc("next", undefined)).toBeNull();
    expect(parseToolRpc("ctx", { callId: "c1", name: "log", args: [] })).toBeNull();
    expect(parseToolRpc("ctx", "{not json")).toBeNull();
    expect(parseToolRpc("next", "")).toBeNull();
  });

  it.each([
    ["tasks", {}],
    ["__proto__", {}],
    [5, {}],
    [undefined, undefined],
    ["next", { sneaky: 1 }],
    ["ready", null],
    ["ready", { tools: ["pr-ci"] }],
    ["ready", { tools: "pr-ci", errors: [] }],
    ["ready", { tools: ["Not An Id"], errors: [] }],
    ["ready", { tools: [1], errors: [] }],
    ["ready", { tools: Array.from({ length: 51 }, (_, i) => `t${i}`), errors: [] }],
    ["ready", { tools: [], errors: [{ tool: "pr-ci" }] }],
    ["ready", { tools: [], errors: [{ tool: "../x", error: "e" }] }],
    ["ready", { tools: [], errors: [{ tool: "pr-ci", error: "e", more: 1 }] }],
    ["ready", { tools: [], errors: Array.from({ length: 51 }, (_, i) => ({ tool: `t${i}`, error: "e" })) }],
    ["ready", { tools: [], errors: [], extra: 1 }],
    ["done", { callId: 5, ok: true }],
    ["done", { callId: "c1" }],
    ["done", { callId: "", ok: true }],
    ["done", { callId: "x".repeat(65), ok: true }],
    ["done", { callId: "c1", ok: "yes" }],
    ["done", { callId: "c1", ok: false }],
    ["done", { callId: "c1", ok: false, error: {} }],
    ["done", { callId: "c1", ok: false, error: "e", value: 1 }],
    ["done", { callId: "c1", ok: true, error: "e" }],
    ["done", { callId: "c1", ok: true, value: 1, summary: 5 }],
    ["done", { callId: "c1", ok: true, tool: "other" }],
    ["done", [["callId", "c1"]]],
    ["ctx", { callId: "c1", name: "files.read" }],
    ["ctx", { callId: "c1", name: "files.read", args: "x" }],
    ["ctx", { callId: "c1", name: "files.read", args: Array.from({ length: 9 }, () => 0) }],
    ["ctx", { callId: "c1", name: 7, args: [] }],
    ["ctx", { callId: "c1", name: "x".repeat(41), args: [] }],
    ["ctx", { callId: "c1", name: "fetch", args: [], tool: "other" }],
  ])("refuses %s %j", (method, args) => {
    expect(rpc(method, args)).toBeNull();
  });

  it("refuses a smuggled __proto__ key in the envelope", () => {
    expect(parseToolRpc("ctx", '{"callId":"c1","name":"log","args":[],"__proto__":{"x":1}}')).toBeNull();
    expect(parseToolRpc("done", '{"callId":"c1","ok":true,"__proto__":{"x":1}}')).toBeNull();
  });
});
