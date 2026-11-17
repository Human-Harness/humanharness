import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "@humanharness/harness-sdk/tool";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CliError, type Io, UsageError, parseCommand } from "../cli";
import { appShot, appStatus, catalog, checkMod, cloneLayout, cloneMod, harnessCatalog, newMod } from "../kit";
import { CLIENTS, type Client, configSnippet } from "./config-snippet";
import { harnessCheck, harnessInit } from "./harness-tools";
import { type Mode, findMode } from "./mode";
import { APP_TOOLS, HARNESS_TOOLS } from "./tool-names";

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

export { APP_TOOLS, HARNESS_TOOLS, TOOL_NAMES, type ToolName } from "./tool-names";

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
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Each tool of app mode: what it does and when to use it, written for the agent that reads the list. */
function appTools(home: string): Record<(typeof APP_TOOLS)[number], Tool> {

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

/** In harness mode no tool writes harness.config.ts: declaring a mod is the agent's edit. */
const DECLARE =
  "It is off until the manifest declares it: add `<id>: {}` to harness.config.ts → mods yourself (no tool writes the manifest), place its blocks in layouts/main.json, then run harness_check.";

/** Each tool of harness mode: the kit over a harness project and the core it is built on. */
function harnessTools(dir: string, core: string): Record<(typeof HARNESS_TOOLS)[number], Tool> {
  const root = { harness: dir, core };
  return {
    catalog: {
      description:
        "What this harness can be composed of, read from the files: the core's mods (blocks, hooks, settings, README summary) and its default layout, the project's own mods/ and layouts/, and which mods harness.config.ts → mods declares. Start here, before you write any code: reuse or clone a core mod before you make a new one. Without a project it says so, and harness_init makes one.",
      readOnly: true,
      run: () => answer(() => harnessCatalog(dir, core)),
    },
    mod_new: {
      description: `Makes a new mod in the project's mods/<id>/ from the template: mod.json, a main.ts, a ui.tsx with one block and a README listing the imports a mod may use. Use it only for what no core mod does; to change a core mod, use mod_clone. Run mod_check after each edit. ${DECLARE}`,
      inputSchema: {
        id: z.string().describe("The mod's id: lowercase letters, digits and -, starting with a letter, at most 40; not a core mod's"),
        name: z.string().describe("The name the person sees in Settings › Mods, at most 60 characters"),
        description: z.string().describe("One or two sentences on what the mod does, for its README"),
        block: z.string().optional().describe("The name of its block, which a layout places as { mod, block }; default main"),
      },
      run: (a) => answer(() => newMod(root, { id: str(a.id) ?? "", name: str(a.name) ?? "", description: str(a.description) ?? "", ...(str(a.block) ? { block: str(a.block) } : {}) })),
    },
    mod_check: {
      description:
        "Checks a mod of the project without the app: its mod.json, the bundle of each part, main run against a fake ctx, and each block rendered once. Each check comes back with ok and why. Run it after every change to a mod; harness_check runs it on every mods/<id> too.",
      inputSchema: { folder: z.string().describe("The mod's folder, relative to the project (mods/<id>) or absolute") },
      readOnly: true,
      run: (a) => answer(() => checkMod(root, str(a.folder) ?? "")),
    },
    mod_clone: {
      description: `Copies a core mod into the project's mods/<as>/ with its sources, the new id and clonedFrom, so you can change it. The clone is never updated from the original. ${DECLARE} Declare the clone instead of the original, and record in HARNESS.md's Decision log why you cloned it and what you changed.`,
      inputSchema: {
        id: z.string().describe("The id of the core mod to copy (see catalog)"),
        as: z.string().optional().describe("The clone's id; default the same id"),
      },
      run: (a) => answer(() => cloneMod(root, str(a.id) ?? "", str(a.as) ?? str(a.id) ?? "")),
    },
    layout_clone: {
      description:
        "Copies the core's default layout (main) into the project's layouts/<as>.json, so you can arrange the harness's screen from it. layouts/main.json is the one the harness ships; harness_check validates every layout.",
      inputSchema: {
        name: z.string().describe("The core layout to copy: main (see catalog)"),
        as: z.string().optional().describe("The copy's name: letters, digits, - and _; default the same name"),
      },
      run: (a) => answer(() => cloneLayout(root, str(a.name) ?? "", str(a.as) ?? str(a.name) ?? "")),
    },
    harness_init: {
      description:
        "Makes a harness project in this server's folder, which must be empty or new: the manifest, HARNESS.md, a sample mod (mods/example), layouts/main.json, the agent's instructions and the /new-harness guide. It answers the files it made and the next step. It skips `pnpm install` and `git init` unless asked: say what is left to run.",
      inputSchema: {
        id: z.string().optional().describe("The harness's id: lowercase letters, digits and dashes; default from the folder's name"),
        skipInstall: z.boolean().optional().describe("false runs `corepack pnpm install` and `git init` too; default true"),
      },
      run: (a) => answer(() => harnessInit(dir, core, { ...(str(a.id) ? { id: str(a.id) } : {}), install: a.skipInstall === false })),
    },
    harness_check: {
      description:
        "Checks the whole harness as `humanharness check` does, as data: errors and warnings, each with its rule, file and message (every mods/<id> is mod-checked, every layout validated, every declared mod must exist). Run it after each change; the work is done when errors is empty.",
      readOnly: true,
      run: () => answer(() => harnessCheck(dir)),
    },
  };
}

/** The `humanharness` MCP server over the app's home folder or a harness project, with the mode's tools. */
export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: "humanharness", version: VERSION });
  const set: [string, Tool][] =
    mode.mode === "app"
      ? APP_TOOLS.map((n) => [n, appTools(mode.home)[n]])
      : HARNESS_TOOLS.map((n) => [n, harnessTools(mode.dir, mode.core)[n]]);
  for (const [name, t] of set) {
    server.registerTool(
      name,
      { description: t.description, inputSchema: t.inputSchema ?? {}, ...(t.readOnly ? { annotations: { readOnlyHint: true } } : {}) },
      (args: Record<string, unknown>) => t.run(args),
    );
  }
  return server;
}

const MCP_USAGE = "Usage: humanharness mcp [--home <dir> | --harness <dir>] [--config claude|codex]";

/**
 * `humanharness mcp`: serves the kit to an agent over stdio until stdin ends. `--config <client>` prints what to
 * paste into that agent's MCP config instead.
 */
export async function mcpCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { home: { type: "string" }, harness: { type: "string" }, config: { type: "string" } });
  if (positionals.length > 0) throw new UsageError(MCP_USAGE);
  if (values.config !== undefined) {
    if (!(CLIENTS as readonly string[]).includes(values.config)) throw new UsageError(`--config takes ${CLIENTS.join(" or ")}\n${MCP_USAGE}`);
    const client = values.config as Client;
    if (values.home === undefined && values.harness === undefined) io.stdout.write(configSnippet(client));
    else {
      const mode = findMode(io.cwd, values);
      io.stdout.write(mode.mode === "app" ? configSnippet(client, mode.home) : configSnippet(client, mode.dir, "harness"));
    }
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
