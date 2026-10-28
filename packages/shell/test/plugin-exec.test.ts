import { describe, expect, it } from "vitest";
import { pluginExec, runFile } from "../src/main/plugin-exec";

const gh = [{ cmd: "gh", args: ["api", "--method", "GET", "*"] }];
const fakeRun = () => {
  const calls: { file: string; args: string[]; env: Record<string, string>; cwd: string }[] = [];
  return { calls, run: async (file: string, args: string[], o: { env: Record<string, string>; cwd: string }) => (calls.push({ file, args, ...o }), { code: 0, stdout: "[]", stderr: "" }) };
};

describe("pluginExec (plugins spec §4.2, Decision 9, B7)", () => {
  it("runs a declared command with matching args, without a shell, with a minimal env", async () => {
    const r = fakeRun();
    const out = await pluginExec("gh", ["api", "--method", "GET", "/repos/x; rm -rf ~"], { patterns: gh, resolve: async () => "/opt/homebrew/bin/gh", run: r.run, cwd: "/ud/plugin-exec/oncall", env: { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/x", LANG: "en_US.UTF-8", TERM: "dumb" } });
    expect(out).toEqual({ ok: true, result: { code: 0, stdout: "[]", stderr: "" } });
    expect(r.calls[0]).toEqual({ file: "/opt/homebrew/bin/gh", args: ["api", "--method", "GET", "/repos/x; rm -rf ~"], cwd: "/ud/plugin-exec/oncall", env: { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/x", LANG: "en_US.UTF-8", TERM: "dumb" } });
  });

  it("refuses an undeclared command or args, before resolving anything", async () => {
    const r = fakeRun();
    let resolved = false;
    const o = { patterns: gh, resolve: async () => ((resolved = true), "/x"), run: r.run, cwd: "/c", env: {} };
    expect(await pluginExec("sh", ["-c", "id"], o)).toMatchObject({ ok: false });
    expect(await pluginExec("gh", ["api", "--method", "POST", "/x"], o)).toMatchObject({ ok: false });
    expect(await pluginExec("gh", ["api", "--method", "GET", "/x", "--method", "POST"], o)).toMatchObject({ ok: false });
    expect(await pluginExec("/usr/bin/gh", ["api", "--method", "GET", "/x"], o)).toMatchObject({ ok: false });
    expect(await pluginExec("gh", ["api", "--method", "GET", "{{secret:jira}}"], o)).toMatchObject({ ok: false });
    expect(await pluginExec("gh", "api" as never, o)).toMatchObject({ ok: false });
    expect(await pluginExec("gh", ["api", "--method", "GET", 7] as never, o)).toMatchObject({ ok: false });
    expect(resolved).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("a command that isn't installed says so", async () => {
    expect(await pluginExec("gh", ["api", "--method", "GET", "/x"], { patterns: gh, resolve: async () => null, run: fakeRun().run, cwd: "/c", env: {} })).toEqual({ ok: false, reason: "gh was not found on this computer" });
  });

  it("a resolved path that isn't absolute is refused", async () => {
    const r = fakeRun();
    expect(await pluginExec("gh", ["api", "--method", "GET", "/x"], { patterns: gh, resolve: async () => "gh", run: r.run, cwd: "/c", env: {} })).toMatchObject({ ok: false });
    expect(r.calls).toEqual([]);
  });

  it("time and size overruns become refusals", async () => {
    const o = (out: object) => ({ patterns: gh, resolve: async () => "/x/gh", run: async () => ({ code: -1, stdout: "", stderr: "", ...out }), cwd: "/c", env: {} });
    const args = ["api", "--method", "GET", "/x"];
    expect(await pluginExec("gh", args, o({ timedOut: true }))).toEqual({ ok: false, reason: "The command took more than 30 s" });
    expect(await pluginExec("gh", args, o({ tooLarge: true }))).toEqual({ ok: false, reason: "The command's output is larger than 10 MB" });
    expect(await pluginExec("gh", args, o({ spawnError: true }))).toMatchObject({ ok: false, reason: expect.stringMatching(/start/) });
  });
});

describe("runFile (the real runner)", () => {
  it("passes only the given env and kills output over the cap", async () => {
    const env = await runFile(process.execPath, ["-e", "process.stdout.write(Object.keys(process.env).sort().join(','))"], { env: { HOME: "/tmp", PATH: "/usr/bin" }, cwd: process.cwd() });
    expect(env.stdout.split(",").filter((k) => !k.startsWith("__CF"))).toEqual(["HOME", "PATH"]);
    const big = await runFile(process.execPath, ["-e", "process.stdout.write('x'.repeat(2048))"], { env: {}, cwd: process.cwd(), maxBytes: 1024 });
    expect(big).toMatchObject({ tooLarge: true });
  });

  it("the output cap counts stdout and stderr together", async () => {
    const both = await runFile(process.execPath, ["-e", "process.stdout.write('x'.repeat(600)); process.stderr.write('y'.repeat(600))"], { env: {}, cwd: process.cwd(), maxBytes: 1024 });
    expect(both).toMatchObject({ tooLarge: true });
    const under = await runFile(process.execPath, ["-e", "process.stdout.write('x'.repeat(500)); process.stderr.write('y'.repeat(500))"], { env: {}, cwd: process.cwd(), maxBytes: 1024 });
    expect(under).toMatchObject({ code: 0 });
    expect(under.stdout.length + under.stderr.length).toBe(1000);
  });

  it.skipIf(process.platform === "win32")("a timeout or the run ending kills the whole process group", async () => {
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const gone = async (pid: number) => {
      for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
      return !alive(pid);
    };
    const script = "sleep 30 & echo $!; sleep 30";
    const t0 = Date.now();
    const timed = await runFile("/bin/sh", ["-c", script], { env: {}, cwd: process.cwd(), timeoutMs: 300 });
    expect(timed).toMatchObject({ timedOut: true });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await gone(Number(timed.stdout.trim()))).toBe(true);

    const ac = new AbortController();
    const p = runFile("/bin/sh", ["-c", script], { env: {}, cwd: process.cwd(), signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    const aborted = await p;
    expect(aborted).toMatchObject({ code: -1 });
    expect(aborted.timedOut).toBeUndefined();
    expect(await gone(Number(aborted.stdout.trim()))).toBe(true);
  });

  it("never goes through a shell, and gives the exit code and stderr", async () => {
    const r = await runFile(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.exit(3)", "$(id); `id`"], { env: {}, cwd: process.cwd() });
    expect(r).toEqual({ code: 3, stdout: "", stderr: "$(id); `id`" });
  });

  it("closes stdin, so a command waiting on it ends", async () => {
    const r = await runFile(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('eof'))"], { env: {}, cwd: process.cwd(), timeoutMs: 5000 });
    expect(r).toMatchObject({ code: 0, stdout: "eof" });
  });

  it("times out, and a signal kills it", async () => {
    expect(await runFile(process.execPath, ["-e", "setTimeout(()=>{}, 5000)"], { env: {}, cwd: process.cwd(), timeoutMs: 100 })).toMatchObject({ timedOut: true });
    const ac = new AbortController();
    const p = runFile(process.execPath, ["-e", "setTimeout(()=>{}, 5000)"], { env: {}, cwd: process.cwd(), signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    expect(await p).toMatchObject({ code: -1 });
  });

  it("a missing file is a spawn error", async () => {
    expect(await runFile("/nonexistent/hh-nope", [], { env: {}, cwd: process.cwd() })).toMatchObject({ spawnError: true });
  });
});
