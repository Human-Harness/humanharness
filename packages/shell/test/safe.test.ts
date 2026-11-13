import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModsSettings } from "../src/main/mods/config";
import { enterSafeMode, isEscapeHatch, safeAtStart } from "../src/main/mods/safe";

let home: string;
let outside: string;
async function mod(dir: string, id: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "mod.json"), JSON.stringify({ id, name: id, version: "1.0.0", apiVersion: 1, ui: "ui.tsx" }));
  return dir;
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "hh-safe-home-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "hh-safe-local-"));
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("enterSafeMode", () => {
  it("clears the layout pick, keeps other settings, and turns off only the local mods", async () => {
    await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ layout: "mine", other: 1 }));
    const user = await mod(path.join(home, "mods", "hello"), "hello");
    const local = await mod(path.join(outside, "echo"), "echo");
    const broken = path.join(home, "mods", "broken");
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, "mod.json"), "{");
    let saved: ModsSettings | undefined = { on: { home: true, sidekick: true, hello: true }, trusted: ["hello"], local: [local] };
    const r = await enterSafeMode({
      home,
      folders: [user, local, broken],
      mods: { load: async () => saved, save: async (m) => void (saved = m) },
    });
    expect(JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8"))).toEqual({ other: 1 });
    expect(r.layout.picked).toBeUndefined();
    expect(r.off.sort()).toEqual(["echo", "hello"]);
    expect(saved).toEqual({ on: { home: true, sidekick: true, hello: false, echo: false }, trusted: ["hello"], local: [local] });
  });

  it("works with no settings and no local mods", async () => {
    let saved: ModsSettings | undefined;
    const r = await enterSafeMode({ home, folders: [], mods: { load: async () => saved, save: async (m) => void (saved = m) } });
    expect(r.off).toEqual([]);
    expect(saved?.on ?? {}).toEqual({});
  });
});

describe("isEscapeHatch", () => {
  const key = (o: Partial<{ type: string; key: string; meta: boolean; control: boolean; alt: boolean; shift: boolean }>) => ({
    type: "keyDown",
    key: "Escape",
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...o,
  });
  it("accepts ⌘⌥⇧Esc on macOS and Ctrl+Alt+Shift+Esc elsewhere", () => {
    expect(isEscapeHatch(key({ meta: true, alt: true, shift: true }), "darwin")).toBe(true);
    expect(isEscapeHatch(key({ control: true, alt: true, shift: true }), "linux")).toBe(true);
    expect(isEscapeHatch(key({ control: true, alt: true, shift: true }), "win32")).toBe(true);
  });
  it("accepts nothing else", () => {
    expect(isEscapeHatch(key({ control: true, alt: true, shift: true }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, alt: true, shift: true }), "linux")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, alt: true }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, shift: true }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ alt: true, shift: true }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, control: true, alt: true, shift: true }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, alt: true, shift: true, key: "Enter" }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({ meta: true, alt: true, shift: true, type: "keyUp" }), "darwin")).toBe(false);
    expect(isEscapeHatch(key({}), "darwin")).toBe(false);
  });
});

describe("safeAtStart", () => {
  it("is a --safe argument or HH_SAFE=1", () => {
    expect(safeAtStart(["electron", "."], {})).toBe(false);
    expect(safeAtStart(["electron", ".", "--safe"], {})).toBe(true);
    expect(safeAtStart(["app"], { HH_SAFE: "1" })).toBe(true);
    expect(safeAtStart(["app"], { HH_SAFE: "0" })).toBe(false);
  });
});
