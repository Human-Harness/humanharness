import { fileURLToPath } from "node:url";

/** How to start a Node process that runs TypeScript (tsx in development; Electron's Node in plan 2). */
export interface Launcher {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** An MCP server the agent should start, in a transport-neutral shape. */
export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function devLauncher(): Launcher {
  return { command: process.execPath, args: ["--import", import.meta.resolve("tsx")], env: {} };
}

export function uiServerSpec(opts: { harnessConfig: string; bridge: { path: string; token: string }; launcher: Launcher }): McpServerSpec {
  const entry = fileURLToPath(new URL("./ui-server-bin.ts", import.meta.url));
  return {
    name: "ui",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_HARNESS: opts.harnessConfig, HH_BRIDGE: opts.bridge.path, HH_BRIDGE_TOKEN: opts.bridge.token },
  };
}
