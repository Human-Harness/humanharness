import { shotCommand, statusCommand } from "./app-commands";
import { buildCommand } from "./build";
import { CliError, type Io, UsageError } from "./cli";
import { checkCommand } from "./check";
import { devCommandLine } from "./dev";
import { initCommand } from "./init";
import { measureCommand } from "./measure";
import { layoutCommand, modCommand } from "./mod-command";
import { pluginCommand } from "./plugin";
import { runCommand } from "./run";
import { toolCommand } from "./tool-command";

type Command = (args: string[], io: Io) => Promise<number>;

export const USAGE = [
  "Usage: humanharness <command>",
  "",
  "Commands:",
  "  init <dir> [--core <path>] [--id <id>] [--skip-install]",
  "                                           Create a harness repo from the template and install the guide",
  "  check [--json]                           Validate the harness in the current folder",
  "  run <action> [--engine claude|codex|opencode] [--tier light|standard|deep] [--folder <dir>] [--language <tag>] [--record [--force]]",
  "                                           Run one task against a real engine in the terminal",
  "  dev [--engine <id>] [--mock [--keep]] [--build <dir>]",
  "                                           Check the harness, then open the app with it (--mock: replay mock/, no AI)",
  "  build [--harness <dir>]                  Bundle the harness's tools into dist/ (tools.json)",
  "  measure [--folder <dir>]                 Print first-turn tokens with and without pre-steps, per action",
  "  plugin <command>                         Build, check and try a plugin (humanharness plugin --help)",
  "  tool <command>                           Test and run the harness's tools (humanharness tool --help)",
  "  mod check <folder>                       Check a mod of the app's home folder without the app",
  "  mod clone <id> [as]                      Copy a core or harness mod into the home folder's mods/",
  "  layout clone <name> [as]                 Copy a harness or core layout into the home folder's layouts/",
  "  status                                   Print the running app's mods, their problems and its layout",
  "  shot [file.png]                          Save the running app's window as a PNG and print the path",
  "",
  "check, run and dev take --harness <dir> to work on another folder than the current one.",
  "mod clone, layout clone, status and shot take --home <dir> outside the app's home folder.",
  "",
].join("\n");

/** The commands, by name. Each later task adds its own. */
const COMMANDS: Record<string, Command> = {
  init: initCommand,
  check: checkCommand,
  run: runCommand,
  dev: devCommandLine,
  plugin: pluginCommand,
  build: buildCommand,
  measure: measureCommand,
  tool: toolCommand,
  mod: modCommand,
  layout: layoutCommand,
  status: statusCommand,
  shot: shotCommand,
};

/**
 * Commands that end the process once they have printed: `plugin test` and `record` run plugin code in this process,
 * as `mod check` runs a mod's code
 * (P12), as `tool test` and `tool run` run tool code, and what it leaves behind (a timer or a request made through this realm, past the run's time limit) would
 * otherwise keep the command alive.
 */
export function exitsWhenDone(argv: string[]): boolean {
  return (argv[0] === "plugin" && (argv[1] === "test" || argv[1] === "record")) || (argv[0] === "tool" && (argv[1] === "test" || argv[1] === "run")) || (argv[0] === "mod" && argv[1] === "check");
}

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
