import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/cli";
import { pluginAgentsFile, pluginGuideSection, pluginSkillFile, readGuide } from "../src/guide";
import { main } from "../src/main";
import { pluginGuideFileOf, pluginTemplateDirOf } from "../src/paths";
import { buildPlugin } from "../src/plugin-build";
import { checkPlugin } from "../src/plugin-check";
import { initPlugin } from "../src/plugin-init";
import { CORE, memoryIo, read, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-plugin-init-");
afterAll(cleanup);

/** Every file under `dir`, relative, sorted. */
function files(dir: string, rel = ""): string[] {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]))
    .sort();
}

describe("humanharness plugin init: the fresh template", () => {
  const dir = path.join(root, "my-items");
  let out = "";

  beforeAll(async () => {
    const r = memoryIo(root);
    expect(await main(["plugin", "init", "my-items"], r.io)).toBe(0);
    out = r.out();
  }, 60_000);

  it("copies the template with the id, the name and the harness filled in", () => {
    const config = read(dir, "plugin.config.ts");
    expect(config).toContain('id: "my-items"');
    expect(config).toContain('name: "My items"');
    expect(config).toContain('harness: "*"');
    // The example every /new-plugin agent copies: an action proposes, and writes nothing without the person's yes.
    expect(config).toContain("change nothing outside the app without asking");
    expect(read(dir, "PLUGIN.md")).toMatch(/^# My items\n/);
    for (const f of files(dir)) expect(read(dir, f), f).not.toMatch(/__(ID|NAME|HARNESS)__/);
    expect(files(dir)).toEqual(
      expect.arrayContaining([".gitignore", "PLUGIN.md", "README.md", "backend.ts", "fixtures/items/001.json", "panels/main.tsx", "plugin.config.ts", "tsconfig.json"]),
    );
  });

  it("keeps dist/ in git: the .gitignore doesn't name it", () => {
    expect(read(dir, ".gitignore")).not.toMatch(/dist/);
  });

  it("installs the guide as the new-plugin skill and in AGENTS.md between the plugin markers", async () => {
    const guide = await readGuide(pluginGuideFileOf(CORE));
    expect(read(dir, ".claude/skills/new-plugin/SKILL.md")).toBe(pluginSkillFile(guide));
    expect(read(dir, "AGENTS.md")).toBe(pluginAgentsFile("my-items", guide));
    expect(pluginGuideSection(read(dir, "AGENTS.md"))).toBe(guide);
  });

  it("prints the next steps", () => {
    expect(out).toContain(`Created the plugin my-items in ${dir}.`);
    expect(out).toContain("/new-plugin");
    expect(out).toContain("humanharness plugin dev --harness <harness folder>");
  });

  it("builds, checks with no finding at all, and tests green on its fixture", async () => {
    const built = await buildPlugin(dir);
    expect(built.manifest).toMatchObject({ id: "my-items", name: "My items", harness: "*" });
    expect(built.files).toEqual(expect.arrayContaining(["plugin.json", "backend.js", "panel-main.html", "panel-main.js", "panel-main.css"]));
    const { findings } = await checkPlugin(dir, { build: false });
    expect(findings).toEqual([]);
    const r = memoryIo(dir);
    expect(await main(["plugin", "test"], r.io)).toBe(0);
    expect(r.out()).toContain("items: ok");
    expect(r.out()).toContain("items: 3 records");
    expect(r.out()).toContain("count: 3 items");
  }, 120_000);
});

describe("humanharness plugin init: options and refusals", () => {
  it("--harness and --name fill the manifest; a $ in the name stays literal", async () => {
    const dir = path.join(root, "named");
    await initPlugin({ dir, harness: "demo", name: "Team $& queue" });
    const config = read(dir, "plugin.config.ts");
    expect(config).toContain('name: "Team $& queue"');
    expect(config).toContain('harness: "demo"');
  });

  it("creates a missing folder, and an empty one is fine", async () => {
    fs.mkdirSync(path.join(root, "empty"));
    await initPlugin({ dir: path.join(root, "empty") });
    await initPlugin({ dir: path.join(root, "deep", "er", "new-one") });
    expect(fs.existsSync(path.join(root, "deep", "er", "new-one", "plugin.config.ts"))).toBe(true);
  });

  it("refuses a folder that isn't empty and leaves it as it was", async () => {
    const dir = path.join(root, "busy");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    await expect(initPlugin({ dir })).rejects.toThrow(UsageError);
    expect(fs.readdirSync(dir)).toEqual(["notes.txt"]);
    expect(read(dir, "notes.txt")).toBe("mine");
  });

  it("refuses a folder name that isn't a plugin id, and says what to do", async () => {
    await expect(initPlugin({ dir: path.join(root, "My Plugin") })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "My Plugin") })).rejects.toThrow(/--name/);
    expect(fs.existsSync(path.join(root, "My Plugin"))).toBe(false);
    const r = memoryIo(root);
    expect(await main(["plugin", "init", "Bad_Name"], r.io)).toBe(2);
    expect(r.err()).toContain('"Bad_Name" is not a valid plugin id');
  });

  it("refuses a harness id or a name the manifest would refuse", async () => {
    await expect(initPlugin({ dir: path.join(root, "h1"), harness: "Demo" })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "n1"), name: 'say "hi"' })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "n2"), name: "a‮b" })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "n3"), name: "x".repeat(61) })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "n4"), name: "  " })).rejects.toThrow(UsageError);
    await expect(initPlugin({ dir: path.join(root, "n5"), name: "Claude helper" })).rejects.toThrow(/provider or model/);
    for (const n of ["n1", "n2", "n3", "n4", "n5"]) expect(fs.existsSync(path.join(root, n))).toBe(false);
    for (const d of ["h1", "n1", "n2", "n3", "n4"]) expect(fs.existsSync(path.join(root, d))).toBe(false);
  });

  it("a placeholder in the name stays literal: one pass", async () => {
    const dir = path.join(root, "one-pass");
    await initPlugin({ dir, name: "My __HARNESS__ __ID__" });
    expect(read(dir, "plugin.config.ts")).toContain('name: "My __HARNESS__ __ID__"');
  });

  it("refuses a file or a link to nothing as the folder, with a usage error, and writes nothing", async () => {
    const file = path.join(root, "a-file");
    fs.writeFileSync(file, "keep");
    await expect(initPlugin({ dir: file })).rejects.toThrow(UsageError);
    expect(fs.readFileSync(file, "utf8")).toBe("keep");
    const link = path.join(root, "dangling");
    fs.symlinkSync(path.join(root, "nowhere"), link);
    await expect(initPlugin({ dir: link })).rejects.toThrow(UsageError);
    expect(fs.existsSync(path.join(root, "nowhere"))).toBe(false);
  });

  it("takes exactly one folder", async () => {
    const r = memoryIo(root);
    expect(await main(["plugin", "init"], r.io)).toBe(2);
    expect(r.err()).toContain("Usage: humanharness plugin init <dir>");
    expect(await main(["plugin", "init", "a", "b"], memoryIo(root).io)).toBe(2);
  });

  it("--help prints the usage", async () => {
    const r = memoryIo(root);
    expect(await main(["plugin", "init", "--help"], r.io)).toBe(0);
    expect(r.out()).toContain("Usage: humanharness plugin init <dir> [--harness <id>] [--name <name>]");
  });
});

describe("the plugin template", () => {
  const template = pluginTemplateDirOf(CORE);

  it("holds no token-looking string", () => {
    for (const f of files(template)) expect(read(template, f), f).not.toMatch(/[A-Za-z0-9]{32,}/);
  });

  it("has no dist/ and no node_modules/ of its own", () => {
    expect(files(template).some((f) => f.startsWith("dist") || f.includes("node_modules"))).toBe(false);
  });
});
