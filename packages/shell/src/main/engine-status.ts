import { type EngineDef, type EngineSetup, NOTICE_VERSION, meetsMinVersion, parseVersion } from "@humanharness/engines";
import type { EngineStatus } from "@humanharness/ui/client";
import { type CommandDeps, cliCommand } from "./engine-command";
import { type SharedConfigStore, noticeAccepted } from "./shared-config";

/**
 * The `loggedIn` flag of the last JSON object in `stdout` (a CLI may print notices before it), or
 * undefined when there is none. Only that flag is read: the rest (email, organization) is never
 * kept or logged.
 */
function lastLoggedIn(stdout: string): boolean | undefined {
  const end = stdout.lastIndexOf("}");
  if (end < 0) return undefined;
  for (let start = stdout.lastIndexOf("{", end); start >= 0; start = stdout.lastIndexOf("{", start - 1)) {
    try {
      const value = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      if (value && typeof value === "object" && typeof (value as { loggedIn?: unknown }).loggedIn === "boolean") {
        return (value as { loggedIn: boolean }).loggedIn;
      }
    } catch {
      // not a whole object yet: try an earlier "{"
    }
    if (start === 0) break;
  }
  return undefined;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
/** A provider line of OpenCode 1.x's `auth list`: a bullet (`•` without Unicode), then a name. */
const PROVIDER_LINE = /^[●○•]\s+\S/;

/** The integrations with a connection in OpenCode 2.x's `auth list --format json`, or undefined when it is not that JSON. */
function jsonProviders(text: string): number | undefined {
  if (!text.startsWith("[")) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.filter((item) => {
      const connections = (item as { connections?: unknown } | null)?.connections;
      return Array.isArray(connections) && connections.length > 0;
    }).length;
  } catch {
    return undefined;
  }
}

/**
 * How many providers `opencode auth list` lists: OpenCode 2.x's JSON (`[]` when none), or OpenCode 1.x's text
 * (credentials and environment, ANSI colours stripped). Anything else, such as 2.x's "No authenticated
 * integrations", counts none. Only the count is read: names, paths and keys in the output are never kept or
 * logged (compliance rule 1).
 */
export function countProviders(stdout: string): number {
  const text = stdout.replace(ANSI, "").trim();
  return jsonProviders(text) ?? text.split(/\r?\n/).filter((line) => PROVIDER_LINE.test(line.trim())).length;
}

/** The status command's args: OpenCode 2.x is asked for JSON (its text is a table), every other CLI as registered. */
function statusArgs(setup: EngineSetup, version: string | null): string[] {
  const major = version ? Number(version.split(".")[0]) : 0;
  if (setup.status.format === "opencode-auth-list" && major >= 2) return [...setup.status.args, "--format", "json"];
  return setup.status.args;
}

/**
 * Whether the status command says the user is signed in: the JSON `loggedIn` flag when there is
 * one, otherwise the exit code (0 signed in, anything else signed out). OpenCode: a provider is listed.
 */
export function parseLoggedIn(format: EngineSetup["status"]["format"], out: { stdout: string; code: number }): boolean {
  if (format === "opencode-auth-list") return out.code === 0 && countProviders(out.stdout) > 0;
  if (format === "json-logged-in") {
    const flag = lastLoggedIn(out.stdout);
    if (flag !== undefined) return flag;
  }
  return out.code === 0;
}

/** Checks the engine's CLI: installed, version against `detect.minVersion`, signed in. Reads nothing from the CLI's own files. */
export async function detectEngine(engine: EngineDef, d: CommandDeps, shared: SharedConfigStore): Promise<EngineStatus> {
  const record = await shared.engine(engine.id);
  const base = {
    engineId: engine.id,
    minVersion: engine.detect.minVersion,
    noticeAccepted: noticeAccepted(record, NOTICE_VERSION),
  };
  const missing: EngineStatus = { ...base, installed: false, version: null, outdated: false, loggedIn: null, verified: false };

  const cli = await cliCommand(engine, d);
  if (!cli) return missing;
  const [binary, ...leading] = cli.command;
  const v = await d.run(binary, [...leading, ...engine.detect.versionArgs], cli.env);
  // The binary is there even when --version fails or times out: don't send the user to reinstall it.
  const version = v.code === 0 ? parseVersion(v.stdout) : null;

  const outdated = version !== null && !meetsMinVersion(version, engine.detect.minVersion);
  let loggedIn: boolean | null = null;
  if (engine.setup && !outdated) {
    const s = await d.run(binary, [...leading, ...statusArgs(engine.setup, version)], cli.env);
    // A check that timed out or couldn't start says nothing about the session: unknown, not signed out.
    loggedIn = s.timedOut || s.spawnError ? null : parseLoggedIn(engine.setup.status.format, s);
    // OpenCode with local models only lists no provider: a test prompt that worked says it is set up (spec §2).
    if (loggedIn === false && engine.setup.status.format === "opencode-auth-list" && record.verifiedAt) loggedIn = null;
  }
  await shared.update(engine.id, { binary: cli.bundled ? null : binary, ...(version ? { version } : {}) }).catch(() => undefined);
  return { ...base, installed: true, version, outdated, loggedIn, verified: Boolean(record.verifiedAt) && loggedIn !== false };
}

/** Whether the user accepted the engine's legal notice at the current version (spec §9: nothing runs before). */
export async function hasAcceptedNotice(shared: SharedConfigStore, engineId: string): Promise<boolean> {
  return noticeAccepted(await shared.engine(engineId), NOTICE_VERSION);
}
