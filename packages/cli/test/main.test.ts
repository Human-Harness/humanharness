import { describe, expect, it } from "vitest";
import { USAGE, main } from "../src/main";
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

  it("gives a harness repo the SDK through @humanharness/cli/sdk", () => {
    expect(typeof sdk.defineHarness).toBe("function");
    expect(typeof sdk.defineBlock).toBe("function");
    expect(typeof sdk.z.object).toBe("function");
  });
});
