import path from "node:path";
import { fileURLToPath } from "node:url";

/** The `humanharness` bin, as an absolute path: what an agent's MCP config runs with node. */
export const BIN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/humanharness.js");

export const CLIENTS = ["claude", "codex"] as const;
export type Client = (typeof CLIENTS)[number];

/**
 * What to paste to connect an agent: the `claude mcp add` command, or Codex's `[mcp_servers.humanharness]` TOML
 * block. Both run this node with the bin's absolute path; `home` (absolute) is passed on as `--home`.
 */
export function configSnippet(client: Client, home?: string): string {
  const args = [BIN_PATH, "mcp", ...(home !== undefined ? ["--home", home] : [])];
  if (client === "claude") return `claude mcp add humanharness -- ${[process.execPath, ...args].join(" ")}\n`;
  return `[mcp_servers.humanharness]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${args.map((a) => JSON.stringify(a)).join(", ")}]\n`;
}
