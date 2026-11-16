import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalog } from "../src/kit";
import { tempRoot } from "./helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "home-kit");
/**
 * The real generated `hh.d.ts`: copied into the temporary home rather than kept in the fixture, where the typecheck
 * would read its `declare module`s as the real packages' types.
 */
const HH_DTS = path.resolve(HERE, "../../shell/scripts/hh.d.ts");

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-catalog-"));
  fs.cpSync(FIXTURE, root, { recursive: true });
  home = path.join(root, "app");
  fs.copyFileSync(HH_DTS, path.join(home, "hh.d.ts"));
});
afterEach(() => cleanup());

describe("catalog", () => {
  it("lists the mods of the three layers, each with its layer, parts and state", async () => {
    const c = await catalog(home);
    expect(c.mods.map((m) => [m.id, m.layer])).toEqual([
      ["home", "core"],
      ["notes", "harness"],
      ["hello", "user"],
    ]);
    const [home_, notes, hello] = c.mods;
    expect(home_).toMatchObject({ name: "Home", version: "0.1.0", description: "The screen the app opens on: recent tasks and a box to start one.", blocks: ["home"], hooks: [], settings: [], state: "on" });
    expect(notes).toMatchObject({ name: "Notes", version: "1.2.0", blocks: [], hooks: ["turnEnd", "taskOpen", "ipc list"], settings: ["folder", "keep"], state: "off" });
    expect(hello).toMatchObject({ blocks: ["hello", "wave"], clonedFrom: { id: "home", version: "0.1.0" }, state: "on" });
    expect(home_.error).toBeUndefined();
  });

  it("shows a user mod's .error", async () => {
    const hello = (await catalog(home)).mods.find((m) => m.id === "hello");
    expect(hello?.error).toBe(`ui.tsx.error: ui.tsx:3:10: Expected ";" but found "x"`);
  });

  it("lists the layouts of the three layers, the one settings.json picks shown", async () => {
    expect((await catalog(home)).layouts).toEqual([
      { name: "mine", layer: "user", shown: true },
      { name: "main", layer: "harness", shown: false },
      { name: "main", layer: "core", shown: false },
    ]);
    fs.rmSync(path.join(home, "settings.json"));
    expect((await catalog(home)).layouts.filter((l) => l.shown)).toEqual([{ name: "main", layer: "harness", shown: true }]);
    fs.rmSync(path.join(home, "harness", "layouts", "main.json"));
    expect((await catalog(home)).layouts.filter((l) => l.shown)).toEqual([{ name: "main", layer: "core", shown: true }]);
  });

  it("gives every state unknown without config.json", async () => {
    fs.rmSync(path.join(root, "config.json"));
    expect((await catalog(home)).mods.map((m) => m.state)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("turns a user mod on only when it is trusted", async () => {
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ mods: { on: { hello: true } } }));
    const c = await catalog(home);
    expect(c.mods.map((m) => [m.id, m.state])).toEqual([
      ["home", "on"],
      ["notes", "on"],
      ["hello", "off"],
    ]);
  });

  it("names what hh.d.ts exports, with each one's doc line", async () => {
    const { types } = await catalog(home);
    expect(types).toContainEqual({ module: "@humanharness/mod-sdk", name: "defineMod", doc: "Types a mod. `mod.json` stays the source of id, name and version; the host checks the ids match." });
    expect(types).toContainEqual(expect.objectContaining({ module: "@humanharness/mod-sdk", name: "MainCtx" }));
    expect(types).toContainEqual(expect.objectContaining({ module: "@humanharness/ui", name: "Rx" }));
    expect(types).toContainEqual(expect.objectContaining({ module: "@humanharness/ui", name: "BlockProps" }));
    expect(types.some((t) => t.name.includes("_internal") || t.module.includes("_internal"))).toBe(false);
  });

  it("has no types without hh.d.ts", async () => {
    fs.rmSync(path.join(home, "hh.d.ts"));
    expect((await catalog(home)).types).toEqual([]);
  });
});
