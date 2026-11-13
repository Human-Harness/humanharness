import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModRow } from "@humanharness/protocol";
import { CliError } from "../cli";

/** `.control.json` in the app's home folder, written by the running app (minimal-core spec §5.4). */
const CONTROL_FILE = ".control.json";
const NOT_RUNNING = "The app isn't running";

interface Control {
  port: number;
  token: string;
  pid: number;
}
export interface AppStatus {
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

/** Which mods run, which failed and why, and the layout shown, from the running app. */
export function appStatus(home: string): Promise<AppStatus> {
  return call<AppStatus>(home, "GET", "/status");
}

/** The running app saves its window as a PNG (`file` relative to `home`, else the app's default); returns the path. */
export async function appShot(home: string, file?: string): Promise<{ path: string }> {
  const body = file !== undefined ? { path: path.resolve(home, file) } : {};
  const r = await call<{ path: string }>(home, "POST", "/shot", body);
  return { path: r.path };
}
