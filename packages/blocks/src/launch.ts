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

/** Runs Electron's embedded Node (packaged and dev app). */
export function electronLauncher(electronPath: string): Launcher {
  return { command: electronPath, args: [], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export function uiServerSpec(opts: {
  harnessConfig: string;
  bridge: { path: string; token: string };
  /** The review tools' channel (review spec §4). Absent: no review tools (D0). */
  review?: { path: string; token: string };
  launcher: Launcher;
  /** Built entry for the ui server (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = opts.entry ?? fileURLToPath(new URL("./ui-server-bin.ts", import.meta.url));
  return {
    name: "ui",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: {
      ...opts.launcher.env,
      HH_HARNESS: opts.harnessConfig,
      HH_BRIDGE: opts.bridge.path,
      HH_BRIDGE_TOKEN: opts.bridge.token,
      ...(opts.review ? { HH_REVIEW_RPC: opts.review.path, HH_REVIEW_RPC_TOKEN: opts.review.token } : {}),
    },
  };
}

/** The `data` MCP server (spec §4.4): its tools ask the app over `rpc`. */
export function dataServerSpec(opts: {
  harnessConfig: string;
  rpc: { path: string; token: string };
  launcher: Launcher;
  /** Built entry for the data server (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = opts.entry ?? fileURLToPath(new URL("./data-server-bin.ts", import.meta.url));
  return {
    name: "data",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_HARNESS: opts.harnessConfig, HH_RPC: opts.rpc.path, HH_RPC_TOKEN: opts.rpc.token },
  };
}
