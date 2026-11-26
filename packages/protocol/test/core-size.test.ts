import { describe, expect, it } from "vitest";
import { checkCoreSize, coreFiles, countLines, linesOf, readCoreBaseline } from "./file-size";

describe("the core size ratchet (minimal-core spec §8)", () => {
  it("the core has not grown over the recorded number", () => {
    const lines = coreFiles().reduce((sum, f) => sum + linesOf(f), 0);
    const { failure, hint } = checkCoreSize(lines, readCoreBaseline());
    if (hint) console.warn(hint);
    expect(failure).toBeNull();
  });

  it("counts the core's sources, not the mods, e2e, the fake agent, tests or declarations", () => {
    const files = coreFiles();
    expect(files).toContain("packages/shell/src/main/index.ts");
    expect(files).toContain("packages/ui/src/styles.css");
    expect(files.every((f) => /^packages\/[^/]+\/src\/.*\.(ts|tsx|css)$/.test(f))).toBe(true);
    expect(files.some((f) => /^packages\/(mods|e2e|fake-agent)\//.test(f) || f.endsWith(".d.ts") || f.includes("/node_modules/"))).toBe(false);
  });

  it("counts a last line without a newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });

  it("one line over the baseline fails, naming both numbers and the way out", () => {
    const { failure, hint } = checkCoreSize(101, 100);
    expect(failure).toMatch(/^The core is 101 lines, over its baseline of 100 \(\+1\)\./);
    expect(hint).toBeNull();
  });

  it("at the baseline passes quietly", () => {
    expect(checkCoreSize(100, 100)).toEqual({ failure: null, hint: null });
  });

  it("below the baseline passes and says to lower it to the new number", () => {
    const { failure, hint } = checkCoreSize(90, 100);
    expect(failure).toBeNull();
    expect(hint).toMatch(/90 lines.*Lower .*core-size-baseline\.json to 90\./);
  });
});
