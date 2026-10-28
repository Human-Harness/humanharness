import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { type PluginPermissions, execAllowed } from "@humanharness/harness-sdk";

/**
 * The broker's `ctx.exec` (plugins spec §4.2, Decision 9; threat model B7): only a command and args an approved
 * pattern matches, run by its resolved path with no shell, a minimal env the caller gives, an empty folder as cwd, and
 * killed past 30 s or 10 MB of output. Keys never go into a command (execAllowed refuses anything like a reference).
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface RunOutcome extends ExecResult {
  timedOut?: true;
  tooLarge?: true;
  spawnError?: true;
}
export type ExecOutcome = { ok: true; result: ExecResult } | { ok: false; reason: string };
export interface RunOptions {
  env: Record<string, string>;
  cwd: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** The run's signal: the run ending kills the command. */
  signal?: AbortSignal;
}

export const EXEC_LIMITS = { timeoutMs: 30_000, maxBytes: 10 * 1024 * 1024 } as const;

/**
 * child_process.spawn, no shell, the given env only, stdin closed, killed past the time or the size (stdout and stderr
 * together). The command leads its own process group (detached, never unref'd), and a kill takes the whole group, so
 * what it started in the background dies with it and can't hold its output open.
 */
export function runFile(file: string, args: string[], o: RunOptions): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const maxBytes = o.maxBytes ?? EXEC_LIMITS.maxBytes;
    if (o.signal?.aborted) return resolve({ code: -1, stdout: "", stderr: "" });
    let child: ChildProcess;
    try {
      child = spawn(file, args, { shell: false, env: o.env, cwd: o.cwd, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return resolve({ code: -1, stdout: "", stderr: "", spawnError: true });
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let why: "timedOut" | "tooLarge" | "aborted" | undefined;
    let settled = false;
    const kill = (reason: NonNullable<typeof why>) => {
      why ??= reason;
      try {
        if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      // Whatever escaped the group may still hold the pipes: stop reading so the close comes.
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const timer = setTimeout(() => kill("timedOut"), o.timeoutMs ?? EXEC_LIMITS.timeoutMs);
    const onAbort = () => kill("aborted");
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      if (why) return;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) return kill("tooLarge");
      into.push(chunk);
    };
    child.stdout?.on("data", collect(out));
    child.stderr?.on("data", collect(err));
    const finish = (r: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    child.on("error", () => {
      if (child.pid === undefined) finish({ code: -1, stdout: "", stderr: "", spawnError: true });
    });
    child.on("close", (code) => {
      const text = { stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") };
      if (why === "tooLarge") return finish({ code: -1, ...text, tooLarge: true });
      if (why === "timedOut") return finish({ code: -1, ...text, timedOut: true });
      finish({ code: why === undefined && typeof code === "number" ? code : -1, ...text });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end();
  });
}

export interface PluginExecOptions {
  /** The approved `permissions.exec`. */
  patterns: PluginPermissions["exec"];
  /** The command's absolute path on the login shell's PATH, or null. */
  resolve(cmd: string): Promise<string | null>;
  run: typeof runFile;
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
}

export async function pluginExec(cmd: string, args: string[], o: PluginExecOptions): Promise<ExecOutcome> {
  if (typeof cmd !== "string" || !Array.isArray(args) || !args.every((a) => typeof a === "string") || !execAllowed(cmd, args, o.patterns)) {
    const shown = typeof cmd === "string" && Array.isArray(args) ? [cmd, ...args.map(String)].join(" ") : "This command";
    return { ok: false, reason: `${shown.slice(0, 200)} is not declared in permissions.exec` };
  }
  const file = await o.resolve(cmd);
  if (file === null) return { ok: false, reason: `${cmd} was not found on this computer` };
  if (!path.isAbsolute(file)) return { ok: false, reason: `${cmd} was not found on this computer` };
  const out = await o.run(file, [...args], { env: o.env, cwd: o.cwd, ...(o.signal ? { signal: o.signal } : {}) });
  if (out.timedOut) return { ok: false, reason: "The command took more than 30 s" };
  if (out.tooLarge) return { ok: false, reason: "The command's output is larger than 10 MB" };
  if (out.spawnError) return { ok: false, reason: `Couldn't start ${cmd}` };
  if (o.signal?.aborted) return { ok: false, reason: "The sync run ended" };
  return { ok: true, result: { code: out.code, stdout: out.stdout, stderr: out.stderr } };
}
