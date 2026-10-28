import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type DevSpawn, devCommand } from "../src/dev";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { shellDir } from "../src/paths";
import { CORE, memoryIo, memoryStream, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-dev-");
afterAll(cleanup);
let n = 0;
async function harness(edit: (dir: string) => void = () => {}) {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  edit(dir);
  return dir;
}

/** A spawn that records its call and exits with `code`. */
function fakeSpawn(code = 0) {
  const calls: { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
  const spawn: DevSpawn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd as string, env: options.env });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", code));
    return child;
  };
  return { spawn, calls };
}

describe("devCommand", () => {
  it("checks the harness, then runs the shell's electron-vite dev with HH_HARNESS_DIR", async () => {
    const dir = await harness();
    const f = fakeSpawn();
    const out = memoryStream();
    expect(await devCommand({ harnessDir: dir, engine: "codex", out: out.stream, spawn: f.spawn })).toBe(0);
    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call.command).toBe(path.join(shellDir(), "node_modules", ".bin", "electron-vite"));
    expect(call.args).toEqual(["dev"]);
    expect(call.cwd).toBe(shellDir());
    expect(call.env).toMatchObject({ HH_HARNESS_DIR: dir, HH_DEV_ENGINE: "codex" });
    expect(call.env?.HH_OUT_DIR).toBeUndefined();
  });

  it("--build builds into a folder instead of opening the app", async () => {
    const f = fakeSpawn();
    expect(await devCommand({ harnessDir: await harness(), build: path.join(root, "out"), out: memoryStream().stream, spawn: f.spawn })).toBe(0);
    expect(f.calls[0].args).toEqual(["build"]);
    expect(f.calls[0].env).toMatchObject({ HH_OUT_DIR: path.join(root, "out") });
  });

  it("stops on check errors and opens nothing", async () => {
    const dir = await harness((d) => replaceIn(d, "HARNESS.md", "- engines: claude, codex", "- engines: claude"));
    const f = fakeSpawn();
    const out = memoryStream();
    expect(await devCommand({ harnessDir: dir, out: out.stream, spawn: f.spawn })).toBe(1);
    expect(f.calls).toHaveLength(0);
    expect(out.text()).toContain("harness-md-mismatch");
    expect(out.text()).toContain("Fix the errors above before opening the app.");
  });

  it("passes the electron-vite exit code through", async () => {
    expect(await devCommand({ harnessDir: await harness(), out: memoryStream().stream, spawn: fakeSpawn(3).spawn })).toBe(3);
  });

  it("says why electron-vite could not start", async () => {
    const spawn: DevSpawn = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn electron-vite ENOENT"), { code: "ENOENT" })));
      return child;
    };
    const out = memoryStream();
    expect(await devCommand({ harnessDir: await harness(), out: out.stream, spawn })).toBe(1);
    expect(out.text()).toContain("Could not start electron-vite: spawn electron-vite ENOENT");
  });
});

describe("humanharness dev", () => {
  it("refuses an engine the harness doesn't offer, after checking", async () => {
    const m = memoryIo(await harness());
    expect(await main(["dev", "--engine", "gemini"], m.io)).toBe(2);
    expect(m.err()).toContain('Engine "gemini" is not available');
  });
});

