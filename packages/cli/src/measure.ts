import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type PreMeasure, UsageLog, measurePre } from "@humanharness/shell/tasks";
import { usageFile } from "@humanharness/workspace";
import { type Io, UsageError, parseCommand } from "./cli";

const MEASURE_USAGE = "Usage: humanharness measure [--folder <dir>]";

const tokens = (n: number) => n.toLocaleString("en-US");
const tasks = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

/** One action's block: its first turns without and with pre-steps. */
function block(action: string, m: PreMeasure): string {
  const without = m.without.tasks ? `${tasks(m.without.tasks)}, first turn ≈ ${tokens(m.without.firstTurn)} tokens` : "no tasks yet";
  const withPre = m.with.tasks
    ? `${tasks(m.with.tasks)}, first turn ≈ ${tokens(m.with.firstTurn)} tokens; prepared ≈ ${tokens(m.with.preparedTokens)} tokens in ${(m.with.ms / 1000).toFixed(1)} s`
    : "no tasks yet";
  return `${action}\n  without pre-steps: ${without}\n  with pre-steps:    ${withPre}\n`;
}

/**
 * `humanharness measure [--folder <dir>]` (tools spec §8.4, first measurement method): each action's first-turn tokens
 * with and without pre-steps, from the working folder's `.harness/usage.jsonl`. Reads the log only; writes nothing.
 */
export async function measureCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { folder: { type: "string" } });
  if (positionals.length > 0) throw new UsageError(MEASURE_USAGE);
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  let folder: string;
  if (values.folder !== undefined) folder = path.resolve(io.cwd, values.folder.replace(/^~(?=$|\/)/, os.homedir()));
  else if (await exists(path.join(io.cwd, ".harness"))) folder = io.cwd;
  else throw new UsageError("Run it in a harness folder, or pass --folder <dir>.");
  const measured = (await exists(usageFile(folder))) ? measurePre(await new UsageLog(folder).load(Infinity)) : {};
  const actions = Object.entries(measured);
  if (actions.length === 0) {
    io.stdout.write(`No usage recorded in ${folder} yet.\n`);
    return 0;
  }
  io.stdout.write(actions.map(([action, m]) => block(action, m)).join("\n"));
  return 0;
}
