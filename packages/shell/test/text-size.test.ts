import { describe, expect, it } from "vitest";
import { type KeyInput, textSizeShortcut, trafficLightY } from "../src/main/text-size";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ type: "keyDown", key: k, meta: false, control: false, alt: false, ...mods });

describe("textSizeShortcut", () => {
  it("reads ⌘+ (or ⌘=), ⌘− and ⌘0 on macOS", () => {
    expect(textSizeShortcut(key("=", { meta: true }), "darwin")).toBe("in");
    expect(textSizeShortcut(key("+", { meta: true }), "darwin")).toBe("in");
    expect(textSizeShortcut(key("-", { meta: true }), "darwin")).toBe("out");
    expect(textSizeShortcut(key("0", { meta: true }), "darwin")).toBe("reset");
  });

  it("uses Ctrl instead of ⌘ outside macOS", () => {
    expect(textSizeShortcut(key("=", { control: true }), "win32")).toBe("in");
    expect(textSizeShortcut(key("-", { control: true }), "linux")).toBe("out");
    expect(textSizeShortcut(key("=", { meta: true }), "win32")).toBeNull();
    expect(textSizeShortcut(key("=", { control: true }), "darwin")).toBeNull();
  });

  it("ignores other keys, key releases, typing without the modifier and Option combinations", () => {
    expect(textSizeShortcut(key("1", { meta: true }), "darwin")).toBeNull();
    expect(textSizeShortcut(key("=", { meta: true, type: "keyUp" }), "darwin")).toBeNull();
    expect(textSizeShortcut(key("=", {}), "darwin")).toBeNull();
    expect(textSizeShortcut(key("-", { meta: true, alt: true }), "darwin")).toBeNull();
  });
});

describe("trafficLightY", () => {
  it("keeps the traffic lights where they are at normal size and moves them down with the top bar", () => {
    expect(trafficLightY(1)).toBe(18);
    expect(trafficLightY(1.5)).toBe(31);
  });
});
