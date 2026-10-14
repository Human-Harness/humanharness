import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import {
  MOCK_MODEL,
  devEngine,
  fakeSetupResult,
  isMockEngine,
  mockEngineText,
  mockLanguage,
  mockModels,
  offeredEngines,
  readTestHooks,
  testEngineStatus,
} from "../src/main/test-hooks";

const engines = JSON.stringify({
  claude: { command: ["/usr/local/bin/node", "fake-claude.ts"], env: { HH_FAKE_SCRIPT: "/s.json", ANTHROPIC_API_KEY: "x", HOME: "/x" } },
  codex: { command: [], env: {} },
  bad: "nope",
});

describe("readTestHooks", () => {
  it("is empty in a packaged app", () => {
    expect(
      readTestHooks({ HH_TEST_USER_DATA: "/u", HH_TEST_ENGINES: engines, HH_TEST_MOCK: "1", HH_TEST_SUGGESTED_FOLDER: "/f", HH_TEST_SHARED_DIR: "/s" }, true),
    ).toEqual({});
  });

  it("reads absolute folders and fake engines in development, passing only HH_FAKE_* variables", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "/u", HH_TEST_SHARED_DIR: "/s", HH_TEST_ENGINES: engines }, false)).toEqual({
      userData: "/u",
      sharedDir: "/s",
      engines: { claude: { command: ["/usr/local/bin/node", "fake-claude.ts"], env: { HH_FAKE_SCRIPT: "/s.json" } } },
    });
  });

  it("ignores relative folders and broken engine lists", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "u", HH_TEST_ENGINES: "{broken" }, false)).toEqual({});
  });
});

describe("testEngineStatus", () => {
  it("reports a fake engine as installed, signed in and tested", () => {
    expect(testEngineStatus(getEngine("claude"), true)).toEqual({
      engineId: "claude",
      installed: true,
      version: getEngine("claude").detect.minVersion,
      minVersion: getEngine("claude").detect.minVersion,
      outdated: false,
      loggedIn: true,
      noticeAccepted: true,
      verified: true,
    });
    expect(testEngineStatus(getEngine("codex"), false).noticeAccepted).toBe(false);
  });
});

describe("devEngine", () => {
  it("preselects an engine the harness offers, in development builds only", () => {
    expect(devEngine({ HH_DEV_ENGINE: "codex" }, false, ["claude", "codex"])).toBe("codex");
    expect(devEngine({ HH_DEV_ENGINE: "codex" }, true, ["claude", "codex"])).toBeUndefined();
    expect(devEngine({ HH_DEV_ENGINE: "gemini" }, false, ["claude", "codex"])).toBeUndefined();
    expect(devEngine({}, false, ["claude"])).toBeUndefined();
  });
});

describe("mock mode hooks", () => {
  it("reads HH_TEST_MOCK and an absolute HH_TEST_SUGGESTED_FOLDER in development only", () => {
    const env = { HH_TEST_MOCK: "1", HH_TEST_SUGGESTED_FOLDER: "/tmp/hh-mock-demo/Demo" };
    expect(readTestHooks(env, false)).toEqual({ mock: true, suggestedFolder: "/tmp/hh-mock-demo/Demo" });
    expect(readTestHooks(env, true)).toEqual({});
    expect(readTestHooks({ HH_TEST_MOCK: "yes", HH_TEST_SUGGESTED_FOLDER: "Demo" }, false)).toEqual({});
  });

  it("in mock mode only engines with a fake are offered", () => {
    const defs = [getEngine("claude"), getEngine("codex")];
    const fake = { command: ["node"], env: {} };
    expect(offeredEngines(defs, { mock: true, engines: { claude: fake } }).map((e) => e.id)).toEqual(["claude"]);
    expect(offeredEngines(defs, { engines: { claude: fake } }).map((e) => e.id)).toEqual(["claude", "codex"]);
  });
});

describe("fakeSetupResult", () => {
  it("answers for a faked engine without a real CLI, and not for a real one", () => {
    const hooks = { engines: { claude: { command: ["node"], env: {} } } };
    expect(fakeSetupResult(hooks, "claude")).toEqual({ ok: true });
    expect(fakeSetupResult(hooks, "codex")).toBeUndefined();
    expect(fakeSetupResult({}, "claude")).toBeUndefined();
  });
});

describe("mock engine presentation", () => {
  const fake = { command: ["node"], env: {} };

  it("treats an engine as the test engine only in mock mode and with a fake", () => {
    expect(isMockEngine({ mock: true, engines: { claude: fake } }, "claude")).toBe(true);
    expect(isMockEngine({ mock: true, engines: { claude: fake } }, "codex")).toBe(false);
    expect(isMockEngine({ engines: { claude: fake } }, "claude")).toBe(false);
    expect(isMockEngine({ mock: true }, "claude")).toBe(false);
  });

  it("names it in the saved language, else the system's when offered, else the harness's first", () => {
    expect(mockLanguage("en", "es-AR", ["es", "en"])).toBe("en");
    expect(mockLanguage(undefined, "es-AR", ["en", "es"])).toBe("es");
    expect(mockLanguage(undefined, "en-US", ["es", "en"])).toBe("en");
    expect(mockLanguage(undefined, "es", ["en"])).toBe("en");
    expect(mockLanguage(undefined, "fr-FR", ["es", "en"])).toBe("es");
  });

  it("presents a test engine from Human Harness that keeps the data on the computer", () => {
    expect(mockEngineText("es")).toEqual({
      name: "IA simulada (mock)",
      provider: "Human Harness",
      requires: { es: "Nada", en: "Nothing" },
      dataLocation: { es: "Tus datos no salen de esta compu", en: "Your data stays on this computer" },
      trainsOnData: { es: "No", en: "No" },
    });
    expect(mockEngineText("en").name).toBe("Simulated AI (mock)");
  });

  it("offers one test model", () => {
    expect(MOCK_MODEL).toBe("mock");
    expect(mockModels("es")).toEqual([{ id: "mock", name: "Modelo de prueba" }]);
    expect(mockModels("en")).toEqual([{ id: "mock", name: "Test model" }]);
  });
});
