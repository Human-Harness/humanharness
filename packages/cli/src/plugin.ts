import path from "node:path";
import { type Io, UsageError, parseCommand } from "./cli";
import { buildPlugin } from "./plugin-build";

type Command = (args: string[], io: Io) => Promise<number>;

export const PLUGIN_USAGE = [
  "Usage: humanharness plugin <command>",
  "",
  "Commands:",
  "  build [--plugin <dir>] [--out <dir>]     Build the plugin into dist/: plugin.json, backend.js and the panels",
  "",
  "Each command works on the plugin in the current folder unless --plugin <dir> names another.",
  "",
].join("\n");

export const BUILD_USAGE = [
  "Usage: humanharness plugin build [--plugin <dir>] [--out <dir>]",
  "",
  "Builds plugin.config.ts, backend.ts and panels/<id>.tsx into dist/ (or --out), replacing it.",
  "",
].join("\n");

const wantsHelp = (args: string[]) => args.includes("--help") || args.includes("-h");

async function buildCommand(args: string[], io: Io): Promise<number> {
  if (wantsHelp(args)) {
    io.stdout.write(BUILD_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, { plugin: { type: "string" }, out: { type: "string" } });
  if (positionals.length > 0) throw new UsageError(BUILD_USAGE.trim());
  const dir = path.resolve(io.cwd, values.plugin ?? ".");
  const r = await buildPlugin(dir, values.out ? { out: path.resolve(io.cwd, values.out) } : {});
  const rel = path.relative(io.cwd, r.dist);
  io.stdout.write(`Built ${r.manifest.id} into ${rel.startsWith("..") || path.isAbsolute(rel) ? r.dist : rel || "."}: ${r.files.join(", ")}\n`);
  return 0;
}

/** The plugin commands, by name. Later tasks add theirs (init, check, record, test, dev). */
const PLUGIN_COMMANDS: Record<string, Command> = {
  build: buildCommand,
};

/** `humanharness plugin <command>` (plugins spec §9): the authoring tools. */
export async function pluginCommand(args: string[], io: Io): Promise<number> {
  const [name, ...rest] = args;
  if (name === "help" || name === "--help" || name === "-h") {
    io.stdout.write(PLUGIN_USAGE);
    return 0;
  }
  if (name === undefined) {
    io.stderr.write(PLUGIN_USAGE);
    return 2;
  }
  const command = Object.hasOwn(PLUGIN_COMMANDS, name) ? PLUGIN_COMMANDS[name] : undefined;
  if (!command) {
    io.stderr.write(`Unknown plugin command: ${name}\n\n${PLUGIN_USAGE}`);
    return 2;
  }
  return command(rest, io);
}
