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

/**
 * Whether the status command says the user is signed in: the JSON `loggedIn` flag when there is
 * one, otherwise the exit code (0 signed in, anything else signed out).
 */
export function parseLoggedIn(format: EngineSetup["status"]["format"], out: { stdout: string; code: number }): boolean {
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
    const s = await d.run(binary, [...leading, ...engine.setup.status.args], cli.env);
    // A check that timed out or couldn't start says nothing about the session: unknown, not signed out.
    loggedIn = s.timedOut || s.spawnError ? null : parseLoggedIn(engine.setup.status.format, s);
  }
  await shared.update(engine.id, { binary: cli.bundled ? null : binary, ...(version ? { version } : {}) }).catch(() => undefined);
  return { ...base, installed: true, version, outdated, loggedIn, verified: Boolean(record.verifiedAt) && loggedIn !== false };
}
