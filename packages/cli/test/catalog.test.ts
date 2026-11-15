import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalog } from "../src/kit";
import { CORE, tempRoot } from "./helpers";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "home-kit");
const HH_DTS = path.join(CORE, "packages", "shell", "scripts", "hh.d.ts");

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-catalog-"));
  fs.cpSync(FIXTURE, root, { recursive: true });
  home = path.join(root, "app");
  // The real manual's types: a .d.ts in the repo's test folders would join the typecheck as ambient modules.
  fs.copyFileSync(HH_DTS, path.join(home, "hh.d.ts"));
});
afterEach(() => cleanup());

describe("catalog", () => {
  it("lists the mods of the three layers with their layer, parts and state", async () => {
    const c = await catalog(home);
    expect(c.mods.map((m) => [m.id, m.layer])).toEqual([
      ["home", "core"],
      ["clock", "harness"],
      ["notes", "user"],
    ]);
    const [home_, clock, notes] = c.mods;
    expect(home_).toMatchObject({ name: "Home", version: "0.1.0", description: "The first screen: recent tasks and a way to start one.", blocks: ["home"], hooks: [], state: "on" });
    expect(clock).toMatchObject({ name: "Clock", description: "Shows the time a task has run.", blocks: ["clock", "timer"], hooks: ["turnEnd"], settings: ["format"], state: "off" });
    expect(notes).toMatchObject({ blocks: ["notes", "note-count"], hooks: ["beforeSend", "taskOpen"], clonedFrom: { id: "home", version: "0.1.0" }, state: "on" });
    expect(home_?.clonedFrom).toBeUndefined();
  });

  it("shows a user mod's .error", async () => {
    const notes = (await catalog(home)).mods.find((m) => m.id === "notes");
    expect(notes?.error).toBe('ui.js: Could not resolve "left-pad"');
    expect((await catalog(home)).mods.find((m) => m.id === "home")?.error).toBeUndefined();
  });

  it("a user mod on in config.json but not trusted is off", async () => {
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ mods: { on: { notes: true } } }));
    expect((await catalog(home)).mods.find((m) => m.id === "notes")?.state).toBe("off");
  });

  it("lists the layouts of the three layers and marks the shown one from settings.json", async () => {
    let c = await catalog(home);
    expect(c.layouts).toEqual([
      { name: "wide", layer: "user", shown: false },
      { name: "main", layer: "core", shown: true },
    ]);
    fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ layout: "wide" }));
    c = await catalog(home);
    expect(c.layouts).toEqual([
      { name: "wide", layer: "user", shown: true },
      { name: "main", layer: "core", shown: false },
    ]);
  });

  it("a harness main is shown over the core's when settings.json picks none", async () => {
    fs.mkdirSync(path.join(home, "harness", "layouts"), { recursive: true });
    fs.copyFileSync(path.join(home, "core", "layouts", "main.json"), path.join(home, "harness", "layouts", "main.json"));
    expect((await catalog(home)).layouts.filter((l) => l.shown)).toEqual([{ name: "main", layer: "harness", shown: true }]);
  });

  it("without config.json every state is unknown", async () => {
    fs.rmSync(path.join(root, "config.json"));
    expect((await catalog(home)).mods.map((m) => m.state)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("names what hh.d.ts exports, with the one-line docs", async () => {
    const { types } = await catalog(home);
    expect(types).toContainEqual({ name: "defineMod", module: "@humanharness/mod-sdk", doc: expect.stringContaining("Types a mod") });
    expect(types).toContainEqual(expect.objectContaining({ name: "MOD_ID", module: "@humanharness/mod-sdk" }));
    expect(types).toContainEqual(expect.objectContaining({ name: "BlockProps", module: "@humanharness/ui" }));
    expect(types).toContainEqual(expect.objectContaining({ name: "Rx", module: "@humanharness/ui" }));
    expect(types.some((t) => t.name === "BlockRegistry")).toBe(false);
  });

  it("has no types without hh.d.ts", async () => {
    fs.rmSync(path.join(home, "hh.d.ts"));
    expect((await catalog(home)).types).toEqual([]);
  });
});
