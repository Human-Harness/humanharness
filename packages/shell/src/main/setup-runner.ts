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
// Colours and cursor moves that CLIs print even without a terminal.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export interface RunningSetup {
  /** Writes one line to the process (e.g. a code from the sign-in page). */
  write(text: string): void;
  cancel(): void;
  /** The exit code; null when it was killed or couldn't start. */
  exit: Promise<number | null>;
}

/** Spawns one setup process and reports its output line by line, plus the first web address it prints. */
export function runSetupProcess(cmd: ProcessCommand, onOutput: (o: SetupOutput) => void): RunningSetup {
  const [binary, ...args] = cmd.command;
  const child = spawn(binary, args, { env: { ...process.env, ...cmd.env }, stdio: ["pipe", "pipe", "pipe"] });
  let urlSent = false;

  const emitLine = (raw: string) => {
    const text = raw.replace(ANSI, "").trim();
    if (!text) return;
    onOutput({ kind: "line", text });
    const url = urlSent ? undefined : URL_RE.exec(text)?.[0];
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

  const exit = new Promise<number | null>((resolve) => {
    child.on("error", (err) => {
      onOutput({ kind: "line", text: err.message });
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });

  return {
    write: (text) => {
      if (child.stdin!.writable) child.stdin!.write(`${text.trim()}\n`);
    },
    cancel: () => {
      child.kill("SIGTERM");
    },
    exit,
  };
}
