import path from "node:path";
import { type Io, UsageError, parseCommand } from "./cli";
import { liveToolRunDeps, toolRunCommand } from "./tool-run";
import { formatToolReports, testTools } from "./tool-test";

// Not tool.ts: that file is the tool authors' `@humanharness/cli/tool`, bundled into the sandbox.

type Command = (args: string[], io: Io) => Promise<number>;

export const TOOL_USAGE = [
  "Usage: humanharness tool <command>",
  "",
  "Commands:",
  "  test [<id>] [--harness <dir>]            Run each tool (or <id>) on its fixtures, tools/<id>/fixtures/*.json",
  "  run <id> [--args '<json>'] [--folder <dir>] [--scope <id>] [--yes] [--harness <dir>]",
  "                                           Run <id> once, for real, and print its result and trace",
  "",
  "Each command works on the harness in the current folder unless --harness <dir> names another.",
  "",
].join("\n");

export const TOOL_TEST_USAGE = [
  "Usage: humanharness tool test [<id>] [--harness <dir>]",
  "",
  "Builds the harness's tools in memory, then runs every fixture of each tool (or of <id>) through the app's registry,",
  "with no network and no keys: fetch and commands answer only from the fixture's exchanges, keys are fixture-<id>,",
  "data is kept in memory and files go to a temp folder removed after. A failed fixture exits with 1.",
  "",
].join("\n");

const wantsHelp = (args: string[]) => args.includes("--help") || args.includes("-h");

async function testCommand(args: string[], io: Io): Promise<number> {
  if (wantsHelp(args)) {
    io.stdout.write(TOOL_TEST_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, { harness: { type: "string" } });
  if (positionals.length > 1) throw new UsageError(TOOL_TEST_USAGE.trim());
  // The P12 note is printed by testTools, once it knows the harness has tools and before the build runs tool code.
  const reports = await testTools(path.resolve(io.cwd, values.harness ?? "."), {
    ...(positionals[0] !== undefined ? { tool: positionals[0] } : {}),
    out: io.stdout,
  });
  io.stdout.write(formatToolReports(reports));
  return reports.every((r) => r.cases.every((c) => c.ok)) ? 0 : 1;
}

/** The tool commands, by name. */
const TOOL_COMMANDS: Record<string, Command> = {
  test: testCommand,
  run: (args, io) => toolRunCommand(args, io, liveToolRunDeps(io.stdin, io.stdout)),
};

/** `humanharness tool <command>` (tools spec §11): try a harness's tools in the terminal. */
export async function toolCommand(args: string[], io: Io): Promise<number> {
  const [name, ...rest] = args;
  if (name === "help" || name === "--help" || name === "-h") {
    io.stdout.write(TOOL_USAGE);
    return 0;
  }
  if (name === undefined) {
    io.stderr.write(TOOL_USAGE);
    return 2;
  }
  const command = Object.hasOwn(TOOL_COMMANDS, name) ? TOOL_COMMANDS[name] : undefined;
  if (!command) {
    io.stderr.write(`Unknown tool command: ${name}\n\n${TOOL_USAGE}`);
    return 2;
  }
  return command(rest, io);
}
