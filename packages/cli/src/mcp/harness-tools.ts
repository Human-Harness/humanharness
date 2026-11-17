import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Finding, checkHarness } from "../check";
import { CliError } from "../cli";
import { type Runner, initHarness } from "../init";
import { isHarnessProject } from "../kit";
import { MANIFEST } from "../paths";

/**
 * Runs a setup command with its output kept off stdout (the MCP transport); on a failure, its last lines of stderr
 * are the reason.
 */
const quietRun: Runner = (cwd, command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + String(chunk)).slice(-2000);
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}${err.trim() ? `: ${err.trim().split("\n").slice(-3).join(" ")}` : ""}`))));
  });

/** The files under `dir`, relative with `/`, without node_modules and .git. */
async function filesOf(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => !e.isDirectory())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((f) => !f.split("/").some((part) => part === "node_modules" || part === ".git"))
    .sort();
}

export interface HarnessInit {
  dir: string;
  id: string;
  core: string;
  /** Whether `pnpm install` and `git init` ran. */
  installed: boolean;
  files: string[];
  next: string;
}

/**
 * `humanharness init` into the mode's folder (empty or new), linked to `core`. Without `install` it runs neither
 * `pnpm install` nor `git init` and links the CLI directly, so `harness_check` works at once.
 */
export async function harnessInit(dir: string, core: string, o: { id?: string; install: boolean }): Promise<HarnessInit> {
  const made = await initHarness({ dir, core, ...(o.id !== undefined ? { id: o.id } : {}), install: o.install, run: quietRun });
  const guide = "Then follow the /new-harness guide (AGENTS.md has it) from its first phase, and run harness_check after each change.";
  const next = o.install
    ? guide
    : `Left to run in ${made.dir}, by the person or by you with their OK: \`corepack pnpm install\` and \`git init\`. ${guide}`;
  return { dir: made.dir, id: made.id, core: made.core, installed: o.install, files: await filesOf(made.dir), next };
}

/** `humanharness check` as data: errors and warnings, and the notes it would print. */
export async function harnessCheck(dir: string): Promise<{ ok: boolean; errors: Finding[]; warnings: Finding[]; notes: string[] }> {
  if (!isHarnessProject(dir)) throw new CliError(`${dir} has no ${MANIFEST}: make the harness with harness_init first`);
  const notes: string[] = [];
  const note = (line: string) => void notes.splice(notes.length, 0, line);
  const { findings } = await checkHarness(dir, { fixtures: { note }, note });
  const errors = findings.filter((f) => f.severity === "error");
  return { ok: errors.length === 0, errors, warnings: findings.filter((f) => f.severity === "warning"), notes };
}
