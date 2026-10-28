import { describe, expect, it } from "vitest";
import { USAGE, main } from "../src/main";
import { BUILD_USAGE, PLUGIN_USAGE } from "../src/plugin";
import * as sdk from "../src/sdk";
import { memoryIo } from "./helpers";

describe("humanharness", () => {
  it("prints its usage with no command", async () => {
    const m = memoryIo(process.cwd());
    expect(await main([], m.io)).toBe(0);
    expect(m.out()).toBe(USAGE);
    expect(USAGE).toContain("humanharness <command>");
  });

  it("refuses an unknown command with exit code 2", async () => {
    const m = memoryIo(process.cwd());
    expect(await main(["deploy"], m.io)).toBe(2);
    expect(m.err()).toContain("Unknown command: deploy");
  });

  it("keeps every harness line of its usage and adds only the plugin group (D0)", () => {
    const before = [
      "Usage: humanharness <command>",
      "",
      "Commands:",
      "  init <dir> [--core <path>] [--id <id>] [--skip-install]",
      "                                           Create a harness repo from the template and install the guide",
      "  check [--json]                           Validate the harness in the current folder",
      "  run <action> [--engine claude|codex|opencode] [--tier light|standard|deep] [--folder <dir>] [--language <tag>] [--record [--force]]",
      "                                           Run one task against a real engine in the terminal",
      "  dev [--engine <id>] [--mock [--keep]] [--build <dir>]",
      "                                           Check the harness, then open the app with it (--mock: replay mock/, no AI)",
      "",
      "check, run and dev take --harness <dir> to work on another folder than the current one.",
      "",
    ];
    const lines = USAGE.split("\n");
    expect(lines.filter((l) => !/^ {2}plugin\b/.test(l))).toEqual(before);
    expect(lines.filter((l) => /^ {2}plugin\b/.test(l)).length).toBe(1);
  });

  it("prints the plugin usage and exits 2 for `plugin` with no sub-command", async () => {
    const m = memoryIo(process.cwd());
    expect(await main(["plugin"], m.io)).toBe(2);
    expect(m.err()).toBe(PLUGIN_USAGE);
    expect(PLUGIN_USAGE).toContain("  build [--plugin <dir>]");
  });

  it("prints the plugin usage on `plugin --help`, and refuses an unknown sub-command", async () => {
    const help = memoryIo(process.cwd());
    expect(await main(["plugin", "--help"], help.io)).toBe(0);
    expect(help.out()).toBe(PLUGIN_USAGE);
    const bad = memoryIo(process.cwd());
    expect(await main(["plugin", "deploy"], bad.io)).toBe(2);
    expect(bad.err()).toContain("Unknown plugin command: deploy");
    const proto = memoryIo(process.cwd());
    expect(await main(["plugin", "constructor"], proto.io)).toBe(2);
  });

  it("prints the build usage on `plugin build --help` and refuses a stray argument", async () => {
    const m = memoryIo(process.cwd());
    expect(await main(["plugin", "build", "--help"], m.io)).toBe(0);
    expect(m.out()).toBe(BUILD_USAGE);
    expect(BUILD_USAGE).toContain("humanharness plugin build");
    const bad = memoryIo(process.cwd());
    expect(await main(["plugin", "build", "extra"], bad.io)).toBe(2);
    expect(bad.err()).toContain(BUILD_USAGE.trim());
  });

  it("gives a harness repo the SDK through @humanharness/cli/sdk", () => {
    expect(typeof sdk.defineHarness).toBe("function");
    expect(typeof sdk.defineBlock).toBe("function");
    expect(typeof sdk.z.object).toBe("function");
  });
});
