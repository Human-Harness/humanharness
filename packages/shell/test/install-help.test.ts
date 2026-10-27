import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { engineOptionExtras, installCommandOf, runsInTerminal, setupCommandText, terminalCommand } from "../src/main/install-help";

describe("installCommandOf", () => {
  it("is the engine's official install command, never text from the window", () => {
    const claude = getEngine("claude");
    expect(installCommandOf(claude)).toBe(claude.setup!.install!.command);
  });

  it("throws for an engine without one", () => {
    const claude = getEngine("claude");
    expect(() => installCommandOf({ ...claude, setup: { ...claude.setup!, install: undefined } })).toThrow(/no install command/);
    expect(() => installCommandOf({ ...claude, setup: undefined })).toThrow(/no install command/);
  });
});

describe("terminalCommand", () => {
  it("opens Terminal on macOS without running anything in it", () => {
    expect(terminalCommand("darwin")).toEqual({ command: "/usr/bin/open", args: ["-a", "Terminal"] });
  });

  it("is not offered elsewhere", () => {
    expect(terminalCommand("linux")).toBeNull();
    expect(terminalCommand("win32")).toBeNull();
  });
});

describe("setupCommandText", () => {
  it("is the plain command the person pastes in Terminal", () => {
    expect(setupCommandText(getEngine("opencode"), "login")).toBe("opencode auth login");
    expect(setupCommandText(getEngine("opencode"), "logout")).toBe("opencode auth logout");
  });

  it("refuses a step the engine runs itself", () => {
    expect(() => setupCommandText(getEngine("claude"), "login")).toThrow();
    expect(() => setupCommandText(getEngine("codex"), "logout")).toThrow();
    expect(() => setupCommandText(getEngine("opencode"), "update" as never)).toThrow();
  });
});

describe("runsInTerminal", () => {
  it("is true only for OpenCode's login and logout", () => {
    expect(runsInTerminal(getEngine("opencode"), "login")).toBe(true);
    expect(runsInTerminal(getEngine("opencode"), "logout")).toBe(true);
    expect(runsInTerminal(getEngine("opencode"), "install")).toBe(false);
    expect(runsInTerminal(getEngine("opencode"), "update")).toBe(false);
  });

  it("never applies to Claude or Codex (D0)", () => {
    for (const id of ["claude", "codex"]) {
      for (const step of ["install", "update", "login", "logout"] as const) expect(runsInTerminal(getEngine(id), step)).toBe(false);
    }
  });
});

describe("engineOptionExtras", () => {
  it("gives the window OpenCode's facts", () => {
    expect(engineOptionExtras(getEngine("opencode"))).toEqual({
      reportsCost: true,
      userProvider: true,
      providersUrl: "https://opencode.ai/docs/providers/",
      terminalSteps: { login: "opencode auth login", logout: "opencode auth logout" },
    });
  });

  it("adds nothing for Claude or Codex (D0): no reportsCost, no provider, no Terminal steps", () => {
    for (const id of ["claude", "codex"]) {
      const extras = engineOptionExtras(getEngine(id));
      expect(extras).toEqual({});
      expect("reportsCost" in extras).toBe(false);
    }
  });
});
