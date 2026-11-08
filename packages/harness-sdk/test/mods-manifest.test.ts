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

describe("manifest mods", () => {
  it("is absent by default (D0)", () => {
    expect(defineHarness(baseManifest()).mods).toBeUndefined();
  });
  it("keeps each mod's config as given, for the mod's own schema", () => {
    expect(defineHarness({ ...baseManifest(), mods: { echo: { word: "hi" }, bare: {} } }).mods).toEqual({ echo: { word: "hi" }, bare: {} });
  });
  it("refuses a bad mod id", () => {
    expect(() => defineHarness({ ...baseManifest(), mods: { "Bad!": {} } })).toThrow();
  });
});
