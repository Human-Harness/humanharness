import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "@humanharness/harness-sdk/tool";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CliError, type Io, UsageError, parseCommand } from "../cli";
import { appShot, appStatus, catalog, checkMod, cloneLayout, cloneMod, newMod } from "../kit";
import { CLIENTS, type Client, configSnippet } from "./config-snippet";
import { type Mode, findMode } from "./mode";
import { TOOL_NAMES, type ToolName } from "./tool-names";

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

export { TOOL_NAMES, type ToolName } from "./tool-names";

const NOT_RUNNING = "The app isn't running";
const TURNING_ON = "A new mod or clone starts off: turning it on is the person's step in Settings › Mods, never yours; say what it does and let them decide.";

/** A tool's answer: its data as JSON text, or the kit's message as an error the agent reads. */
async function answer(run: () => Promise<CallToolResult | unknown>, raw = false): Promise<CallToolResult> {
  try {
    const r = await run();
    return raw ? (r as CallToolResult) : { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  } catch (err) {
    let text = err instanceof Error ? err.message : String(err);
    if (text === NOT_RUNNING) text = `${NOT_RUNNING}: open it and try again`;
    return { isError: true, content: [{ type: "text", text }] };
  }
}

/** The saved screenshot as an image the agent sees, and its path. */
async function shot(home: string, file?: string): Promise<CallToolResult> {
  const r = await appShot(home, file);
  const saved = path.resolve(home, r.path);
  const data = await fs.readFile(saved).catch(() => {
    throw new CliError(`The app said it saved ${saved}, but it can't be read`);
  });
  return { content: [{ type: "image", mimeType: "image/png", data: data.toString("base64") }, { type: "text", text: saved }] };
}

interface Tool {
  description: string;
  inputSchema?: ZodRawShape;
  readOnly?: boolean;
  run(args: Record<string, unknown>): Promise<CallToolResult>;
}
type ZodRawShape = Record<string, z.ZodType>;

/** Each tool: what it does and when to use it, written for the agent that reads the list. */
function tools(home: string): Record<ToolName, Tool> {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    status: {
      description:
        "What the running app shows now: each mod on, off or failed (and why), the mods it couldn't read, and the layout on screen with its problems. Use it after a change to see whether the app took it. Needs the app open.",
      readOnly: true,
      run: () => answer(() => appStatus(home)),
    },
    catalog: {
      description:
        "What the app is made of, read from its home folder without the app: every mod of the three layers (core, harness, yours in mods/) with its blocks, hooks, settings, state and any .error, the layouts and which one shows, and the names hh.d.ts types. Start here before you make or change anything.",
      readOnly: true,
      run: () => answer(() => catalog(home)),
    },
    mod_new: {
      description: `Makes a new mod in mods/<id>/ from the template: mod.json, a main.ts, a ui.tsx with one block and a README listing the imports a mod may use. Use it for something new; to change a core or harness mod, use mod_clone. Run mod_check after each edit. ${TURNING_ON}`,
      inputSchema: {
        id: z.string().describe("The mod's id: lowercase letters, digits and -, starting with a letter, at most 40; not a core or harness mod's"),
        name: z.string().describe("The name the person sees in Settings › Mods, at most 60 characters"),
        description: z.string().describe("One or two sentences on what the mod does, for its README"),
        block: z.string().optional().describe("The name of its block, which a layout places as { mod, block }; default main"),
      },
      run: (a) => answer(() => newMod(home, { id: str(a.id) ?? "", name: str(a.name) ?? "", description: str(a.description) ?? "", ...(str(a.block) ? { block: str(a.block) } : {}) })),
    },
    mod_check: {
      description:
        "Checks a mod without the app: its mod.json, the bundle of each part, main run against a fake ctx, and each block rendered once. Each check comes back with ok and why. Run it after every change to a mod, before you ask the person to look.",
      inputSchema: { folder: z.string().describe("The mod's folder, relative to the home folder (mods/<id>) or absolute") },
      readOnly: true,
      run: (a) => answer(() => checkMod(home, str(a.folder) ?? "")),
    },
    mod_clone: {
      description: `Copies a core or harness mod into mods/<as>/ with its sources, the new id and clonedFrom, so you can change it (core/ and harness/ are read-only). The clone is never updated from the original. ${TURNING_ON} The person also turns the original off.`,
      inputSchema: {
        id: z.string().describe("The id of the core or harness mod to copy (see catalog)"),
        as: z.string().optional().describe("The clone's id; default the same id"),
      },
      run: (a) => answer(() => cloneMod(home, str(a.id) ?? "", str(a.as) ?? str(a.id) ?? "")),
    },
    layout_clone: {
      description:
        "Copies the harness's layout (else the core's) into layouts/<as>.json, so you can change how the screen is arranged. The screen shows it once settings.json picks it ({ \"layout\": \"<as>\" }): ask the person before you change their pick.",
      inputSchema: {
        name: z.string().describe("The layout to copy, such as main (see catalog)"),
        as: z.string().optional().describe("The copy's name: letters, digits, - and _; default the same name"),
      },
      run: (a) => answer(() => cloneLayout(home, str(a.name) ?? "", str(a.as) ?? str(a.name) ?? "")),
    },
    shot: {
      description:
        "A screenshot of the running app's window, as an image you can see, and the path of the PNG it saved. Use it to check what a change looks like. Needs the app open.",
      inputSchema: { file: z.string().optional().describe("Where to save the PNG, relative to the home folder; default the app's shots/ folder") },
      readOnly: true,
      run: (a) => answer(() => shot(home, str(a.file)), true),
    },
  };
}

/** The `humanharness` MCP server over the app's home folder, with the kit's tools. */
export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: "humanharness", version: VERSION });
  const all = tools(mode.home);
  for (const name of TOOL_NAMES) {
    const t = all[name];
    server.registerTool(
      name,
      { description: t.description, inputSchema: t.inputSchema ?? {}, ...(t.readOnly ? { annotations: { readOnlyHint: true } } : {}) },
      (args: Record<string, unknown>) => t.run(args),
    );
  }
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
