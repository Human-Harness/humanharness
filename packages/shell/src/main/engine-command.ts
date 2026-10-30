import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import { commandLine } from "@humanharness/engines/registry";

export interface RunResult {
  stdout: string;
  code: number;
  /** It was stopped for taking too long. */
  timedOut?: boolean;
  /** It couldn't be started. */
  spawnError?: boolean;
}

export interface CommandDeps {
  shell: string;
  home: string;
  /**
   * Runs a command to completion. `env` is added to the app's own environment (PATH and the like,
   * never credentials). `timedOut` / `spawnError` say the command gave no real answer.
   */
  run: (cmd: string, args: string[], env?: Record<string, string>) => Promise<RunResult>;
  isExecutable: (file: string) => Promise<boolean>;
  electronPath: string;
  /** Resolves a module path, from this package or (with `from`) from another module's location. */
  resolveModule: (id: string, from?: string) => string;
}

/** Bundled ACP adapters, by the npm package the engine's command names. */
const BUNDLED_ADAPTERS: Record<string, string> = {
  "@agentclientprotocol/codex-acp": "@agentclientprotocol/codex-acp/dist/index.js",
};

/** Official CLIs bundled with an adapter, by engine id: resolved from the adapter's own location. */
const BUNDLED_CLIS: Record<string, { adapter: string; cli: string }> = {
  codex: { adapter: "@agentclientprotocol/codex-acp/dist/index.js", cli: "@openai/codex/bin/codex.js" },
};

/** Common bin folders: also the PATH when the login shell can't tell. */
const commonBinDirs = (home: string): string[] => [path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];

/**
 * Folders official installers use, searched after PATH: a fresh install may not be on the login PATH yet.
 * OpenCode's installer folder (spike A1) is searched only for `opencode`, so the other engines stay as they were.
 */
export const knownBinDirs = (home: string, name: string): string[] =>
  name === "opencode" ? [...commonBinDirs(home), path.join(home, ".opencode/bin")] : commonBinDirs(home);

/** The login shell's PATH, or null when it can't tell. */
async function readLoginShellPath(d: CommandDeps): Promise<string | null> {
  try {
    const { stdout, code } = await d.run(d.shell, ["-ilc", 'printf "%s" "$PATH"']);
    if (code === 0 && stdout.trim()) return stdout.trim().split("\n").pop()!;
  } catch {
    // fall through
  }
  return null;
}

const fallbackPath = (d: CommandDeps) => [...commonBinDirs(d.home), "/usr/bin", "/bin"].join(":");

export async function loginShellPath(d: CommandDeps): Promise<string> {
  return (await readLoginShellPath(d)) ?? fallbackPath(d);
}

/** Login PATHs read once per deps: only a successful read is kept, so a failed one is tried again next time. */
const sharedPaths = new WeakMap<CommandDeps, string>();

/**
 * The login shell's PATH as the engines get it (`engineCommand`) and as the engine-config check looks programs up on
 * it: one value, read once, so the two can't drift. A failed read gives the common folders and is retried next call.
 */
export async function engineSearchPath(d: CommandDeps): Promise<string> {
  const known = sharedPaths.get(d);
  if (known !== undefined) return known;
  const read = await readLoginShellPath(d);
  if (read === null) return fallbackPath(d);
  sharedPaths.set(d, read);
  return read;
}

export async function resolveBinary(name: string, searchPath: string, d: CommandDeps): Promise<string | null> {
  const dirs = new Set([...searchPath.split(":").filter(Boolean), ...knownBinDirs(d.home, name)]);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await d.isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * How the app starts an engine. Null when the CLI isn't installed. Never adds credentials. `sharedPath` (a harness
 * with `enginePresets`): the PATH is the one the engine-config check uses (`engineSearchPath`, read once); without it
 * the login PATH is read fresh each time, as before (D0).
 */
export async function engineCommand(
  engine: EngineDef,
  d: CommandDeps,
  o: { sharedPath?: boolean } = {},
): Promise<{ command: string[]; env: Record<string, string> } | null> {
  const PATH = o.sharedPath ? await engineSearchPath(d) : await loginShellPath(d);
  const line = commandLine(engine);
  const pkg = line.find((part) => part.replace(/@[^@/]+$/, "") in BUNDLED_ADAPTERS);
  if (pkg) {
    const entry = d.resolveModule(BUNDLED_ADAPTERS[pkg.replace(/@[^@/]+$/, "")]);
    return { command: [d.electronPath, entry], env: { PATH, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const [binaryName, ...args] = line;
  const binary = await resolveBinary(binaryName, PATH, d);
  return binary ? { command: [binary, ...args], env: { PATH } } : null;
}

export interface CliCommand {
  command: string[];
  env: Record<string, string>;
  /** True when it is the copy bundled with the app (never installed or updated by the app). */
  bundled: boolean;
}

/** How the app runs an engine's own CLI (version, status, login, update). Null when it isn't there. */
export async function cliCommand(engine: EngineDef, d: CommandDeps): Promise<CliCommand | null> {
  const PATH = await loginShellPath(d);
  const bundled = BUNDLED_CLIS[engine.id];
  if (bundled) {
    try {
      const cli = d.resolveModule(bundled.cli, d.resolveModule(bundled.adapter));
      return { command: [d.electronPath, cli], env: { PATH, ELECTRON_RUN_AS_NODE: "1" }, bundled: true };
    } catch {
      // not bundled in this build: look for an installed CLI
    }
  }
  const binary = await resolveBinary(engine.detect.binary, PATH, d);
  return binary ? { command: [binary], env: { PATH }, bundled: false } : null;
}
