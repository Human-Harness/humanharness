import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BackendInit } from "@humanharness/harness-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendLogStream } from "../../src/main/backend/backend-log";
import { BackendProcess, type BackendProcessOptions } from "../../src/main/backend/backend-process";

const launcher = { command: process.execPath, args: [], env: { HH_LAUNCHER_MARK: "1" } };
const fixtures = path.resolve(__dirname, "../fixtures/backends");
const fixture = (n: string) => path.join(fixtures, `${n}.mjs`);
const init: BackendInit = { folder: "/w", scopes: [], language: "en", coreVersion: "0.1.0", dataDir: "/d", mock: false };

/** A log that keeps what it was given, as "<stream> <text>". */
function memoryLog() {
  const lines: string[] = [];
  return {
    lines,
    write: (stream: BackendLogStream, text: string) => {
      lines.push(`${stream} ${text}`);
      return Promise.resolve();
    },
    has: (part: string) => lines.some((l) => l.includes(part)),
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("BackendProcess (hatches spec §4.2, §4.3)", () => {
  const started: BackendProcess[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((p) => p.stop()));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function start(name: string, more: Partial<BackendProcessOptions> = {}) {
    const log = memoryLog();
    const events: { event: string; data: unknown }[] = [];
    const p = await BackendProcess.start({
      launcher,
      entry: fixture(name),
      cwd: fixtures,
      init,
      log,
      onEvent: (event, data) => events.push({ event, data }),
      ...more,
    });
    started.push(p);
    return { p, log, events };
  }

  it("sends init first; init has exactly these keys (B7)", async () => {
    const { p } = await start("echo");
    const got = (await p.call("init?", {})) as BackendInit;
    expect(got).toEqual(init);
    expect(Object.keys(got).sort()).toEqual(["coreVersion", "dataDir", "folder", "language", "mock", "scopes"]);
  });

  it("runs in its own process with the harness folder as cwd and the launcher's env (B1)", async () => {
    const harnessDir = mkdtempSync(path.join(os.tmpdir(), "hh-backend-cwd-"));
    dirs.push(harnessDir);
    copyFileSync(fixture("cwd"), path.join(harnessDir, "cwd.mjs"));
    const { p } = await start("cwd", { entry: path.join(harnessDir, "cwd.mjs"), cwd: harnessDir });
    const got = (await p.call("whereami", {})) as { cwd: string; env: string[]; pid: number };
    expect(got.cwd).toBe(realpathSync(harnessDir));
    expect(got.env).toContain("HH_LAUNCHER_MARK");
    expect(got.pid).not.toBe(process.pid);
  });

  it("refuses an entry that leads outside the harness folder, through a symlink too", async () => {
    const harnessDir = mkdtempSync(path.join(os.tmpdir(), "hh-backend-entry-"));
    dirs.push(harnessDir);
    symlinkSync(fixture("echo"), path.join(harnessDir, "index.mjs"));
    const log = memoryLog();
    const base = { launcher, init, log, onEvent: () => {} };
    await expect(BackendProcess.start({ ...base, entry: path.join(harnessDir, "index.mjs"), cwd: harnessDir })).rejects.toThrow(
      "The backend's entry is outside the harness folder",
    );
    await expect(BackendProcess.start({ ...base, entry: fixture("echo"), cwd: harnessDir })).rejects.toThrow(
      "The backend's entry is outside the harness folder",
    );
    await expect(BackendProcess.start({ ...base, entry: path.join(harnessDir, "missing.mjs"), cwd: harnessDir })).rejects.toThrow();
  });

  it("call answers with the result; a backend error rejects with its message", async () => {
    const { p } = await start("echo");
    await expect(p.call("echo", { a: [1, "two"] })).resolves.toEqual({ a: [1, "two"] });
    await expect(p.call("fail", {})).rejects.toThrow("nope");
  });

  it("call times out after the timeout and rejects 'The backend didn't answer in time'", async () => {
    const { p } = await start("slow", { timeoutMs: 200 });
    const t0 = Date.now();
    await expect(p.call("anything", {})).rejects.toThrow("The backend didn't answer in time");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });

  it("refuses params that can't be sent or don't fit one line", async () => {
    const { p } = await start("echo");
    await expect(p.call("echo", { big: "x".repeat(1024 * 1024) })).rejects.toThrow("The call is too large for the backend");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(p.call("echo", cyclic)).rejects.toThrow("The call's params can't be sent to the backend");
  });

  it("events stream through the limiter, in order", async () => {
    const { p, events } = await start("echo");
    const seen: number[] = [];
    const result = p.call("stream", { n: 5 }).then((r) => {
      seen.push(events.length);
      return r;
    });
    await expect(result).resolves.toEqual({ sent: 5 });
    expect(seen).toEqual([5]);
    expect(events).toEqual([0, 1, 2, 3, 4].map((i) => ({ event: "tick", data: { i } })));
  });

  it("events over 200 per second are dropped and counted (B5)", async () => {
    const { events, log } = await start("chatty");
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toHaveLength(200);
    // The drops may be reported in more than one line; they add up to 800.
    const droppedSum = () =>
      log.lines.reduce((sum, l) => sum + Number(/^app Dropped (\d+) backend events$/.exec(l)?.[1] ?? 0), 0);
    await until(() => droppedSum() >= 800);
    expect(droppedSum()).toBe(800);
    expect(events).toHaveLength(200);
  });

  it("a request from the backend is refused with -32601 and logged (B4)", async () => {
    const { log } = await start("asks");
    await until(() => log.has("-32601"));
    expect(log.lines.find((l) => l.startsWith("stderr answer:"))).toContain('"code":-32601');
    expect(log.lines).toContain("app A backend asked the app for history.save; refused");
  });

  it("stderr goes to the log, stdout lines that aren't protocol are dropped and logged", async () => {
    const { p, log } = await start("echo");
    await expect(p.call("noise", {})).resolves.toBe("done");
    await until(() => log.has("hello from stderr"));
    expect(log.lines).toContain("stderr hello from stderr");
    expect(log.lines).toContain("app Dropped a line from the backend: not JSON");
    // A line without "jsonrpc" and an answer to a call the app never made are told apart.
    expect(log.lines).toContain('app Dropped a line from the backend: not JSON-RPC 2.0 (every line needs "jsonrpc":"2.0")');
    expect(log.lines).toContain("app Dropped a line from the backend: a response to a call the app didn't make (or one that timed out)");
  });

  it("a last line without its newline still arrives when stdout closes", async () => {
    const { p, events } = await start("echo");
    void p.call("bye", {}).catch(() => {});
    await p.exited;
    expect(events).toEqual([{ event: "tick", data: { last: true } }]);
  });

  it("a listener that throws is logged and the stream goes on", async () => {
    const log = memoryLog();
    const p = await BackendProcess.start({
      launcher,
      entry: fixture("echo"),
      cwd: fixtures,
      init,
      log,
      onEvent: () => {
        throw new Error("listener broke");
      },
    });
    started.push(p);
    await expect(p.call("stream", { n: 2 })).resolves.toEqual({ sent: 2 });
    expect(log.lines.filter((l) => l === "app The app couldn't handle the backend event tick: listener broke")).toHaveLength(2);
    await expect(p.call("echo", 1)).resolves.toBe(1);
  });

  it("stop kills its whole process group, grandchildren included (B1)", async () => {
    const { p } = await start("grandchild");
    const gpid = (await p.call("pid", {})) as number;
    expect(alive(gpid)).toBe(true);
    await p.stop();
    try {
      await until(() => !alive(gpid), 2000);
    } finally {
      if (alive(gpid)) process.kill(gpid, "SIGKILL");
    }
  });

  it("once gone, a grandchild still holding stdout is not heard", async () => {
    const { p, events } = await start("grandchild");
    const gpid = (await p.call("pid", {})) as number;
    try {
      await until(() => events.length > 0);
      void p.call("leave", {}).catch(() => {});
      await p.exited;
      const atExit = events.length;
      await new Promise((r) => setTimeout(r, 400));
      expect(events.length).toBe(atExit);
    } finally {
      if (alive(gpid)) process.kill(gpid, "SIGKILL");
    }
  });

  it("stop sends SIGTERM; a backend that ignores SIGTERM is killed after 3 s (B8)", async () => {
    const { p } = await start("ignore-term", { graceMs: 300 });
    // Give it time to install its SIGTERM handler.
    await new Promise((r) => setTimeout(r, 150));
    const t0 = Date.now();
    await p.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    await expect(p.exited).resolves.toMatchObject({ signal: "SIGKILL", expected: true });
  });

  it("stop of a well-behaved backend is quick and expected", async () => {
    const { p } = await start("echo");
    const t0 = Date.now();
    await p.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    await expect(p.exited).resolves.toMatchObject({ signal: "SIGTERM", expected: true });
    await expect(p.call("echo", {})).rejects.toThrow("The backend isn't running");
  });

  it("an unexpected exit resolves `exited` with the code, and pending calls reject", async () => {
    const { p } = await start("crash");
    const pending = p.call("echo", {});
    await expect(pending).rejects.toThrow("The backend isn't running");
    await expect(p.exited).resolves.toEqual({ code: 1, signal: null, expected: false });
  });

  it("at most 64 calls in flight, the 65th rejects at once", async () => {
    const { p } = await start("slow");
    const pending = Array.from({ length: 64 }, (_, i) => p.call("wait", { i }).catch((e: Error) => e.message));
    await expect(p.call("wait", { i: 64 })).rejects.toThrow("Too many calls to the backend");
    await p.stop();
    expect(new Set(await Promise.all(pending))).toEqual(new Set(["The backend isn't running"]));
  });
});
