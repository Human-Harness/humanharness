import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadHarness } from "@humanharness/harness-sdk";
import { CliError } from "../src/cli";
import { guideSection, skillFile } from "../src/guide";
import { idFromFolder, initHarness } from "../src/init";
import { main } from "../src/main";
import { TEMPLATE_ID } from "../src/template";
import { CORE, memoryIo, read, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-init-");
afterAll(cleanup);
const guide = read(path.join(CORE, "packages", "cli", "guide"), "new-harness.md");
const files = (dir: string) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !path.join(e.parentPath, e.name).includes(`${path.sep}node_modules${path.sep}`))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));

describe("initHarness", () => {
  it("creates a harness repo from the template, linked to the core, with the guide installed", async () => {
    const dir = path.join(root, "My Harness");
    const r = await initHarness({ dir, core: CORE, install: false, today: new Date("2026-10-12T10:00:00Z") });
    expect(r).toEqual({ dir, id: "my-harness", core: CORE });

    const pkg = JSON.parse(read(dir, "package.json"));
    expect(pkg.name).toBe("my-harness");
    expect(pkg.dependencies).toEqual({ "@humanharness/cli": `link:${path.relative(dir, path.join(CORE, "packages", "cli"))}` });
    expect(pkg.scripts).toEqual({ check: "humanharness check", run: "humanharness run", dev: "humanharness dev" });
    expect(pkg.packageManager).toBe(JSON.parse(read(CORE, "package.json")).packageManager);

    for (const file of files(dir)) expect(read(dir, file), file).not.toContain(TEMPLATE_ID);
    expect(read(dir, "HARNESS.md")).toMatch(/^# my-harness\n/);
    expect(read(dir, "HARNESS.md").trimEnd()).toMatch(/\n- 2026-10-12 — Created from the Human Harness template with `humanharness init`\..+$/);
    expect(read(dir, ".claude/skills/new-harness/SKILL.md")).toBe(skillFile(guide));
    expect(guideSection(read(dir, "AGENTS.md"))).toBe(guide);
    expect(read(dir, ".gitignore")).toBe("node_modules/\n");
    expect(fs.realpathSync(path.join(dir, "node_modules", "@humanharness", "cli"))).toBe(fs.realpathSync(path.join(CORE, "packages", "cli")));

    const h = await loadHarness(path.join(dir, "harness.config.ts"));
    expect(h.id).toBe("my-harness");
    expect(h.name).toBe("my-harness");
    expect(h.folder.suggested).toBe("Documents/my-harness");
  });

  it("takes the id from --id", async () => {
    const r = await initHarness({ dir: path.join(root, "whatever"), id: "meal-planner", core: CORE, install: false });
    expect(r.id).toBe("meal-planner");
  });

  it("refuses a folder that isn't empty", async () => {
    const dir = path.join(root, "busy");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    await expect(initHarness({ dir, core: CORE, install: false })).rejects.toThrow(/is not empty/);
  });

  it("refuses an invalid id, from the folder name or from --id", async () => {
    await expect(initHarness({ dir: path.join(root, "123"), core: CORE, install: false })).rejects.toThrow(/not a valid harness id/);
    await expect(initHarness({ dir: path.join(root, "ok"), id: "Bad_Id", core: CORE, install: false })).rejects.toThrow(/not a valid harness id/);
    expect(fs.existsSync(path.join(root, "ok"))).toBe(false);
  });

  it("refuses a core that isn't a Human Harness checkout", async () => {
    await expect(initHarness({ dir: path.join(root, "x"), core: root, install: false })).rejects.toThrow(/not a Human Harness checkout/);
  });

  it("a failing install keeps the files and says which commands to run by hand", async () => {
    const dir = path.join(root, "offline");
    const ran: string[] = [];
    const run = async (_cwd: string, command: string, args: string[]) => {
      ran.push(`${command} ${args.join(" ")}`);
      throw new Error("spawn corepack ENOENT");
    };
    const err = await initHarness({ dir, core: CORE, run }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain(`The files were created at ${dir}`);
    expect((err as Error).message).toContain("spawn corepack ENOENT");
    expect((err as Error).message).toContain("corepack pnpm install");
    expect((err as Error).message).toContain("git init");
    expect(ran).toEqual(["corepack pnpm install"]);
    expect(fs.existsSync(path.join(dir, "harness.config.ts"))).toBe(true);

    const gitFails = async (_cwd: string, command: string) => {
      if (command === "git") throw new Error("git init exited with 128");
    };
    const failing = await initHarness({ dir: path.join(root, "offline-git"), core: CORE, run: gitFails }).catch((e: unknown) => e);
    expect(failing).toBeInstanceOf(CliError);
    expect((failing as Error).message).not.toContain("pnpm install");
    expect((failing as Error).message).toMatch(/\n\s+git init/);
  });

  it("copies binary files byte for byte and keeps symlinks", async () => {
    // A minimal core: what init reads from a checkout.
    const core = path.join(root, "core-copy");
    const cli = path.join(core, "packages", "cli");
    fs.mkdirSync(cli, { recursive: true });
    fs.copyFileSync(path.join(CORE, "package.json"), path.join(core, "package.json"));
    fs.copyFileSync(path.join(CORE, "packages", "cli", "package.json"), path.join(cli, "package.json"));
    fs.cpSync(path.join(CORE, "packages", "cli", "guide"), path.join(cli, "guide"), { recursive: true });
    fs.cpSync(path.join(CORE, "packages", "cli", "template"), path.join(cli, "template"), { recursive: true });
    const template = path.join(cli, "template");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
    fs.writeFileSync(path.join(template, "logo.png"), bytes);
    fs.symlinkSync("README.md", path.join(template, "LINK.md"));
    const dir = path.join(root, "bytes");
    await initHarness({ dir, core, install: false });
    expect(fs.readFileSync(path.join(dir, "logo.png")).equals(bytes)).toBe(true);
    expect(fs.readlinkSync(path.join(dir, "LINK.md"))).toBe("README.md");
  });

  it("derives the id from the folder name", () => {
    expect(idFromFolder("/a/My Meal  Planner!")).toBe("my-meal-planner");
  });
});

describe("humanharness init", () => {
  it("creates the repo and prints the next step", async () => {
    const m = memoryIo(root);
    expect(await main(["init", "cli-made", "--core", CORE, "--skip-install"], m.io)).toBe(0);
    expect(fs.existsSync(path.join(root, "cli-made", "harness.config.ts"))).toBe(true);
    expect(m.out()).toContain("run /new-harness");
  });

  it("needs a folder", async () => {
    const m = memoryIo(root);
    expect(await main(["init"], m.io)).toBe(2);
    expect(m.err()).toContain("Usage: humanharness init <dir> [--core <path>] [--id <id>] [--skip-install]");
  });
});
