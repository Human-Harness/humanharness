import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Io, UsageError, parseCommand } from "../cli";
import { appStatus } from "../kit";
import { CLIENTS, type Client, configSnippet } from "./config-snippet";
import { type Mode, findMode } from "./mode";

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A tool's answer: its data as JSON text, or the kit's message as an error the agent reads. */
async function answer(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
}

/** The `humanharness` MCP server over the app's home folder, with the kit's tools. */
export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: "humanharness", version: VERSION });
  server.registerTool(
    "status",
    {
      description: "The running app's mods (on, off, failed and why), the mods it couldn't read, and the layout it shows.",
      annotations: { readOnlyHint: true },
    },
    () => answer(() => appStatus(mode.home)),
  );
  return server;
}

const MCP_USAGE = "Usage: humanharness mcp [--home <dir>] [--config claude|codex]";

/**
 * `humanharness mcp`: serves the kit to an agent over stdio until stdin ends. `--config <client>` prints what to
 * paste into that agent's MCP config instead.
 */
export async function mcpCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { home: { type: "string" }, harness: { type: "string" }, config: { type: "string" } });
  if (positionals.length > 0) throw new UsageError(MCP_USAGE);
  if (values.config !== undefined) {
    if (!(CLIENTS as readonly string[]).includes(values.config)) throw new UsageError(`--config takes ${CLIENTS.join(" or ")}\n${MCP_USAGE}`);
    const home = values.home !== undefined ? findMode(io.cwd, { home: values.home }).home : undefined;
    io.stdout.write(configSnippet(values.config as Client, home));
    return 0;
  }
  const server = createServer(findMode(io.cwd, values));
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  io.stdin.once("end", () => void server.close());
  await server.connect(new StdioServerTransport(io.stdin, io.stdout));
  await closed;
  return 0;
}
