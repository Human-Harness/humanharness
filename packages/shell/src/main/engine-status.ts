import { type EngineDef, type EngineSetup, NOTICE_VERSION, meetsMinVersion, parseVersion } from "@humanharness/engines";
import type { EngineStatus } from "@humanharness/ui/client";
import { type CommandDeps, cliCommand } from "./engine-command";
import { type SharedConfigStore, noticeAccepted } from "./shared-config";

/**
 * Whether the status command says the user is signed in. For JSON output only `loggedIn` is read:
 * the rest (email, organization) is never kept or logged.
 */
export function parseLoggedIn(format: EngineSetup["status"]["format"], out: { stdout: string; code: number }): boolean {
  if (format === "exit-code") return out.code === 0;
  try {
    return (JSON.parse(out.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
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
  const version = v.code === 0 ? parseVersion(v.stdout) : null;
  if (!version) return missing;

  const outdated = !meetsMinVersion(version, engine.detect.minVersion);
  let loggedIn: boolean | null = null;
  if (engine.setup && !outdated) {
    const s = await d.run(binary, [...leading, ...engine.setup.status.args], cli.env);
    loggedIn = parseLoggedIn(engine.setup.status.format, s);
  }
  await shared.update(engine.id, { binary: cli.bundled ? undefined : binary, version }).catch(() => undefined);
  return { ...base, installed: true, version, outdated, loggedIn, verified: Boolean(record.verifiedAt) && loggedIn !== false };
}
