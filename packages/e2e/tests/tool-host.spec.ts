import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";
import { electronBinary, shellDir } from "./helpers";

// The tool host's sandbox for real (tools spec §4.1, D2; threat row T1): a bare Electron main runs the real ToolHost
// (bundled here from its source) on a hand-written hostile tool, which tries every way out of the window — Node, a
// dynamic import with a computed specifier (it survives `humanharness build`'s bundle), the network, frames, workers,
// popups, navigation, the broker with a forged call id. The window and its CSP are the guard: nothing gets out.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const fixture = path.resolve(here, "../fixtures/tool-host");

/** tool-host.ts and its scheme as one CommonJS file, with the esbuild tsx carries (as `humanharness build`; no install). */
async function bundleHost(outfile: string): Promise<void> {
  const tsx = createRequire(path.join(repo, "package.json")).resolve("tsx/package.json");
  const esbuild = createRequire(tsx)("esbuild") as { build(o: Record<string, unknown>): Promise<unknown> };
  const tools = path.join(shellDir, "src/main/tools");
  await esbuild.build({
    stdin: { contents: 'export { ToolHost } from "./tool-host";\nexport { TOOL_SCHEME } from "./tool-protocol";\n', resolveDir: tools, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile,
    logLevel: "silent",
  });
}

/** A local server on 127.0.0.1 that counts every request and upgrade: it must stay at 0. */
async function countingServer(): Promise<{ port: number; hits: string[]; close(): Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "?");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", "text/javascript");
    res.end("export default 1;");
  });
  server.on("upgrade", (req, socket) => {
    hits.push(`upgrade ${req.url ?? "?"}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Answer = { ok: true; value: Record<string, string>; summary?: string } | { ok: false; error: string };

const call = (app: ElectronApplication, c: { callId: string; tool: string; args: unknown }) =>
  app.evaluate(async (_electron, c) => {
    // The probe app sets it once Electron is ready.
    const g = globalThis as unknown as { probe?: { call(c: unknown, ms: number): Promise<unknown> } };
    for (let i = 0; !g.probe && i < 100; i++) await new Promise((r) => setTimeout(r, 50));
    return g.probe!.call({ ...c, scope: "intro" }, 60_000);
  }, c) as Promise<Answer>;

test("T1: a tool in the host window reaches no Node, no network, no other file, no frame, no popup and no other call", async () => {
  const root = path.resolve(here, "..", ".tmp", `tool-host-${Date.now()}`);
  fs.mkdirSync(path.join(root, "userData"), { recursive: true });
  const host = path.join(root, "tool-host.cjs");
  await bundleHost(host);
  const server = await countingServer();
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [path.join(fixture, "main.cjs")],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      HH_PROBE_HOST: host,
      HH_PROBE_RESOURCES: path.join(shellDir, "resources"),
      HH_PROBE_USER_DATA: path.join(root, "userData"),
    },
  });
  try {
    const fileUrl = pathToFileURL(path.join(fixture, "built", "tools", "own.js")).href;
    const answer = await call(app, { callId: "c1", tool: "probe", args: { port: server.port, fileUrl } });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    const results = (answer as { value: Record<string, string> }).value;
    const blocked = [
      "require",
      "require-call",
      "process",
      "module",
      "Buffer",
      "electron",
      "import-remote",
      "import-file",
      "import-data",
      "import-blob",
      "import-other-harness",
      "import-outside-tools",
      "import-traversal",
      "import-plugin",
      "eval",
      "function",
      "fetch",
      "fetch-file",
      "fetch-self",
      "xhr",
      "websocket",
      "eventsource",
      "img",
      "script",
      "worker",
      "window.open",
      "ctx.files",
    ];
    expect(results).toEqual({
      ...Object.fromEntries(blocked.map((name) => [name, "blocked"])),
      // A tool of the same harness shares the window (one host per harness): its own bundles load.
      "import-own": "reached",
      // sendBeacon only says whether it queued the beacon; the server's count below proves it never left.
      beacon: expect.stringMatching(/^(blocked|queued)$/),
      // A frame fires "load" on its error page too: its URL, read from main below, is what proves it went nowhere.
      iframe: expect.stringMatching(/^(blocked|loaded)$/),
      "forged-call": "blocked: Unknown tool call",
      hh: "rpc",
      scope: "intro",
    });
    // The refused ctx call reached the broker as the probe, under the call id main made.
    const ctx = await app.evaluate(() => (globalThis as unknown as { probe: { ctxCalls: unknown[] } }).probe.ctxCalls);
    expect(ctx).toEqual([{ tool: "probe", callId: "c1", name: "files.read", args: ["notes.md"] }]);

    // Leaving the page: the window stays on its host page.
    const nav = await call(app, { callId: "c2", tool: "probe", args: { port: server.port, navigate: true } });
    expect(nav).toEqual({ ok: true, value: { navigate: "blocked", href: "hh-tools://probe/_hh/host.html?tools=probe,own" } });
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible() })));
    expect(windows).toEqual([{ url: "hh-tools://probe/_hh/host.html?tools=probe,own", visible: false }]);
    // No frame of the window loaded anything but the host page: the probe's iframe shows only an error page.
    const frames = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.mainFrame.framesInSubtree.map((f) => ({ url: f.url, origin: f.origin })));
    expect(frames[0]).toEqual({ url: "hh-tools://probe/_hh/host.html?tools=probe,own", origin: "hh-tools://probe" });
    // A frame whose request was cancelled keeps the URL it asked for but shows an error page, of an opaque origin.
    expect(frames.slice(1).map((f) => f.origin)).toEqual(frames.slice(1).map(() => "null"));
    expect(server.hits).toEqual([]);
    // The control tool answers: the host still serves calls.
    expect(await call(app, { callId: "c3", tool: "own", args: {} })).toEqual({ ok: true, value: "own" });
    expect(server.hits).toEqual([]);
  } finally {
    await app.close();
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