describe("dev --mock", () => {
  async function runDev(dir: string, opts: { mock?: boolean; keep?: boolean; engine?: string; tmpRoot?: string }) {
    const f = fakeSpawn();
    const out = memoryStream();
    const code = await devCommand({ harnessDir: dir, out: out.stream, spawn: f.spawn, tmpRoot: root, ...opts });
    return { code, env: (f.calls[0]?.env ?? {}) as NodeJS.ProcessEnv, out: out.text() };
  }
  async function mockHarness() {
    const dir = await harness();
    fs.mkdirSync(path.join(dir, "mock"), { recursive: true });
    fs.writeFileSync(path.join(dir, "mock", "example.json"), JSON.stringify({ version: 1, action: "example", match: "# Task: example", turns: [{ id: "t1", text: "hi" }] }));
    return dir;
  }

  it("passes the mock env: fake claude over mock/, fresh temp folders, the badge flag", async () => {
    const dir = await mockHarness();
    const { env, code } = await runDev(dir, { mock: true });
    expect(code).toBe(0);
    expect(env.HH_TEST_MOCK).toBe("1");
    // Mock mode runs a time box fast: a minute is a second.
    expect(env.HH_TEST_MINUTE_MS).toBe("1000");
    const engines = JSON.parse(env.HH_TEST_ENGINES!);
    expect(Object.keys(engines)).toEqual(["claude"]);
    expect(engines.claude.env.HH_FAKE_MOCK_DIR).toBe(path.join(dir, "mock"));
    expect(Object.keys(engines.claude.env).every((k) => k.startsWith("HH_FAKE_"))).toBe(true);
    for (const k of ["HH_TEST_USER_DATA", "HH_TEST_SHARED_DIR", "HH_TEST_SUGGESTED_FOLDER"]) expect(path.isAbsolute(env[k]!)).toBe(true);
    expect(env.HH_TEST_USER_DATA!.startsWith(root)).toBe(true);
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("hh-mock-h"))).toEqual([]);
  });

  it("starts fresh unless --keep", async () => {
    const dir = await mockHarness();
    const first = await runDev(dir, { mock: true });
    fs.writeFileSync(path.join(first.env.HH_TEST_USER_DATA!, "config.json"), "{}");
    const kept = await runDev(dir, { mock: true, keep: true });
    expect(fs.existsSync(path.join(kept.env.HH_TEST_USER_DATA!, "config.json"))).toBe(true);
    const fresh = await runDev(dir, { mock: true });
    expect(fs.existsSync(path.join(fresh.env.HH_TEST_USER_DATA!, "config.json"))).toBe(false);
  });

  it("stops when mock/ has no recording", async () => {
    const dir = await harness();
    const { code, out } = await runDev(dir, { mock: true });
    expect(code).toBe(1);
    expect(out).toContain("humanharness run <action> --record");
  });

  it("--keep needs --mock; --mock needs claude", async () => {
    const dir = await mockHarness();
    await expect(runDev(dir, { keep: true })).rejects.toThrow("--keep only works with --mock");
    await expect(runDev(dir, { mock: true, engine: "codex" })).rejects.toThrow("Mock mode replays as Claude");
  });

  it("drops inherited HH_TEST_*, HH_FAKE_* and HH_DEV_ENGINE", async () => {
    const dir = await mockHarness();
    process.env.HH_TEST_USER_DATA = "/stray";
    process.env.HH_DEV_ENGINE = "codex";
    process.env.HH_FAKE_MOCK_DIR = "/stray";
    try {
      const plain = await runDev(dir, {});
      expect(plain.env.HH_TEST_USER_DATA).toBeUndefined();
      expect(plain.env.HH_DEV_ENGINE).toBeUndefined();
      expect(plain.env.HH_FAKE_MOCK_DIR).toBeUndefined();
      const mocked = await runDev(dir, { mock: true });
      expect(mocked.env.HH_TEST_USER_DATA).not.toBe("/stray");
    } finally {
      delete process.env.HH_TEST_USER_DATA;
      delete process.env.HH_DEV_ENGINE;
      delete process.env.HH_FAKE_MOCK_DIR;
    }
  });

  it("a broken recording is a warning without --mock, and an error with it", async () => {
    const dir = await mockHarness();
    fs.writeFileSync(path.join(dir, "mock", "broken.json"), "{");
    const plain = fakeSpawn();
    const out = memoryStream();
    expect(await devCommand({ harnessDir: dir, out: out.stream, spawn: plain.spawn })).toBe(0);
    expect(out.text()).toContain("mock-schema");
    expect(plain.calls).toHaveLength(1);
    const mocked = fakeSpawn();
    expect(await devCommand({ harnessDir: dir, mock: true, tmpRoot: root, out: memoryStream().stream, spawn: mocked.spawn })).toBe(1);
    expect(mocked.calls).toHaveLength(0);
    fs.rmSync(path.join(dir, "mock", "broken.json"));
  });

  it("reports an unusable mock folder cleanly", async () => {
    const dir = await mockHarness();
    const blocked = path.join(root, "blocked");
    fs.writeFileSync(blocked, "x");
    const { code, out } = await runDev(dir, { mock: true, tmpRoot: blocked });
    expect(code).toBe(1);
    expect(out).toContain("Could not prepare");
  });
});

describe("devCommand env (plugin dev)", () => {
  it("without env spawns exactly the environment it always did, inherited HH_PLUGIN_* included (D0)", async () => {
    const dir = await harness();
    process.env.HH_PLUGIN_DIRS = "/stray";
    try {
      const f = fakeSpawn();
      expect(await devCommand({ harnessDir: dir, out: memoryStream().stream, spawn: f.spawn })).toBe(0);
      const expected: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: dir };
      delete expected.ELECTRON_RUN_AS_NODE;
      for (const k of Object.keys(expected)) if (k.startsWith("HH_TEST_") || k.startsWith("HH_FAKE_") || k === "HH_DEV_ENGINE") delete expected[k];
      expect(f.calls[0].env).toEqual(expected);
      expect(f.calls[0].env?.HH_PLUGIN_FIXTURES).toBeUndefined();
    } finally {
      delete process.env.HH_PLUGIN_DIRS;
    }
  });

  it("env is added to the spawned environment and replaces inherited HH_PLUGIN_* variables", async () => {
    const dir = await harness();
    process.env.HH_PLUGIN_FIXTURES = "1";
    process.env.HH_PLUGIN_DIRS = "/stray";
    try {
      const f = fakeSpawn();
      expect(await devCommand({ harnessDir: dir, env: { HH_PLUGIN_DIRS: "/p" }, out: memoryStream().stream, spawn: f.spawn })).toBe(0);
      expect(f.calls[0].env).toMatchObject({ HH_HARNESS_DIR: dir, HH_PLUGIN_DIRS: "/p" });
      expect(f.calls[0].env?.HH_PLUGIN_FIXTURES).toBeUndefined();
    } finally {
      delete process.env.HH_PLUGIN_FIXTURES;
      delete process.env.HH_PLUGIN_DIRS;
    }
  });
});
