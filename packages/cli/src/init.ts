import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HARNESS_ID } from "@humanharness/harness-sdk";
import { CliError, type Io, UsageError, parseCommand } from "./cli";
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
  /** Runs a setup command (`pnpm install`, `git init`) in the new repo. Default: spawns it. */
  run?: Runner;
}

export type Runner = (cwd: string, command: string, args: string[]) => Promise<void>;

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

  const log = o.log ?? (() => {});
  await fs.mkdir(dir, { recursive: true });
  await copyTemplate(templateDirOf(core), dir, id, log);
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
  else await setUp(dir, o.run ?? runIn);
  log(`Created ${id} in ${dir}.`);
  log("Next: open Claude Code or Codex in that folder and run /new-harness.");
  log("Check it at any time with: corepack pnpm check");
  return { dir, id, core };
}

const SETUP: [command: string, args: string[]][] = [
  ["corepack", ["pnpm", "install"]],
  ["git", ["init"]],
];

/** Installs and starts git; on a failure, says the files are there and what is left to run by hand. */
async function setUp(dir: string, run: Runner): Promise<void> {
  for (const [i, [command, args]] of SETUP.entries()) {
    try {
      await run(dir, command, args);
    } catch (err) {
      const left = SETUP.slice(i).map(([c, a]) => `  ${c} ${a.join(" ")}`);
      throw new CliError(
        [
          `The files were created at ${dir}, but \`${command} ${args.join(" ")}\` failed: ${err instanceof Error ? err.message : String(err)}`,
          "Finish by hand in that folder:",
          `  cd ${JSON.stringify(dir)}`,
          ...left,
        ].join("\n"),
      );
    }
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Copies the template byte for byte, replacing the template's id with `id` in the text files that contain it. Symlinks are copied as symlinks. */
async function copyTemplate(from: string, to: string, id: string, log: (line: string) => void): Promise<void> {
  const placeholder = Buffer.from(TEMPLATE_ID);
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      await copyTemplate(source, target, id, log);
    } else if (entry.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(source), target);
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(source);
      await fs.writeFile(target, bytes.includes(placeholder) ? replaceInText(bytes, id) : bytes);
    } else log(`Skipped ${path.relative(to, target) || entry.name}: not a file, folder or symlink.`);
  }
}

/** The file with the template's id replaced; unchanged when it isn't UTF-8 text. */
function replaceInText(bytes: Buffer, id: string): Buffer | string {
  try {
    return utf8.decode(bytes).replaceAll(TEMPLATE_ID, id);
  } catch {
    return bytes;
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

const runIn: Runner = (cwd, command, args) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
};

export async function initCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { core: { type: "string" }, id: { type: "string" }, "skip-install": { type: "boolean" } });
  if (positionals.length !== 1) throw new UsageError("Usage: humanharness init <dir> [--core <path>] [--id <id>] [--skip-install]");
  await initHarness({
    dir: path.resolve(io.cwd, positionals[0]),
    ...(values.core ? { core: path.resolve(io.cwd, values.core) } : {}),
    ...(values.id ? { id: values.id } : {}),
    install: values["skip-install"] !== true,
    log: (line) => io.stdout.write(`${line}\n`),
  });
  return 0;
}
