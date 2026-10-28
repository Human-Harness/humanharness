import { execFile } from "node:child_process";
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

/** child_process.execFile, no shell, the given env only, stdin closed, killed past the time or the size. */
export function runFile(file: string, args: string[], o: RunOptions): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(
        file,
        args,
        {
          shell: false,
          env: o.env,
          cwd: o.cwd,
          timeout: o.timeoutMs ?? EXEC_LIMITS.timeoutMs,
          maxBuffer: o.maxBytes ?? EXEC_LIMITS.maxBytes,
          killSignal: "SIGKILL",
          windowsHide: true,
          encoding: "utf8",
          ...(o.signal ? { signal: o.signal } : {}),
        },
        (err, stdout, stderr) => {
          const out = { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
          if (!err) return resolve({ code: 0, ...out });
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: unknown };
          if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve({ code: -1, ...out, tooLarge: true });
          if (typeof e.code === "number") return resolve({ code: e.code, ...out });
          if (e.killed && e.signal === "SIGKILL" && !o.signal?.aborted) return resolve({ code: -1, ...out, timedOut: true });
          if (typeof e.code === "string" && e.code !== "ABORT_ERR") return resolve({ code: -1, ...out, spawnError: true });
          resolve({ code: -1, ...out });
        },
      );
    } catch {
      return resolve({ code: -1, stdout: "", stderr: "", spawnError: true });
    }
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
