import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { devEngine, offeredEngines, readTestHooks, testEngineStatus } from "../src/main/test-hooks";

const engines = JSON.stringify({
  claude: { command: ["/usr/local/bin/node", "fake-claude.ts"], env: { HH_FAKE_SCRIPT: "/s.json", ANTHROPIC_API_KEY: "x", HOME: "/x" } },
  codex: { command: [], env: {} },
  bad: "nope",
});

describe("readTestHooks", () => {
  it("is empty in a packaged app", () => {
    expect(readTestHooks({ HH_TEST_USER_DATA: "/u", HH_TEST_ENGINES: engines }, true)).toEqual({});
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
    const engines = [getEngine("claude"), getEngine("codex")];
    const fake = { command: ["node"], env: {} };
    expect(offeredEngines(engines, { mock: true, engines: { claude: fake } }).map((e) => e.id)).toEqual(["claude"]);
    expect(offeredEngines(engines, { engines: { claude: fake } }).map((e) => e.id)).toEqual(["claude", "codex"]);
  });
});
