import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import {
  MOCK_MODEL,
  devEngine,
  fakeSetupResult,
  isMockEngine,
  mockEngineText,
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
  it("reads a short time-box minute (HH_TEST_MINUTE_MS) between 10 ms and a real minute", () => {
    expect(readTestHooks({ HH_TEST_MINUTE_MS: "1000" }, false)).toEqual({ minuteMs: 1000 });
    for (const v of ["0", "9", "60001", "abc", "1.5"]) expect(readTestHooks({ HH_TEST_MINUTE_MS: v }, false)).toEqual({});
    expect(readTestHooks({ HH_TEST_MINUTE_MS: "1000" }, true)).toEqual({});
  });

  it("reads plugin folders (HH_PLUGIN_DIRS, absolute only) and a short plugin run limit, in development only", () => {
    const env = { HH_PLUGIN_DIRS: ["/a", "rel", "", "/b"].join(path.delimiter), HH_TEST_PLUGIN_RUN_LIMIT_MS: "2000" };
    expect(readTestHooks(env, false)).toEqual({ pluginDirs: ["/a", "/b"], pluginRunLimitMs: 2000 });
    expect(readTestHooks(env, true)).toEqual({});
    expect(readTestHooks({ HH_PLUGIN_DIRS: "rel" }, false)).toEqual({});
    for (const v of ["99", "600001", "1.5", "x"]) expect(readTestHooks({ HH_TEST_PLUGIN_RUN_LIMIT_MS: v }, false)).toEqual({});
    expect(readTestHooks({ HH_TEST_PLUGIN_RUN_LIMIT_MS: "100" }, false)).toEqual({ pluginRunLimitMs: 100 });
    expect(readTestHooks({ HH_TEST_PLUGIN_RUN_LIMIT_MS: "600000" }, false)).toEqual({ pluginRunLimitMs: 600_000 });
  });

  it("HH_PLUGIN_FIXTURES=1 → plugins run on their fixtures, in development only", () => {
    expect(readTestHooks({ HH_PLUGIN_FIXTURES: "1" }, false)).toEqual({ pluginFixtures: true });
    expect(readTestHooks({ HH_PLUGIN_FIXTURES: "1" }, true)).toEqual({});
    for (const v of ["0", "true", "", "yes"]) expect(readTestHooks({ HH_PLUGIN_FIXTURES: v }, false)).toEqual({});
  });

  it("fake secrets only when not packaged", () => {
    expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "1" }, false).fakeSecrets).toBe(true);
    expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "1" }, true).fakeSecrets).toBeUndefined();
    expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "yes" }, false).fakeSecrets).toBeUndefined();
    for (const v of ["0", "true", ""]) expect(readTestHooks({ HH_TEST_FAKE_SECRETS: v }, false)).toEqual({});
  });

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

  it("presents a test engine from Human Harness that keeps the data on the computer", () => {
    expect(mockEngineText()).toEqual({
      name: "Simulated AI (mock)",
      provider: "Human Harness",
      requires: "Nothing",
      dataLocation: "Your data stays on this computer",
      trainsOnData: "No",
    });
  });

  it("offers one test model", () => {
    expect(MOCK_MODEL).toBe("mock");
    expect(mockModels()).toEqual([{ id: "mock", name: "Test model" }]);
  });
});
