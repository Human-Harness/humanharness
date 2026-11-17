import path from "node:path";
import { fileURLToPath } from "node:url";

/** The `humanharness` bin, as an absolute path: what an agent's MCP config runs with node. */
export const BIN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/humanharness.js");

export const CLIENTS = ["claude", "codex"] as const;
export type Client = (typeof CLIENTS)[number];

/** One shell word: as is when it is plain, else single-quoted (a home under `Application Support` has a space). */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_\-./=:@%+,]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * What to paste to connect an agent: the `claude mcp add` command, or Codex's `[mcp_servers.humanharness]` TOML
 * block. Both run this node with the bin's absolute path; `dir` (absolute) is passed on as `--home` (the app's home
 * folder) or `--harness` (a harness project).
 */
export function configSnippet(client: Client, dir?: string, flag: "home" | "harness" = "home"): string {
  const args = [BIN_PATH, "mcp", ...(dir !== undefined ? [`--${flag}`, dir] : [])];
  if (client === "claude") return `claude mcp add humanharness -- ${[process.execPath, ...args].map(shellQuote).join(" ")}\n`;
  return `[mcp_servers.humanharness]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${args.map((a) => JSON.stringify(a)).join(", ")}]\n`;
}
