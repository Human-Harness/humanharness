import path from "node:path";
import type { EngineDef, ModelChoice } from "@humanharness/engines";
import type { Language, LocalizedText } from "@humanharness/harness-sdk";
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
  /** `humanharness dev --mock`: only the faked engines are offered, and the window shows a badge. */
  mock?: boolean;
  /** Where the folder step suggests the folder (mock mode keeps it in its temp folder). */
  suggestedFolder?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * End-to-end test settings from the environment: HH_TEST_USER_DATA, HH_TEST_SHARED_DIR,
 * HH_TEST_SUGGESTED_FOLDER, HH_TEST_MOCK ("1") and HH_TEST_ENGINES (JSON: engine id → { command, env }). Development builds only: a packaged app
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
  const suggestedFolder = dir(env.HH_TEST_SUGGESTED_FOLDER);
  if (suggestedFolder) hooks.suggestedFolder = suggestedFolder;
  if (env.HH_TEST_MOCK === "1") hooks.mock = true;
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

/**
 * `humanharness dev --engine <id>` (HH_DEV_ENGINE): the engine a fresh app starts with. Development builds
 * only, and only an engine this harness offers; anything else is ignored.
 */
export function devEngine(env: Record<string, string | undefined>, packaged: boolean, offered: string[]): string | undefined {
  if (packaged) return undefined;
  const id = env.HH_DEV_ENGINE;
  return id && offered.includes(id) ? id : undefined;
}

/** The engines the app offers: in mock mode only those with a fake, so no status check reaches a real CLI. */
export function offeredEngines<E extends { id: string }>(engines: E[], hooks: Pick<TestHooks, "mock" | "engines">): E[] {
  return hooks.mock ? engines.filter((e) => hooks.engines?.[e.id] !== undefined) : engines;
}

/**
 * Setup steps (install, update, login, logout) for an engine with a fake: nothing runs, so no real CLI
 * is spawned. Undefined for a real engine. The same goes for the engine test: a fake counts as working.
 */
export function fakeSetupResult(hooks: Pick<TestHooks, "engines">, engineId: string): { ok: true } | undefined {
  return hooks.engines?.[engineId] ? { ok: true } : undefined;
}

/** Whether `engineId` is shown as the test engine: `humanharness dev --mock` and the engine has a fake. */
export function isMockEngine(hooks: Pick<TestHooks, "mock" | "engines">, engineId: string): boolean {
  return hooks.mock === true && hooks.engines?.[engineId] !== undefined;
}

/**
 * The language the test engine is shown in: the saved one, else the system's when the harness offers it
 * ("es-AR" → es), else the harness's first language.
 */
export function mockLanguage(saved: Language | undefined, locale: string, languages: readonly Language[]): Language {
  if (saved) return saved;
  return languages.find((l) => locale.toLowerCase().startsWith(l)) ?? languages[0]!;
}

/** How a faked engine presents itself in mock mode (spec 3f §4): no provider to disclose, nothing leaves the computer. */
export function mockEngineText(language: Language): {
  name: string;
  provider: string;
  requires: LocalizedText;
  dataLocation: LocalizedText;
  trainsOnData: LocalizedText;
} {
  return {
    name: language === "es" ? "Motor de prueba" : "Test engine",
    provider: "Human Harness",
    requires: { es: "Nada", en: "Nothing" },
    dataLocation: { es: "Tus datos no salen de esta compu", en: "Your data stays on this computer" },
    trainsOnData: { es: "No", en: "No" },
  };
}

/** The one model a faked engine offers in mock mode; every tier uses it (the fake ignores --model). */
export const MOCK_MODEL = "mock";

export function mockModels(language: Language): ModelChoice[] {
  return [{ id: MOCK_MODEL, name: language === "es" ? "Modelo de prueba" : "Test model" }];
}
