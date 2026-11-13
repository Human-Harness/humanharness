import path from "node:path";
import { findHome } from "./app-home";
import { type Io, UsageError, parseCommand } from "./cli";
import { appShot, appStatus } from "./kit";

const HOME_OPTION = { home: { type: "string" } } as const;

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ").trimEnd());
}

/** `humanharness status`: which mods run, which failed and why, and the layout shown. */
export async function statusCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, HOME_OPTION);
  if (positionals.length > 0) throw new UsageError("Usage: humanharness status [--home <dir>]");
  const home = findHome(io.cwd, values.home);
  const s = await appStatus(home);
  const lines: string[] = [];
  if (s.mods.length === 0) lines.push("No mods.");
  else {
    const rows = [["MOD", "VERSION", "ORIGIN", "STATE", "REGISTERS", "PROBLEM"]];
    for (const m of s.mods) {
      const registers = [...m.registers.hooks, ...m.registers.ipc.map((n) => `ipc ${n}`)].join(", ") || "-";
      rows.push([m.id, m.version, m.origin, m.on ? "on" : "off", registers, m.failed ?? m.problem ?? ""]);
    }
    lines.push(...table(rows));
  }
  if (s.problems.length > 0) {
    lines.push("", "Couldn't read:");
    for (const p of s.problems) lines.push(`  ${p.id}: ${p.reason}`);
  }
  lines.push("", `Layout: ${s.layout.name} (${s.layout.source})`);
  for (const p of s.layout.problems) lines.push(`  passed over ${p}`);
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

/** `humanharness shot [file.png]`: the running app saves its window as a PNG; prints the path. */
export async function shotCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, HOME_OPTION);
  if (positionals.length > 1 || (positionals[0] !== undefined && !positionals[0].toLowerCase().endsWith(".png"))) {
    throw new UsageError("Usage: humanharness shot [file.png] [--home <dir>]");
  }
  const home = findHome(io.cwd, values.home);
  const r = await appShot(home, positionals[0] !== undefined ? path.resolve(io.cwd, positionals[0]) : undefined);
  io.stdout.write(`${r.path}\n`);
  return 0;
}
