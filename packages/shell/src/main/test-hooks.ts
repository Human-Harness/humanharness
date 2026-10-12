import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import type { EngineStatus } from "@humanharness/ui/client";

/** A fake engine for the end-to-end tests: the command to run instead of the real CLI. */
export interface TestEngine {
  command: string[];
  /** Only HH_FAKE_* variables (the fake agents' scripts and logs). */
  env: Record<string, string>;
}

export interface TestHooks {
  userData?: string;
  sharedDir?: string;
  engines?: Record<string, TestEngine>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * End-to-end test settings from the environment: HH_TEST_USER_DATA, HH_TEST_SHARED_DIR and
 * HH_TEST_ENGINES (JSON: engine id → { command, env }). Development builds only: a packaged app
 * ignores them. Engine environments keep only HH_FAKE_* variables, so no credential or auth variable
 * can be passed this way.
 */
export function readTestHooks(env: Record<string, string | undefined>, packaged: boolean): TestHooks {
  if (packaged) return {};
  const hooks: TestHooks = {};
  const dir = (v: string | undefined) => (v && path.isAbsolute(v) ? v : undefined);
  const userData = dir(env.HH_TEST_USER_DATA);
  const sharedDir = dir(env.HH_TEST_SHARED_DIR);
  if (userData) hooks.userData = userData;
  if (sharedDir) hooks.sharedDir = sharedDir;
  let raw: unknown;
  try {
    raw = env.HH_TEST_ENGINES ? JSON.parse(env.HH_TEST_ENGINES) : undefined;
  } catch {
    raw = undefined;
  }
  if (isObject(raw)) {
    const engines: Record<string, TestEngine> = {};
    for (const [id, e] of Object.entries(raw)) {
      if (!isObject(e) || !Array.isArray(e.command) || e.command.length === 0 || !e.command.every((c) => typeof c === "string")) continue;
      const fakeEnv = Object.fromEntries(
        Object.entries(isObject(e.env) ? e.env : {}).filter(([k, v]) => k.startsWith("HH_FAKE_") && typeof v === "string"),
      ) as Record<string, string>;
      engines[id] = { command: e.command as string[], env: fakeEnv };
    }
    if (Object.keys(engines).length > 0) hooks.engines = engines;
  }
  return hooks;
}

/** A fake engine is always installed, signed in and tested; only the legal notice is real. */
export function testEngineStatus(engine: EngineDef, noticeAccepted: boolean): EngineStatus {
  return {
    engineId: engine.id,
    installed: true,
    version: engine.detect.minVersion,
    minVersion: engine.detect.minVersion,
    outdated: false,
    loggedIn: true,
    noticeAccepted,
    verified: true,
  };
}
