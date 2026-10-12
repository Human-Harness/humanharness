import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { devEngine, readTestHooks, testEngineStatus } from "../src/main/test-hooks";

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
