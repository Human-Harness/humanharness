import { spawn } from "node:child_process";
import type { EngineDef } from "@humanharness/engines";
import type { SetupOutput, SetupStep } from "@humanharness/ui/client";
import type { CliCommand } from "./engine-command";

export interface ProcessCommand {
  command: string[];
  env: Record<string, string>;
}

/**
 * The command for one setup step, or null when the engine has none. Install runs the provider's
 * official command through bash; update, login and logout run the engine's own CLI.
 */
export function setupCommand(engine: EngineDef, step: SetupStep, cli: CliCommand | null, PATH: string): ProcessCommand | null {
  const setup = engine.setup;
  if (!setup) return null;
  if (step === "install") return setup.install ? { command: ["/bin/bash", "-c", setup.install.command], env: { PATH } } : null;
  if (!cli) return null;
  const args = { login: setup.login, update: setup.update, logout: setup.logout }[step];
  return args ? { command: [...cli.command, ...args], env: cli.env } : null;
}

const URL_RE = /https:\/\/[^\s"'<>]+/;
/** A terminal hyperlink's target (OSC 8). */
const OSC8_URL = /\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\s\u0007\u001b]+)/;
/** Punctuation that ends a sentence rather than the address. */
const TRAILING = /[.,;:)\]]+$/;
// Colours, cursor moves and OSC sequences (e.g. hyperlinks, ended by BEL or ESC \) that CLIs print even without a terminal.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
/** After SIGTERM, how long the process group gets before SIGKILL. */
const KILL_MS = 3000;
/** After the process exits, how long to wait for its output to end (a grandchild may hold the pipes open). */
const CLOSE_GRACE_MS = 500;

export interface RunningSetup {
  /** Writes one line to the process (e.g. a code from the sign-in page). */
  write(text: string): void;
  cancel(): void;
  /** Stops the process and everything it started right away (SIGKILL to the group). */
  kill(): void;
  /** The exit code; null when it was killed, timed out or couldn't start. */
  exit: Promise<number | null>;
}

export interface SetupRunOptions {
  /** Stops the process (and everything it started) after this long. */
  timeoutMs?: number;
}

/**
 * Spawns one setup process in its own process group and reports its output line by line, plus the
 * first web address it prints. Cancel and timeout stop the whole group (SIGTERM, then SIGKILL).
 */
export function runSetupProcess(cmd: ProcessCommand, onOutput: (o: SetupOutput) => void, opts: SetupRunOptions = {}): RunningSetup {
  const [binary, ...args] = cmd.command;
  const useGroup = process.platform !== "win32";
  const child = spawn(binary, args, { env: { ...process.env, ...cmd.env }, stdio: ["pipe", "pipe", "pipe"], detached: useGroup });
  let urlSent = false;
  // Once cancelled, nothing more is reported: late output belongs to a run the user abandoned.
  let cancelled = false;
  let finished = false;

  const killTree = (sig: NodeJS.Signals) => {
    try {
      if (useGroup && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // already gone
      }
    }
  };

  const emitLine = (raw: string) => {
    const text = raw.replace(ANSI, "").trim();
    if (!text || cancelled) return;
    onOutput({ kind: "line", text });
    const found = urlSent ? undefined : (OSC8_URL.exec(raw)?.[1] ?? URL_RE.exec(text)?.[0]);
    const url = found?.replace(TRAILING, "");
    if (url) {
      urlSent = true;
      onOutput({ kind: "url", url });
    }
  };
  const read = (stream: NodeJS.ReadableStream) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      rest += chunk;
      const lines = rest.split(/\r?\n|\r/);
      rest = lines.pop() ?? "";
      for (const line of lines) emitLine(line);
    });
    stream.on("end", () => {
      if (rest) emitLine(rest);
      rest = "";
    });
  };
  read(child.stdout!);
  read(child.stderr!);
  child.stdin!.on("error", () => {}); // the process may exit before reading

  const cancel = () => {
    if (cancelled || finished) return;
    cancelled = true;
    killTree("SIGTERM");
    // Escalate: kill the whole group (including stragglers that ignore SIGTERM) after a delay.
    setTimeout(() => killTree("SIGKILL"), KILL_MS).unref();
  };

  const timeout = opts.timeoutMs
    ? setTimeout(() => {
        if (!finished && !cancelled) onOutput({ kind: "line", text: "Stopped: this took too long." });
        cancel();
      }, opts.timeoutMs)
    : undefined;

  const exit = new Promise<number | null>((resolve) => {
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(cancelled ? null : code);
    };
    child.on("error", (err) => {
      onOutput({ kind: "line", text: err.message });
      finish(null);
    });
    child.on("close", (code) => finish(code));
    // A grandchild that inherited the pipes can keep them open: don't wait for it forever.
    child.on("exit", (code) => {
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code);
      }, CLOSE_GRACE_MS).unref();
    });
  });

  return {
    write: (text) => {
      if (child.stdin!.writable) child.stdin!.write(`${text.trim()}\n`);
    },
    cancel,
    kill: () => {
      cancelled = true;
      killTree("SIGKILL");
    },
    exit,
  };
}

/** For quitting: cancels the run, waits up to `graceMs` for it to end, then kills its whole group. */
export async function stopSetupProcess(run: RunningSetup, graceMs = 3000): Promise<void> {
  run.cancel();
  let timer: NodeJS.Timeout | undefined;
  const ended = await Promise.race([
    run.exit.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), graceMs);
    }),
  ]);
  clearTimeout(timer);
  if (!ended) run.kill();
}
