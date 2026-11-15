import path from "node:path";
import { findHome } from "./app-home";
import { type Io, UsageError, parseCommand } from "./cli";
import { assertLayoutName, assertModId, checkMod, cloneLayout, cloneMod } from "./kit";

export const MOD_USAGE = [
  "Usage: humanharness mod <command>",
  "",
  "Commands:",
  "  check <folder>                           Check a mod without the app: mod.json, its bundles, main and each block",
  "  clone <id> [as] [--home <dir>]           Copy a core or harness mod to mods/<as> in the app's home folder",
  "",
].join("\n");
export const LAYOUT_USAGE = "Usage: humanharness layout clone <name> [as] [--home <dir>]\n";

/** `humanharness mod <check|clone>`. */
export async function modCommand(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "check") return modCheck(rest, io);
  if (sub === "clone") return modClone(rest, io);
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    (sub === undefined ? io.stderr : io.stdout).write(MOD_USAGE);
    return sub === undefined ? 2 : 0;
  }
  throw new UsageError(`Unknown mod command: ${sub}\n\n${MOD_USAGE}`);
}

/** `humanharness layout clone`. */
export async function layoutCommand(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "clone") throw new UsageError(LAYOUT_USAGE.trimEnd());
  const { values, positionals } = parseCommand(rest, { home: { type: "string" } });
  const [name, as = name] = positionals;
  if (name === undefined || positionals.length > 2) throw new UsageError(LAYOUT_USAGE.trimEnd());
  assertLayoutName(as);
  const home = findHome(io.cwd, values.home);
  const r = await cloneLayout(home, name, as);
  io.stdout.write(`Copied ${r.source} to ${r.path}\n`);
  return 0;
}

async function modClone(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { home: { type: "string" } });
  const [id, as = id] = positionals;
  if (id === undefined || positionals.length > 2) throw new UsageError("Usage: humanharness mod clone <id> [as] [--home <dir>]");
  assertModId(as);
  const home = findHome(io.cwd, values.home);
  const r = await cloneMod(home, id, as);
  io.stdout.write(`Copied ${r.source} to ${r.path}. It starts off: turn the original off and the clone on in Settings › Mods.\n`);
  return 0;
}

async function modCheck(args: string[], io: Io): Promise<number> {
  const { positionals } = parseCommand(args, {});
  if (positionals.length !== 1) throw new UsageError("Usage: humanharness mod check <folder>");
  const r = await checkMod(io.cwd, path.resolve(io.cwd, positionals[0]));
  for (const c of r.checks) io.stdout.write(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail === undefined ? "" : `: ${c.detail}`}\n`);
  return r.ok ? 0 : 1;
}
