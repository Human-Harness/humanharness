import type { EngineDef } from "@humanharness/engines";

/**
 * The engine's official install command, for the user to copy and run themselves. Only this text is
 * ever copied: the window names the engine, never the text.
 */
export function installCommandOf(engine: EngineDef): string {
  const command = engine.setup?.install?.command;
  if (!command) throw new Error(`${engine.id} has no install command`);
  return command;
}

/**
 * How to open Terminal so the user can paste the install command: the app only opens it and runs
 * nothing in it. Null where there is no Terminal app to open (only macOS is supported).
 */
export function terminalCommand(platform: NodeJS.Platform): { command: string; args: string[] } | null {
  return platform === "darwin" ? { command: "/usr/bin/open", args: ["-a", "Terminal"] } : null;
}
