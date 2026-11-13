import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROL_FILE, type ControlFile, type ControlStatus, startControl } from "../src/main/mods/control";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const STATUS: ControlStatus = {
  mods: [{ id: "hello", name: "Hello", version: "0.1.0", origin: "local", on: true, registers: { hooks: [], ipc: [] }, ui: true }],
  problems: [{ id: "/x/mods/bad", reason: "mod.json: bad" }],
  layout: { name: "main", source: "core", problems: [] },
};

let tmp: string;
let home: string;
let stop: (() => Promise<void>) | undefined;
/** A window that only takes pictures. */
const fakeWindow = (png = PNG) => ({ webContents: { capturePage: async () => ({ toPNG: () => png }) } });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-control-"));
  home = path.join(tmp, "app");
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function start(window: ReturnType<typeof fakeWindow> | null = fakeWindow()) {
  const c = await startControl({ home, window: () => window, status: async () => STATUS });
  stop = c.stop;
  const file = JSON.parse(await fs.readFile(path.join(home, CONTROL_FILE), "utf8")) as ControlFile;
  const call = (method: string, route: string, o: { token?: string | null; body?: unknown } = {}) =>
    fetch(`http://127.0.0.1:${file.port}${route}`, {
      method,
      headers: { ...(o.token !== null ? { authorization: `Bearer ${o.token ?? file.token}` } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
  return { c, file, call };
}

describe("the control channel", () => {
  it("writes .control.json with its port, a token and the pid, mode 0600", async () => {
    const { file } = await start();
    expect(file.pid).toBe(process.pid);
    expect(file.port).toBeGreaterThan(0);
    expect(file.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await fs.stat(path.join(home, CONTROL_FILE))).mode & 0o777).toBe(0o600);
  });

  it("answers GET /status with the token", async () => {
    const { call } = await start();
    const r = await call("GET", "/status");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(STATUS);
  });

  it("answers 401 without the token or with a wrong one, before anything else", async () => {
    const { call } = await start();
    expect((await call("GET", "/status", { token: null })).status).toBe(401);
    expect((await call("GET", "/status", { token: "nope" })).status).toBe(401);
    expect((await call("POST", "/shot", { token: "x".repeat(64) })).status).toBe(401);
    expect((await call("GET", "/elsewhere", { token: null })).status).toBe(401);
  });

  it("answers 404 for any other route or method", async () => {
    const { call } = await start();
    expect((await call("GET", "/elsewhere")).status).toBe(404);
    expect((await call("POST", "/status")).status).toBe(404);
    expect((await call("GET", "/shot")).status).toBe(404);
  });

  it("POST /shot saves the window as a PNG in shots/ by default", async () => {
    const { call } = await start();
    const r = await call("POST", "/shot", { body: {} });
    expect(r.status).toBe(200);
    const { path: saved } = (await r.json()) as { path: string };
    expect(path.dirname(saved)).toBe(path.join(home, "shots"));
    expect(saved).toMatch(/\.png$/);
    expect(await fs.readFile(saved)).toEqual(PNG);
  });

  it("POST /shot saves to an absolute path it is given, and refuses a relative one", async () => {
    const { call } = await start();
    const target = path.join(tmp, "out", "screen.png");
    const r = await call("POST", "/shot", { body: { path: target } });
    expect(await r.json()).toEqual({ path: target });
    expect(await fs.readFile(target)).toEqual(PNG);
    const bad = await call("POST", "/shot", { body: { path: "screen.png" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("absolute");
  });

  it("POST /shot without a window says so", async () => {
    const { call } = await start(null);
    const r = await call("POST", "/shot", { body: {} });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain("window");
  });

  it("stop closes the server and removes the file", async () => {
    const { c, file } = await start();
    await c.stop();
    stop = undefined;
    await expect(fs.access(path.join(home, CONTROL_FILE))).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${file.port}/status`)).rejects.toThrow();
  });
});
