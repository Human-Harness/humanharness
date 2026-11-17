import fs from "node:fs";
import path from "node:path";
import { layoutSchema } from "@humanharness/mod-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initHarness } from "../src/init";
import { checkMod, cloneLayout, cloneMod, harnessCatalog, newMod } from "../src/kit";
import { CORE, read, tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let dir: string;
let manifest: string;
const kit = () => ({ harness: dir, core: CORE });

beforeEach(async () => {
  ({ root, cleanup } = tempRoot("hh-harness-kit-"));
  dir = path.join(root, "proj");
  await initHarness({ dir, core: CORE, install: false });
  manifest = read(dir, "harness.config.ts");
});
afterEach(() => cleanup());

describe("harnessCatalog", () => {
  it("lists the core mods with their parts, the core layout, and the project's own mods and layouts", async () => {
    const c = await harnessCatalog(dir, CORE);
    if (!c.project) throw new Error("expected a project");
    const home = c.coreMods.find((m) => m.id === "home");
    expect(home).toMatchObject({ id: "home", name: "Home", blocks: ["home"], declared: false });
    expect(home?.readme).toContain("The screen the app opens on");
    expect(c.coreLayouts).toEqual([{ name: "main", file: path.join(CORE, "packages", "shell", "src", "main", "mods", "default-layout.json") }]);
    expect(c.mods).toEqual([expect.objectContaining({ id: "example", blocks: ["card"], declared: true })]);
    expect(c.layouts).toEqual([{ name: "main" }]);
    expect(c.declared).toEqual(["example"]);
  });

  it("says there is no project yet, and that harness_init makes one", async () => {
    const c = await harnessCatalog(path.join(root, "empty"), CORE);
    expect(c).toMatchObject({ project: false });
    expect(JSON.stringify(c)).toContain("harness_init");
  });
});

describe("the mod tools in a harness project", () => {
  it("makes a mod in the project's mods/ that checkMod passes", { timeout: 120_000 }, async () => {
    const r = await newMod(kit(), { id: "greeter", name: "Greeter", description: "Greets." });
    expect(r.path).toBe(path.join(dir, "mods", "greeter"));
    const check = await checkMod(kit(), "mods/greeter");
    expect(check.checks.filter((x) => !x.ok)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("clones a core mod into the project's mods/ with clonedFrom", async () => {
    const r = await cloneMod(kit(), "home", "my-home");
    expect(r).toMatchObject({ id: "my-home", path: path.join(dir, "mods", "my-home"), source: path.join("packages", "mods", "home") });
    const json = JSON.parse(read(r.path, "mod.json")) as Record<string, unknown>;
    expect(json).toMatchObject({ id: "my-home", clonedFrom: { id: "home", version: r.clonedFrom.version } });
    expect(fs.existsSync(path.join(r.path, "node_modules"))).toBe(false);
  });

  it("clones the core's layout into the project's layouts/, valid", async () => {
    const r = await cloneLayout(kit(), "main", "wide");
    expect(r).toMatchObject({ name: "wide", path: path.join(dir, "layouts", "wide.json") });
    expect(layoutSchema.safeParse(JSON.parse(read(dir, "layouts/wide.json"))).success).toBe(true);
  });

  it("refuses an existing folder, a core mod's id for a new mod, and what the core doesn't have", async () => {
    await expect(newMod(kit(), { id: "home", name: "X", description: "" })).rejects.toThrow("mod_clone");
    await expect(newMod(kit(), { id: "example", name: "X", description: "" })).rejects.toThrow("already exists");
    await expect(cloneMod(kit(), "example", "copy")).rejects.toThrow("No core mod example");
    await expect(cloneMod(kit(), "home", "example")).rejects.toThrow("already exists");
    await expect(cloneLayout(kit(), "main")).rejects.toThrow("already exists");
    await expect(cloneLayout(kit(), "side", "x")).rejects.toThrow("No core layout side");
  });

  it("never writes harness.config.ts", async () => {
    await newMod(kit(), { id: "a", name: "A", description: "" });
    await cloneMod(kit(), "home", "b");
    await cloneLayout(kit(), "main", "c");
    expect(read(dir, "harness.config.ts")).toBe(manifest);
  });
});
