import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { installCommandOf, terminalCommand } from "../src/main/install-help";

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
