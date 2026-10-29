import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initHarness } from "../src/init";
import { USAGE, exitsWhenDone, main } from "../src/main";
import { TOOL_USAGE } from "../src/tool-command";
import { CORE, memoryIo, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-tool-cli-");
afterAll(cleanup);

describe("the tool command", () => {
  it("D0: tool refuses without tools; USAGE lists tool once", { timeout: 60_000 }, async () => {
    const dir = path.join(root, "plain");
    await initHarness({ dir, core: CORE, install: false });
    const m = memoryIo(dir);
    expect(await main(["tool", "test"], m.io)).toBe(1);
    expect(m.err()).toBe("This harness declares no tools.\n");
    expect(m.out()).toBe("");
    expect(USAGE.split("\n").filter((l) => l.startsWith("  tool <command>"))).toEqual([
      "  tool <command>                           Test and run the harness's tools (humanharness tool --help)",
    ]);
  });

  it("tool --help lists test and run", async () => {
    const m = memoryIo(root);
    expect(await main(["tool", "--help"], m.io)).toBe(0);
    expect(m.out()).toBe(TOOL_USAGE);
    expect(TOOL_USAGE).toMatch(/^ {2}test \[<id>\]/m);
    expect(TOOL_USAGE).toMatch(/^ {2}run <id> /m);
    const none = memoryIo(root);
    expect(await main(["tool"], none.io)).toBe(2);
    expect(none.err()).toBe(TOOL_USAGE);
    const bad = memoryIo(root);
    expect(await main(["tool", "constructor"], bad.io)).toBe(2);
    expect(bad.err()).toContain("Unknown tool command: constructor");
  });

  it("exitsWhenDone is true for tool test and tool run", () => {
    expect(exitsWhenDone(["tool", "test"])).toBe(true);
    expect(exitsWhenDone(["tool", "test", "echo"])).toBe(true);
    expect(exitsWhenDone(["tool", "run", "echo"])).toBe(true);
    for (const argv of [["tool"], ["tool", "--help"], ["tool", "build"]]) expect(exitsWhenDone(argv), argv.join(" ")).toBe(false);
  });
});
