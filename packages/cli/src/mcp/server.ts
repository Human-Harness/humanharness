import { promises as fs, readFileSync } from "node:fs";
import { z } from "@humanharness/harness-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Io, UsageError, parseCommand } from "../cli";
import { appShot, appStatus, catalog, checkMod, cloneLayout, cloneMod, newMod } from "../kit";
import { CLIENTS, type Client, configSnippet } from "./config-snippet";
import { type Mode, findMode } from "./mode";

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const NOT_RUNNING = "The app isn't running";
const ON_IS_THE_PERSONS = "A new or cloned mod starts off: turning it on is the person's step in Settings › Mods (the app asks them to review it). Never write config.json to turn one on.";

/** The kit's message for the agent: "not running" says what to do about it. */
const messageOf = (err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  return m === NOT_RUNNING ? `${NOT_RUNNING}: open it and try again` : m;
};

/** A tool's answer: its data as JSON text, or the kit's message as an error the agent reads. */
async function answer(run: () => Promise<unknown>, failed?: (data: unknown) => boolean): Promise<CallToolResult> {
  try {
    const data = await run();
    return { ...(failed?.(data) ? { isError: true } : {}), content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: messageOf(err) }] };
  }
}

/** The running app's screenshot as an image the agent sees, and where it was saved. */
async function shot(home: string, file: string | undefined): Promise<CallToolResult> {
  try {
    const saved = await appShot(home, file);
    const data = (await fs.readFile(saved.path)).toString("base64");
    return { content: [{ type: "image", mimeType: "image/png", data }, { type: "text", text: saved.path }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: messageOf(err) }] };
  }
}

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** The `humanharness` MCP server over the app's home folder, with the kit's tools. */
export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: "humanharness", version: VERSION });
  const { home } = mode;

  server.registerTool(
    "catalog",
    {
      description:
        "What this app is made of, read from its home folder: every mod of the three layers (core, harness, user) with its blocks, hooks, settings, on/off state and the reason it failed (its .error), every layout with the one the screen shows, and the names hh.d.ts exports with a one-line doc. Call it first, before making or changing a mod, to find a block to place, a mod to clone or the type to read in hh.d.ts. Reads only; the app need not run.",
      inputSchema: {},
      annotations: RO,
    },
    () => answer(() => catalog(home)),
  );

  server.registerTool(
    "mod_new",
    {
      description: `Creates a new mod in the person's layer, mods/<id>/, from the template: mod.json, main.ts (runs in the app), ui.tsx (one block built with the app's pieces) and a README listing the imports a mod may use. Use it to add something the app hasn't got; to change a core or harness mod use mod_clone instead. Then edit the files, run mod_check, place the block in a layout and look with shot. ${ON_IS_THE_PERSONS}`,
      inputSchema: {
        id: z.string().describe("The mod's id: lowercase letters, digits and -, starting with a letter, at most 40. Unique in the app."),
        name: z.string().describe("The name the person sees in Settings › Mods, at most 60 characters."),
        description: z.string().describe("One or two sentences on what the mod does; goes in its README."),
        block: z.string().optional().describe("The name of the block ui.tsx registers (default main)."),
      },
      annotations: WRITES,
    },
    (a) => answer(() => newMod(home, a)),
  );

  server.registerTool(
    "mod_check",
    {
      description:
        "Checks a mod without the app: mod.json, the bundle of each part (only allowed imports), main run against a fake ctx, each block rendered once. Run it after every change to a mod, before telling the person it is ready. Answers each check with ok and detail; any failed check makes it an error. The running app also writes <file>.error beside a file it refused.",
      inputSchema: { folder: z.string().describe("The mod's folder, relative to the home folder (mods/<id>) or absolute.") },
      annotations: RO,
    },
    ({ folder }) => answer(() => checkMod(home, folder), (r) => !(r as { ok: boolean }).ok),
  );

  server.registerTool(
    "mod_clone",
    {
      description: `Copies a core or harness mod (core/mods/<id>, harness/mods/<id>: read-only) into the person's layer as mods/<as>, with its source files, the new id and clonedFrom. Use it to change what a shipped mod does: edit the clone, never the original. Refuses an existing target. ${ON_IS_THE_PERSONS} The person also turns the original off there.`,
      inputSchema: {
        id: z.string().describe("The id of the core or harness mod to copy."),
        as: z.string().optional().describe("The clone's id (default: the same id)."),
      },
      annotations: WRITES,
    },
    ({ id, as }) => answer(() => cloneMod(home, id, as)),
  );

  server.registerTool(
    "layout_clone",
    {
      description:
        "Copies a harness or core layout (harness/layouts/<name>.json, else core/layouts/<name>.json: read-only) to layouts/<as>.json in the person's layer, to edit where blocks go. Refuses an existing file. The screen shows it once settings.json picks it ({ \"layout\": \"<as>\" }) or the person picks it in the app.",
      inputSchema: {
        name: z.string().describe("The layout to copy, e.g. main."),
        as: z.string().optional().describe("The copy's name (default: the same name): letters, digits, - and _."),
      },
      annotations: WRITES,
    },
    ({ name, as }) => answer(() => cloneLayout(home, name, as)),
  );

  server.registerTool(
    "status",
    {
      description:
        "Asks the running app which mods run, which failed and why, the mods it couldn't read, and the layout it shows with the problems of the layouts it passed over. Use it after a change to see that the app took it. Needs the app open.",
      inputSchema: {},
      annotations: RO,
    },
    () => answer(() => appStatus(home)),
  );

  server.registerTool(
    "shot",
    {
      description:
        "The running app saves its window as a PNG; you get the image and the file's path. Use it after a change to the screen (a block, a layout) to see what the person sees. Needs the app open.",
      inputSchema: { file: z.string().optional().describe("Where to save it, relative to the home folder (default shots/<time>.png).") },
      annotations: { ...RO, readOnlyHint: false, destructiveHint: false },
    },
    ({ file }) => shot(home, file),
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
