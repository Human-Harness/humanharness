import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModRow } from "@humanharness/protocol";
import { findHome } from "./app-home";
import { CliError, type Io, UsageError, parseCommand } from "./cli";

/** `.control.json` in the app's home folder, written by the running app (minimal-core spec §5.4). */
const CONTROL_FILE = ".control.json";
const NOT_RUNNING = "The app isn't running";

interface Control {
  port: number;
  token: string;
  pid: number;
}
interface Status {
  mods: ModRow[];
  problems: { id: string; reason: string }[];
  layout: { name: string; source: string; problems: string[] };
}

async function readControl(home: string): Promise<Control> {
  const text = await fs.readFile(path.join(home, CONTROL_FILE), "utf8").catch(() => null);
  if (text === null) throw new CliError(NOT_RUNNING);
  let c: Partial<Control>;
  try {
    c = JSON.parse(text) as Partial<Control>;
  } catch {
    throw new CliError(NOT_RUNNING);
  }
  if (typeof c.port !== "number" || typeof c.token !== "string" || typeof c.pid !== "number") throw new CliError(NOT_RUNNING);
  try {
    process.kill(c.pid, 0);
  } catch (err) {
    // EPERM: the process lives, under another user.
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw new CliError(NOT_RUNNING);
  }
  return c as Control;
}

/** Calls the running app's control channel with the token; returns its JSON answer. */
async function call<T>(home: string, method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
  const c = await readControl(home);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${c.port}${route}`, {
      method,
      headers: { authorization: `Bearer ${c.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CliError(NOT_RUNNING);
  }
  const answer = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new CliError(`The app refused the token in ${path.join(home, CONTROL_FILE)}: is it another run's?`);
  if (!res.ok) throw new CliError(`The app answered ${res.status}: ${answer.error ?? "no reason"}`);
  return answer;
}

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
  const s = await call<Status>(home, "GET", "/status");
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
  const body = positionals[0] !== undefined ? { path: path.resolve(io.cwd, positionals[0]) } : {};
  const r = await call<{ path: string }>(home, "POST", "/shot", body);
  io.stdout.write(`${r.path}\n`);
  return 0;
}
