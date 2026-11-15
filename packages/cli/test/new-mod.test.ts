import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli";
import { checkMod, newMod } from "../src/kit";
import { SHARED_IMPORTS } from "@humanharness/mod-sdk/bundle";
import { tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-new-mod-"));
  home = path.join(root, "app");
  fs.mkdirSync(path.join(home, "core", "mods", "home"), { recursive: true });
  fs.writeFileSync(path.join(home, "core", "mods", "home", "mod.json"), "{}");
  fs.mkdirSync(path.join(home, "harness", "mods", "clock"), { recursive: true });
  fs.writeFileSync(path.join(home, "harness", "mods", "clock", "mod.json"), "{}");
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
});
afterEach(() => cleanup());

const read = (...p: string[]) => fs.readFileSync(path.join(home, ...p), "utf8");

describe("newMod", { timeout: 120_000 }, () => {
  it("copies the template into mods/<id> and the new mod passes checkMod", async () => {
    const r = await newMod(home, { id: "greeter", name: "Greeter", description: "Says hello on the home screen." });
    expect(r).toEqual({ id: "greeter", path: path.join(home, "mods", "greeter"), block: "main", files: ["README.md", "main.ts", "mod.json", "ui.tsx"] });
    expect(JSON.parse(read("mods", "greeter", "mod.json"))).toEqual({ id: "greeter", name: "Greeter", version: "0.1.0", apiVersion: 1, main: "main.ts", ui: "ui.tsx" });
    expect(read("mods", "greeter", "README.md")).toContain("Says hello on the home screen.");
    const check = await checkMod(home, "mods/greeter");
    expect(check.checks).toContainEqual({ name: "block main", ok: true, detail: "rendered" });
    expect(check.ok).toBe(true);
  });

  it("names the block as asked", async () => {
    await newMod(home, { id: "greeter", name: "Greeter", description: "Hi.", block: "card" });
    expect(read("mods", "greeter", "ui.tsx")).toContain(`ctx.block("card"`);
    expect((await checkMod(home, "mods/greeter")).checks).toContainEqual({ name: "block card", ok: true, detail: "rendered" });
  });

  it("refuses a bad id, an existing folder, and a core or harness mod's id", async () => {
    await expect(newMod(home, { id: "Bad_Id", name: "X", description: "" })).rejects.toThrow(CliError);
    await expect(newMod(home, { id: "a".repeat(41), name: "X", description: "" })).rejects.toThrow(CliError);
    await expect(newMod(home, { id: "home", name: "X", description: "" })).rejects.toThrow(/mod_clone/);
    await expect(newMod(home, { id: "clock", name: "X", description: "" })).rejects.toThrow(/mod_clone/);
    fs.mkdirSync(path.join(home, "mods", "taken"), { recursive: true });
    await expect(newMod(home, { id: "taken", name: "X", description: "" })).rejects.toThrow(/already exists/);
    await expect(newMod(home, { id: "ok", name: "X", description: "", block: "" })).rejects.toThrow(CliError);
    expect(fs.existsSync(path.join(home, "mods", "ok"))).toBe(false);
  });

  it("writes a name with quotes safely", async () => {
    await newMod(home, { id: "quoted", name: `Say "hi"`, description: "x" });
    expect(JSON.parse(read("mods", "quoted", "mod.json")).name).toBe(`Say "hi"`);
    expect((await checkMod(home, "mods/quoted")).ok).toBe(true);
  });

  it("the README names every import AGENTS.md allows", async () => {
    await newMod(home, { id: "greeter", name: "Greeter", description: "Hi." });
    const readme = read("mods", "greeter", "README.md");
    for (const spec of SHARED_IMPORTS) expect(readme).toContain(`\`${spec}\``);
  });
});
