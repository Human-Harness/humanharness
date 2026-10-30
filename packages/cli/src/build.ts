import path from "node:path";
import { type LoadedHarness, hasTools, loadHarness } from "@humanharness/harness-sdk";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
import { MANIFEST } from "./paths";
import { buildTools } from "./tool-build";
import { TOOL_P12_NOTE } from "./tool-host-node";

/** `humanharness build [--harness <dir>]` (tools Decision 2): the harness's tools into dist/. Nothing to do without tools. */
export async function buildCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { harness: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("Usage: humanharness build [--harness <dir>]");
  const dir = path.resolve(io.cwd, values.harness ?? ".");
  let harness: LoadedHarness;
  try {
    harness = await loadHarness(path.join(dir, MANIFEST));
  } catch (err) {
    throw new CliError(`${MANIFEST} doesn't load (humanharness check says why): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!hasTools(harness)) {
    io.stdout.write("This harness declares no tools.\n");
    return 0;
  }
  // P12: the build imports each tool's module in this process.
  io.stdout.write(`${TOOL_P12_NOTE}\n`);
  const { json } = await buildTools(dir, { write: true, harness });
  const n = Object.keys(json.tools).length;
  io.stdout.write(`Built ${n} tool${n === 1 ? "" : "s"} into dist/\n`);
  return 0;
}
