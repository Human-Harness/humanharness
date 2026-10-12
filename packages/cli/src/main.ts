import { CliError, type Io, UsageError } from "./cli";
import { checkCommand } from "./check";
import { initCommand } from "./init";
import { runCommand } from "./run";

type Command = (args: string[], io: Io) => Promise<number>;

export const USAGE = [
  "Usage: humanharness <command>",
  "",
  "Commands:",
  "  init <dir> [--core <path>] [--id <id>]   Create a harness repo from the template and install the guide",
  "  check [--json]                           Validate the harness in the current folder",
  "  run <action> [--engine claude|codex] [--tier light|standard|deep] [--folder <dir>] [--language es|en]",
  "                                           Run one task against a real engine in the terminal",
  "  dev [--engine <id>]                      Check the harness, then open the app with it",
  "",
  "check, run and dev take --harness <dir> to work on another folder than the current one.",
  "",
].join("\n");

/** The commands, by name. Each later task adds its own. */
const COMMANDS: Record<string, Command> = {
  init: initCommand,
  check: checkCommand,
  run: runCommand,
};

export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    io.stdout.write(USAGE);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    io.stderr.write(`Unknown command: ${name}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await command(args, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof CliError) {
      io.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
