import { promises as fs } from "node:fs";
import path from "node:path";
import { HARNESS_ID, HIDDEN_CHARS, PLUGIN_ID } from "@humanharness/harness-sdk";
import { findBrand } from "./check";
import { type Io, UsageError, parseCommand } from "./cli";
import { pluginAgentsFile, pluginSkillFile, readGuide } from "./guide";
import { CORE_DIR, cliDirOf, pluginGuideFileOf, pluginTemplateDirOf } from "./paths";

export const INIT_USAGE = [
  "Usage: humanharness plugin init <dir> [--harness <id>] [--name <name>]",
  "",
  "Creates a plugin in <dir> (a new or empty folder) from the template and installs the /new-plugin guide.",
  "The folder's name is the plugin's id. --harness names the harness it is built for (default: any, \"*\");",
  "--name is the name the person sees (default: from the id).",
  "",
].join("\n");

export interface PluginInitOptions {
  dir: string;
  /** The core checkout whose template and guide are used. Default: the one this CLI runs from. */
  core?: string;
  /** A harness id, or "*" (default) for any harness. */
  harness?: string;
  /** The plugin's display name. Default: from the id ("my-items" → "My items"). */
  name?: string;
  today?: Date;
  log?: (line: string) => void;
}

/** The template's placeholders, replaced in every text file it copies, in one pass (a value holding one stays literal). */
const PLACEHOLDERS = ["__ID__", "__NAME__", "__HARNESS__"] as const;
const PLACEHOLDER = /__(?:ID|NAME|HARNESS)__/g;

/** "my-items" → "My items". */
export const nameFromId = (id: string) => {
  const words = id.replace(/-+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The display name, checked here as plugin.json would (at most 60 characters, nothing hidden), and also free of `"` and
 * `\`, since it lands inside a string in plugin.config.ts.
 */
function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 60) throw new UsageError("--name: the plugin's name is 1 to 60 characters.");
  if (HIDDEN_CHARS.test(trimmed) || /["\\]/.test(trimmed)) throw new UsageError('--name: the plugin\'s name can\'t hold quotes ("), backslashes or hidden characters.');
  const brand = findBrand(trimmed);
  if (brand) throw new UsageError(`--name: a plugin's name can't name a provider or model ("${brand}").`);
  return trimmed;
}

/** `humanharness plugin init` (plugins spec §9.1): the template, filled in, plus the guide. Never writes over a file. */
export async function initPlugin(o: PluginInitOptions): Promise<{ dir: string; id: string }> {
  const dir = path.resolve(o.dir);
  const id = path.basename(dir);
  if (!PLUGIN_ID.test(id)) {
    throw new UsageError(
      `"${id}" is not a valid plugin id. The folder's name is the plugin's id: lowercase letters, digits and dashes, starting with a letter or digit (e.g. my-items). Pick such a folder name, and set the name the person sees with --name.`,
    );
  }
  const harness = o.harness ?? "*";
  if (harness !== "*" && !HARNESS_ID.test(harness)) throw new UsageError(`--harness: "${harness}" is not a harness id (lowercase letters, digits and dashes) or "*".`);
  const name = checkName(o.name ?? nameFromId(id));
  const core = path.resolve(o.core ?? CORE_DIR);
  if (!(await fs.stat(path.join(cliDirOf(core), "package.json")).catch(() => null))) throw new UsageError(`${core} is not a Human Harness checkout (it has no packages/cli).`);
  const entries = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    if (err.code === "ENOTDIR") throw new UsageError(`${dir} is a file: plugin init only writes into a new or empty folder.`);
    throw err;
  });
  // A link to nothing reads as missing, and mkdir would then fail on it.
  if (entries.length === 0 && (await fs.lstat(dir).catch(() => null))?.isSymbolicLink() && !(await fs.stat(dir).catch(() => null))) {
    throw new UsageError(`${dir} is a link to nothing: plugin init only writes into a new or empty folder.`);
  }
  if (entries.length > 0) throw new UsageError(`${dir} is not empty: plugin init only writes into a new or empty folder.`);
  const guide = await readGuide(pluginGuideFileOf(core));

  const values: Record<(typeof PLACEHOLDERS)[number], string> = { __ID__: id, __NAME__: name, __HARNESS__: harness };
  const log = o.log ?? (() => {});
  await fs.mkdir(dir, { recursive: true });
  await copyTemplate(pluginTemplateDirOf(core), dir, values, log);
  const date = (o.today ?? new Date()).toISOString().slice(0, 10);
  await fs.appendFile(
    path.join(dir, "PLUGIN.md"),
    `\n- ${date} — Created from the Human Harness plugin template with \`humanharness plugin init\`. Reason: start from a plugin that builds, checks and tests clean. Alternatives rejected: copying on-this-day, which is a reference, not a starting point.\n`,
  );
  await fs.mkdir(path.join(dir, ".claude", "skills", "new-plugin"), { recursive: true });
  await fs.writeFile(path.join(dir, ".claude", "skills", "new-plugin", "SKILL.md"), pluginSkillFile(guide), { flag: "wx" });
  await fs.writeFile(path.join(dir, "AGENTS.md"), pluginAgentsFile(id, guide), { flag: "wx" });
  return { dir, id };
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Copies the template, filling the placeholders in its text files. Only files and folders; `wx`, so nothing is overwritten. */
async function copyTemplate(from: string, to: string, values: Record<string, string>, log: (line: string) => void): Promise<void> {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(target);
      await copyTemplate(source, target, values, log);
    } else if (entry.isFile()) {
      await fs.writeFile(target, fill(await fs.readFile(source), values), { flag: "wx" });
    } else log(`Skipped ${entry.name}: not a file or folder.`);
  }
}

/** The file with each placeholder replaced (a function replacement, so a `$` in a value stays literal); bytes as they are when not UTF-8. */
function fill(bytes: Buffer, values: Record<string, string>): Buffer | string {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return bytes;
  }
  return text.replace(PLACEHOLDER, (placeholder) => values[placeholder]);
}

export async function pluginInitCommand(args: string[], io: Io): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(INIT_USAGE);
    return 0;
  }
  const { values, positionals } = parseCommand(args, { harness: { type: "string" }, name: { type: "string" } });
  if (positionals.length !== 1) throw new UsageError(INIT_USAGE.trim());
  const log = (line: string) => io.stdout.write(`${line}\n`);
  const { dir, id } = await initPlugin({
    dir: path.resolve(io.cwd, positionals[0]),
    ...(values.harness !== undefined ? { harness: values.harness } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    log,
  });
  log(`Created the plugin ${id} in ${dir}.`);
  log("Next: open Claude Code or Codex in that folder and run /new-plugin.");
  log("Try it in a harness at any time with: humanharness plugin dev --harness <harness folder>");
  log("Commit dist/ with the sources: it is what the app loads.");
  return 0;
}
