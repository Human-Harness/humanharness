import fs from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main";
import { memoryIo, tempRoot } from "./helpers";

const TOKEN = "a".repeat(64);
const STATUS = {
  mods: [
    { id: "hello", name: "Hello", version: "0.1.0", origin: "local", on: true, registers: { hooks: ["beforeSend"], ipc: [] }, ui: true },
    { id: "home", name: "Home", version: "0.1.0", origin: "core", on: false, registers: { hooks: [], ipc: [] }, ui: true, problem: "main threw" },
  ],
  problems: [{ id: "/app/mods/bad", reason: "mod.json: bad" }],
  layout: { name: "main", source: "core", problems: ["layouts/mine.json: no work child"] },
};

let root: string;
let cleanup: () => void;
let server: Server | undefined;
let seen: { method?: string; url?: string; auth?: string; body: string }[];

beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-app-cmd-"));
  fs.writeFileSync(path.join(root, ".layers.json"), "{}\n");
  seen = [];
});
afterEach(async () => {
  if (server) await new Promise((r) => server?.close(r));
  server = undefined;
  cleanup();
});

/** A fake app: answers like the control channel, with TOKEN. */
async function fakeApp(o: { pid?: number; token?: string } = {}) {
  server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c) => (body += String(c)));
    req.on("end", () => {
      seen[seen.length] = { method: req.method, url: req.url, auth: req.headers.authorization, body };
      const reply = (status: number, v: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "A valid token is needed" });
      if (req.method === "GET" && req.url === "/status") return reply(200, STATUS);
      if (req.method === "POST" && req.url === "/shot") {
        const p = (JSON.parse(body || "{}") as { path?: string }).path ?? path.join(root, "shots", "now.png");
        return reply(200, { path: p });
      }
      return reply(404, { error: "Not found" });
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  fs.writeFileSync(path.join(root, ".control.json"), JSON.stringify({ port, token: o.token ?? TOKEN, pid: o.pid ?? process.pid }), { mode: 0o600 });
  return port;
}

async function run(argv: string[]) {
  const m = memoryIo(root);
  const code = await main(argv, m.io);
  return { code, out: m.out(), err: m.err() };
}

describe("status", () => {
  it("prints the mods, the problems and the layout as a short table, asking with the token", async () => {
    await fakeApp();
    const r = await run(["status"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(seen).toEqual([{ method: "GET", url: "/status", auth: `Bearer ${TOKEN}`, body: "" }]);
    expect(r.out).toMatch(/hello\s+0\.1\.0\s+local\s+on\s+beforeSend/);
    expect(r.out).toMatch(/home\s+0\.1\.0\s+core\s+off\s+.*main threw/);
    expect(r.out).toContain("/app/mods/bad: mod.json: bad");
    expect(r.out).toContain("Layout: main (core)");
    expect(r.out).toContain("layouts/mine.json: no work child");
  });

  it("says the app isn't running without .control.json, with a dead pid or a closed port", async () => {
    const none = await run(["status"]);
    expect(none.code).toBe(1);
    expect(none.err).toContain("The app isn't running");
    await fakeApp({ pid: 2 ** 22 + 12345 });
    expect((await run(["status"])).err).toContain("The app isn't running");
    await new Promise((r) => server?.close(r));
    server = undefined;
    const data = JSON.parse(fs.readFileSync(path.join(root, ".control.json"), "utf8")) as Record<string, unknown>;
    fs.writeFileSync(path.join(root, ".control.json"), JSON.stringify({ ...data, pid: process.pid }));
    const closed = await run(["status"]);
    expect(closed.code).toBe(1);
    expect(closed.err).toContain("The app isn't running");
  });

  it("says so when the app refuses the token", async () => {
    await fakeApp({ token: "b".repeat(64) });
    const r = await run(["status"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused");
  });

  it("refuses arguments and works outside a home only with --home", async () => {
    expect((await run(["status", "x"])).code).toBe(2);
    await fakeApp();
    const m = memoryIo(path.dirname(root));
    expect(await main(["status", "--home", root], m.io)).toBe(0);
  });
});

describe("shot", () => {
  it("asks for the default file and prints its path", async () => {
    await fakeApp();
    const r = await run(["shot"]);
    expect(r.code).toBe(0);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/shot", auth: `Bearer ${TOKEN}` });
    expect(JSON.parse(seen[0].body)).toEqual({});
    expect(r.out.trim()).toBe(path.join(root, "shots", "now.png"));
  });

  it("sends a file it is given as an absolute path", async () => {
    await fakeApp();
    const r = await run(["shot", "out/screen.png"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(seen[0].body)).toEqual({ path: path.join(root, "out", "screen.png") });
    expect(r.out.trim()).toBe(path.join(root, "out", "screen.png"));
  });

  it("refuses a file that isn't a .png, extra arguments, and an app that isn't running", async () => {
    expect((await run(["shot", "a.jpg"])).code).toBe(2);
    expect((await run(["shot", "a.png", "b.png"])).code).toBe(2);
    const r = await run(["shot"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("The app isn't running");
  });
});
