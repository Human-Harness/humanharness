import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HARNESS_ID } from "@humanharness/harness-sdk";
import { type Io, UsageError, parseCommand } from "./cli";
import { agentsFile, readGuide, skillFile } from "./guide";
import { CORE_DIR, cliDirOf, guideFileOf, templateDirOf } from "./paths";
import { TEMPLATE_ID } from "./template";

export interface InitOptions {
  dir: string;
  /** The core checkout to link to. Default: the one this CLI runs from. */
  core?: string;
  id?: string;
  /** false: no `pnpm install` and no `git init`; the CLI is linked directly (tests). */
  install?: boolean;
  today?: Date;
  log?: (line: string) => void;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** A harness id from a folder name: lowercase, anything else becomes a dash. */
export function idFromFolder(dir: string): string {
  return path
    .basename(path.resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function initHarness(o: InitOptions): Promise<{ dir: string; id: string; core: string }> {
  const dir = path.resolve(o.dir);
  const id = o.id ?? idFromFolder(dir);
  if (!HARNESS_ID.test(id)) {
    throw new UsageError(`"${id}" is not a valid harness id: use lowercase letters, digits and dashes, starting with a letter (or pass --id).`);
  }
  const core = path.resolve(o.core ?? CORE_DIR);
  const cliDir = cliDirOf(core);
  if (!(await exists(path.join(cliDir, "package.json")))) throw new UsageError(`${core} is not a Human Harness checkout (it has no packages/cli).`);
  const entries = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  if (entries.length > 0) throw new UsageError(`${dir} is not empty.`);

  await fs.mkdir(dir, { recursive: true });
  await copyTemplate(templateDirOf(core), dir, id);
  const date = (o.today ?? new Date()).toISOString().slice(0, 10);
  await fs.appendFile(
    path.join(dir, "HARNESS.md"),
    `\n- ${date} — Created from the Human Harness template with \`humanharness init\`. Reason: start from a harness that runs. Alternatives rejected: copying the demo, which is a reference, not a starting point.\n`,
  );
  await fs.writeFile(path.join(dir, "package.json"), `${JSON.stringify(await packageJson(dir, id, core), null, 2)}\n`);
  await fs.writeFile(path.join(dir, ".gitignore"), "node_modules/\n");
  const guide = await readGuide(guideFileOf(core));
  await fs.mkdir(path.join(dir, ".claude", "skills", "new-harness"), { recursive: true });
  await fs.writeFile(path.join(dir, ".claude", "skills", "new-harness", "SKILL.md"), skillFile(guide));
  await fs.writeFile(path.join(dir, "AGENTS.md"), agentsFile(id, guide));

  if (o.install === false) await linkCli(dir, cliDir);
  else {
    await runIn(dir, "corepack", ["pnpm", "install"]);
    await runIn(dir, "git", ["init"]);
  }
  const log = o.log ?? (() => {});
  log(`Created ${id} in ${dir}.`);
  log("Next: open Claude Code or Codex in that folder and run /new-harness.");
  log("Check it at any time with: corepack pnpm check");
  return { dir, id, core };
}

/** Copies the template, replacing the template's id with `id` in every file (all of them are text). */
async function copyTemplate(from: string, to: string, id: string): Promise<void> {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      await copyTemplate(source, target, id);
    } else if (entry.isFile()) {
      await fs.writeFile(target, (await fs.readFile(source, "utf8")).replaceAll(TEMPLATE_ID, id));
    }
  }
}

async function packageJson(dir: string, id: string, core: string) {
  const rel = path.relative(dir, cliDirOf(core));
  const link = path.isAbsolute(rel) ? cliDirOf(core) : rel.split(path.sep).join("/");
  const corePkg = JSON.parse(await fs.readFile(path.join(core, "package.json"), "utf8")) as { packageManager?: string };
  return {
    name: id,
    version: "0.1.0",
    private: true,
    type: "module",
    ...(corePkg.packageManager ? { packageManager: corePkg.packageManager } : {}),
    scripts: { check: "humanharness check", run: "humanharness run", dev: "humanharness dev" },
    dependencies: { "@humanharness/cli": `link:${link}` },
  };
}

/** What `pnpm install` makes of the `link:` dependency: node_modules/@humanharness/cli → <core>/packages/cli. */
async function linkCli(dir: string, cliDir: string): Promise<void> {
  const scope = path.join(dir, "node_modules", "@humanharness");
  await fs.mkdir(scope, { recursive: true });
  await fs.symlink(cliDir, path.join(scope, "cli"), "dir");
}

function runIn(cwd: string, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}

export async function initCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { core: { type: "string" }, id: { type: "string" }, "skip-install": { type: "boolean" } });
  if (positionals.length !== 1) throw new UsageError("Usage: humanharness init <dir> [--core <path>] [--id <id>]");
  await initHarness({
    dir: path.resolve(io.cwd, positionals[0]),
    ...(values.core ? { core: path.resolve(io.cwd, values.core) } : {}),
    ...(values.id ? { id: values.id } : {}),
    install: values["skip-install"] !== true,
    log: (line) => io.stdout.write(`${line}\n`),
  });
  return 0;
}
