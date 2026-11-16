import fs from "node:fs";
import path from "node:path";
import { SHARED_IMPORTS } from "@humanharness/mod-sdk/bundle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli";
import { catalog, checkMod, newMod } from "../src/kit";
import { read, tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-new-mod-"));
  home = path.join(root, "app");
  fs.mkdirSync(path.join(home, "core", "mods", "home"), { recursive: true });
  fs.mkdirSync(path.join(home, "harness", "mods", "notes"), { recursive: true });
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
});
afterEach(() => cleanup());

describe("newMod", () => {
  it("makes a mod that passes checkMod, with its id, name, description and block", { timeout: 120_000 }, async () => {
    const r = await newMod(home, { id: "greeter", name: `Say "hi"`, description: "Greets the person.", block: "card" });
    expect(r).toEqual({ id: "greeter", path: path.join(home, "mods", "greeter"), block: "card" });
    const json = JSON.parse(read(r.path, "mod.json")) as Record<string, unknown>;
    expect(json).toMatchObject({ id: "greeter", name: `Say "hi"`, version: "0.1.0", main: "main.ts", ui: "ui.tsx" });
    expect(read(r.path, "README.md")).toContain("Greets the person.");
    const check = await checkMod(home, "mods/greeter");
    expect(check.checks.filter((c) => !c.ok)).toEqual([]);
    expect(check.checks).toContainEqual({ name: "block card", ok: true, detail: "rendered" });
    const listed = (await catalog(home)).mods.find((m) => m.id === "greeter");
    expect(listed).toMatchObject({ layer: "user", name: `Say "hi"`, description: "Greets the person.", blocks: ["card"] });
  });

  it("names the block main by default", async () => {
    const r = await newMod(home, { id: "plain", name: "Plain", description: "Nothing much." });
    expect(r.block).toBe("main");
    expect(read(r.path, "ui.tsx")).toContain(`ctx.block("main"`);
  });

  it("refuses a bad id, an existing folder, and a core or harness mod's id", async () => {
    await expect(newMod(home, { id: "Bad id", name: "X", description: "" })).rejects.toThrow(CliError);
    await expect(newMod(home, { id: "x".repeat(49), name: "X", description: "" })).rejects.toThrow("isn't a valid mod id");
    await newMod(home, { id: "taken", name: "X", description: "" });
    await expect(newMod(home, { id: "taken", name: "X", description: "" })).rejects.toThrow("already exists");
    await expect(newMod(home, { id: "home", name: "X", description: "" })).rejects.toThrow("mod_clone");
    await expect(newMod(home, { id: "notes", name: "X", description: "" })).rejects.toThrow("mod_clone");
    await expect(newMod(home, { id: "ok", name: "X", description: "", block: "no spaces" })).rejects.toThrow("block");
  });

  it("has a README that names every import the home folder's AGENTS.md allows", async () => {
    const r = await newMod(home, { id: "readme", name: "Readme", description: "d" });
    const text = read(r.path, "README.md");
    for (const spec of SHARED_IMPORTS) expect(text).toContain(`\`${spec}\``);
    expect(text).not.toMatch(/__[A-Z]+__/);
  });
});
