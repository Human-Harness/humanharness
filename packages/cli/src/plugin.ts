import path from "node:path";
import { type Io, UsageError, parseCommand } from "./cli";
import { buildPlugin } from "./plugin-build";
import { checkPlugin, formatPluginFindings } from "./plugin-check";
import { P12_NOTE, formatTestReports, testPlugin } from "./plugin-test";

type Command = (args: string[], io: Io) => Promise<number>;

export const PLUGIN_USAGE = [
  "Usage: humanharness plugin <command>",
  "",
  "Commands:",
  "  build [--plugin <dir>] [--out <dir>]     Build the plugin into dist/: plugin.json, backend.js and the panels",
  "  check [--json] [--harness <dir>] [--no-build]",
  "                                           Build, then check the plugin, its sources, fixtures and PLUGIN.md",
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

export const CHECK_USAGE = [
  "Usage: humanharness plugin check [--plugin <dir>] [--json] [--harness <dir>] [--no-build]",
  "",
  "Builds the plugin, then checks dist/plugin.json, the sources, the fixtures and PLUGIN.md. Errors exit with 1.",
  "--harness <dir> also checks that the slots the panels and chips name exist in that harness.",
  "",
].join("\n");

export const TEST_USAGE = [
  "Usage: humanharness plugin test [--plugin <dir>] [--source <id>] [--now <iso>] [--json]",
  "",
  "Runs every source of the built plugin (dist/) once on its fixtures, with no network and no keys, and prints the",
  "records written, the attention items, the chips and the log. --now fixes the backend's clock. A failed source exits with 1.",
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

async function checkCommand(args: string[], io: Io): Promise<number> {
  if (wantsHelp(args)) {
    io.stdout.write(CHECK_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, {
    plugin: { type: "string" },
    json: { type: "boolean" },
    harness: { type: "string" },
    "no-build": { type: "boolean" },
  });
  if (positionals.length > 0) throw new UsageError(CHECK_USAGE.trim());
  const { findings } = await checkPlugin(path.resolve(io.cwd, values.plugin ?? "."), {
    build: !values["no-build"],
    ...(values.harness ? { harness: path.resolve(io.cwd, values.harness) } : {}),
  });
  io.stdout.write(values.json ? `${JSON.stringify({ findings }, null, 2)}\n` : formatPluginFindings(findings));
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

async function testCommand(args: string[], io: Io): Promise<number> {
  if (wantsHelp(args)) {
    io.stdout.write(TEST_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, {
    plugin: { type: "string" },
    source: { type: "string" },
    now: { type: "string" },
    json: { type: "boolean" },
  });
  if (positionals.length > 0) throw new UsageError(TEST_USAGE.trim());
  const now = values.now === undefined ? undefined : new Date(values.now);
  if (now && Number.isNaN(now.getTime())) throw new UsageError(`--now: "${values.now}" is not a date (use an ISO date, e.g. 2026-10-28T09:00:00Z).`);
  // P12: said before any plugin code runs; on stderr with --json, so stdout stays one JSON document.
  (values.json ? io.stderr : io.stdout).write(`${P12_NOTE}\n`);
  const reports = await testPlugin(path.resolve(io.cwd, values.plugin ?? "."), {
    ...(values.source !== undefined ? { source: values.source } : {}),
    ...(now ? { now } : {}),
  });
  io.stdout.write(values.json ? `${JSON.stringify({ reports }, null, 2)}\n` : formatTestReports(reports));
  return reports.every((r) => r.ok) ? 0 : 1;
}

/** The plugin commands, by name. Later tasks add theirs (init, check, record, test, dev). */
const PLUGIN_COMMANDS: Record<string, Command> = {
  build: buildCommand,
  check: checkCommand,
  test: testCommand,
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
