import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineHarness } from "../src";

const baseManifest = () => ({
  id: "notes",
  name: "Notes",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Notes" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none" as const, exec: false, web: false },
  blocks: {},
  author: "Me",
});

// `release: true` marks an official harness the release workflow publishes on a v* tag (release spec).
describe("manifest release", () => {
  it("is absent by default", () => {
    expect(defineHarness(baseManifest()).release).toBeUndefined();
  });

  it("loads release: true", () => {
    expect(defineHarness({ ...baseManifest(), release: true }).release).toBe(true);
  });

  it("refuses a release that is not a boolean, with a clear message", () => {
    expect(() => defineHarness({ ...baseManifest(), release: "yes" } as never)).toThrow("release must be true or false");
  });

  it("is not set on the demo harness", async () => {
    const demo = await fs.readFile(path.resolve(__dirname, "../../../harnesses/demo/harness.config.ts"), "utf8");
    expect(demo).not.toMatch(/^\s*release\s*:/m);
  });
});
