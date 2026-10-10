import path from "node:path";
import type { EngineDef } from "@humanharness/engines";

export interface CommandDeps {
  shell: string;
  home: string;
  run: (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>;
  isExecutable: (file: string) => Promise<boolean>;
  electronPath: string;
  resolveModule: (id: string) => string;
}

/** Bundled ACP adapters, by the npm package the engine's command names. */
const BUNDLED_ADAPTERS: Record<string, string> = {
  "@agentclientprotocol/codex-acp": "@agentclientprotocol/codex-acp/dist/index.js",
};

export async function loginShellPath(d: CommandDeps): Promise<string> {
  try {
    const { stdout, code } = await d.run(d.shell, ["-ilc", 'printf "%s" "$PATH"']);
    if (code === 0 && stdout.trim()) return stdout.trim().split("\n").pop()!;
  } catch {
    // fall through
  }
  return [path.join(d.home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
}

export async function resolveBinary(name: string, searchPath: string, d: CommandDeps): Promise<string | null> {
  for (const dir of searchPath.split(":").filter(Boolean)) {
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
