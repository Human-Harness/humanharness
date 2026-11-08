import { describe, expect, it } from "vitest";
import { MOD_ID } from "@humanharness/mod-sdk";
import { MANIFEST_MOD_ID, defineHarness } from "../src";

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
  it("checks ids with the same rule as mod-sdk", () => {
    expect(MANIFEST_MOD_ID.source).toBe(MOD_ID.source);
    expect(MANIFEST_MOD_ID.flags).toBe(MOD_ID.flags);
  });
  it("refuses a bad mod id", () => {
    expect(() => defineHarness({ ...baseManifest(), mods: { "Bad!": {} } })).toThrow();
  });
});
