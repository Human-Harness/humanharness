import { EventEmitter } from "node:events";
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
});

describe("humanharness dev", () => {
  it("refuses an engine the harness doesn't offer, after checking", async () => {
    const m = memoryIo(await harness());
    expect(await main(["dev", "--engine", "gemini"], m.io)).toBe(2);
    expect(m.err()).toContain('Engine "gemini" is not available');
  });
});
