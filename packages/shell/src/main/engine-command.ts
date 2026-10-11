import path from "node:path";
import type { EngineDef } from "@humanharness/engines";

export interface CommandDeps {
  shell: string;
  home: string;
  /** Runs a command to completion. `env` is added to the app's own environment (PATH and the like, never credentials). */
  run: (cmd: string, args: string[], env?: Record<string, string>) => Promise<{ stdout: string; code: number }>;
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

/** Folders official installers use, searched after PATH: a fresh install may not be on the login PATH yet. */
export const knownBinDirs = (home: string): string[] => [path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];

export async function loginShellPath(d: CommandDeps): Promise<string> {
  try {
    const { stdout, code } = await d.run(d.shell, ["-ilc", 'printf "%s" "$PATH"']);
    if (code === 0 && stdout.trim()) return stdout.trim().split("\n").pop()!;
  } catch {
    // fall through
  }
  return [...knownBinDirs(d.home), "/usr/bin", "/bin"].join(":");
}

export async function resolveBinary(name: string, searchPath: string, d: CommandDeps): Promise<string | null> {
  const dirs = new Set([...searchPath.split(":").filter(Boolean), ...knownBinDirs(d.home)]);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await d.isExecutable(candidate)) return candidate;
  }
  return null;
}

/** How the app starts an engine. Null when the CLI isn't installed. Never adds credentials. */
export async function engineCommand(
  engine: EngineDef,
  d: CommandDeps,
): Promise<{ command: string[]; env: Record<string, string> } | null> {
  const PATH = await loginShellPath(d);
  if (engine.transport.kind === "claude-cli") {
    const binary = await resolveBinary(engine.transport.binary, PATH, d);
    return binary ? { command: [binary], env: { PATH } } : null;
  }
  const pkg = engine.transport.command.find((part) => part.replace(/@[^@/]+$/, "") in BUNDLED_ADAPTERS);
  if (pkg) {
    const entry = d.resolveModule(BUNDLED_ADAPTERS[pkg.replace(/@[^@/]+$/, "")]);
    return { command: [d.electronPath, entry], env: { PATH, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const [binaryName, ...args] = engine.transport.command;
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
