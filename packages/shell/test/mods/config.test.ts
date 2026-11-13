import { describe, expect, it } from "vitest";
import { cleanModsConfig, isModOn } from "../../src/main/mods/config";

describe("mods config", () => {
  it("drops junk and keeps on/local/failed", () => {
    expect(cleanModsConfig({ on: { echo: false, "Bad!": true, x: "yes" }, local: ["/a", 3, "/a"], failed: { echo: "threw" } })).toEqual({ on: { echo: false }, local: ["/a"], failed: { echo: "threw" } });
    expect(cleanModsConfig({ trusted: ["greet", "Bad!", 3, "greet"] })).toEqual({ trusted: ["greet"] });
    expect(cleanModsConfig({ trusted: "greet" })).toBeUndefined();
    expect(cleanModsConfig("nope")).toBeUndefined();
    expect(cleanModsConfig({})).toBeUndefined();
  });
  it("decides on/off: failed > person's switch > declared by the harness; local mods start off", () => {
    expect(isModOn("echo", "harness", undefined)).toBe(true);
    expect(isModOn("echo", "harness", { on: { echo: false } })).toBe(false);
    expect(isModOn("echo", "local", undefined)).toBe(false);
    expect(isModOn("echo", "local", { on: { echo: true } })).toBe(true);
    expect(isModOn("echo", "harness", { on: { echo: true }, failed: { echo: "x" } })).toBe(false);
    expect(isModOn("core-x", "core", undefined)).toBe(false);
  });
  it("a core mod on by default is on unless the person turned it off or it failed", () => {
    expect(isModOn("home", "core", undefined, true)).toBe(true);
    expect(isModOn("home", "core", { on: { home: false } }, true)).toBe(false);
    expect(isModOn("home", "core", { failed: { home: "threw" } }, true)).toBe(false);
    expect(isModOn("home", "core", undefined, false)).toBe(false);
  });
});
