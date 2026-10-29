import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import { isScopeId } from "@humanharness/workspace";
import type { CleanSettings } from "./clean";
import {
  ENGINE_FOLDER_MAX,
  configFromFiles,
  engineHash,
  externalScripts,
  type EngineConfig,
  type EngineLayer,
  type EngineRefusal,
  type ReadEngineOptions,
} from "./read-config";

// The approved engine config's snapshot, `<userData>/engine-config/<hash>/` (hatches spec §5.2, E3). Engines get only
// this folder, never the scope's live one: an agent that edits `.harness/engine/` mid-session can't load what the
// person didn't approve. The snapshot is written from the bytes `readEngineConfig` hashed (never read again from the
// person's folder). On load it is re-hashed and everything is derived again from its source with today's cleaning
// context, so a rule the harness or the scope's links refuse now is refused for a pinned task too.
//
//   source/files/<rel>          the engine folder's files, verbatim
//   source/scripts/<sha16>      each referenced script, named by its path's sha256 (for the re-hash only: engines
//   source/scripts.json         run the live path, which the hash check at session start covers); the paths, sorted
//   plugins/scope-<id>/skills/… the skills, laid out as a plugin for `--plugin-dir`, one per scope that uses this hash:
//                               Claude names a plugin after its folder, so skills are `/scope-<id>:<name>` (spec §5.2)
//   agents.json                 for `--agents`; absent without agents
//
// Nothing else is in the folder: settings, servers, Codex keys and instructions reach the engines as arguments, built
// from what `loadSnapshot` returns. On load the folder must hold exactly what `writeSnapshot` would write, and every
// plugin exactly the hashed skills.

export interface EngineSnapshot {
  hash: string;
  dir: string;
  base: "isolated" | "global";
  /** The scope's plugin folder, `plugins/scope-<id>`, holding `skills/`; absent without skills. */
  pluginDir?: string;
  /** agents.json; absent without agents. */
  agentsFile?: string;
  settings?: CleanSettings;
  servers: McpServerSpec[];
  codex?: Record<string, unknown>;
  instructions: string;
  actions: Record<string, EngineLayer>;
  /** What today's context refuses in the approved files. Not empty: the caller treats the scope as not approved. */
  refusals: EngineRefusal[];
}

export interface LoadSnapshotOptions extends ReadEngineOptions {
  /** The scope's live engine folder: scripts inside it are its files, not referenced scripts. */
  dir: string;
}

/** How long a snapshot nothing keeps stays in the data folder (Decision 13). */
export const SNAPSHOT_KEEP_DAYS = 30;
const HASH = /^[0-9a-f]{64}$/;
const TEMP = /^\.tmp-[0-9a-f]{16}$/;
const CHANGED = "The approved engine config changed on disk";
/** No file of a snapshot can be larger than the whole engine folder (agents.json included, with room for JSON). */
const FILE_MAX = 2 * ENGINE_FOLDER_MAX;
const SNAPSHOT_FILES_MAX = 1000;

function checkHash(hash: string): void {
  if (typeof hash !== "string" || !HASH.test(hash)) throw new Error("An engine config hash is 64 hex characters");
}

/** Where the snapshot of `hash` lives. */
export function snapshotDir(userData: string, hash: string): string {
  checkHash(hash);
  return path.join(userData, "engine-config", hash);
}

/** A script's file name in `source/scripts/`: its absolute path's sha256, 16 hex characters. */
const scriptName = (abs: string) => createHash("sha256").update(abs).digest("hex").slice(0, 16);
const json = (v: unknown) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);

/** A relative posix path from the engine folder's walk, checked again before it becomes a path on disk. */
function safeRel(rel: string): string {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) throw new Error(`Invalid engine file path: ${rel}`);
  return rel;
}

/** A scope's plugin folder name: Claude names the plugin, and so its skills, after it. */
function pluginName(scope: string): string {
  if (!isScopeId(scope)) throw new Error(`Invalid engine config scope: "${String(scope).slice(0, 40)}"`);
  return `scope-${scope}`;
}
const PLUGIN = /^scope-(.+)$/;

/** The skills' files of the engine folder, by path inside a plugin (`skills/<name>/…`). */
const skillsOf = (files: ReadonlyMap<string, Buffer>) => new Map([...files].filter(([rel]) => rel.startsWith("skills/")));

/** Every file of the snapshot of these bytes but the plugins, by posix path relative to its folder. */
function layout(files: ReadonlyMap<string, Buffer>, scriptFiles: ReadonlyMap<string, Buffer>, agents: EngineConfig["agents"]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [rel, data] of files) out.set(`source/files/${safeRel(rel)}`, data);
  const scripts = [...scriptFiles.keys()].sort();
  for (const abs of scripts) out.set(`source/scripts/${scriptName(abs)}`, scriptFiles.get(abs)!);
  out.set("source/scripts.json", json(scripts));
  if (Object.keys(agents).length > 0) out.set("agents.json", json(agents));
  return out;
}

/** Reads a regular file without following a link; anything else throws. */
async function readOwn(file: string): Promise<Buffer> {
  const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await h.stat();
    if (!st.isFile() || st.size > FILE_MAX) throw new Error(CHANGED);
    return await h.readFile();
  } finally {
    await h.close();
  }
}

/**
 * Every file under `dir` by posix path relative to it. A link, anything but a file or folder, an empty folder (a
 * snapshot has none) or too many files throws.
 */
async function walk(dir: string, rel = "", out = new Map<string, Buffer>()): Promise<Map<string, Buffer>> {
  const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  if (entries.length === 0) throw new Error(CHANGED);
  for (const e of entries) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) await walk(dir, r, out);
    else if (e.isFile() && out.size < SNAPSHOT_FILES_MAX) out.set(r, await readOwn(path.join(dir, r)));
    else throw new Error(CHANGED);
  }
  return out;
}

/** The snapshot folder's files, or null when it isn't a real folder (missing, a link) or holds anything else. */
async function readTree(dir: string): Promise<Map<string, Buffer> | null> {
  for (const p of [path.dirname(dir), dir]) {
    const st = await fs.lstat(p).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return null;
  }
  return walk(dir).catch(() => null);
}

const sameTree = (a: ReadonlyMap<string, Buffer>, b: ReadonlyMap<string, Buffer>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k)?.equals(v) === true);

/**
 * The scopes whose plugin `tree` holds, when it is a snapshot of these bytes: outside `plugins/` exactly `want`, and
 * each `plugins/scope-<id>/` exactly `skills` (none without skills). Null when anything differs.
 */
function pluginsIn(tree: ReadonlyMap<string, Buffer>, want: ReadonlyMap<string, Buffer>, skills: ReadonlyMap<string, Buffer>): Set<string> | null {
  const core = new Map<string, Buffer>();
  const plugins = new Map<string, Map<string, Buffer>>();
  for (const [rel, data] of tree) {
    const parts = rel.split("/");
    if (parts[0] !== "plugins") {
      core.set(rel, data);
      continue;
    }
    const scope = PLUGIN.exec(parts[1] ?? "")?.[1];
    if (scope === undefined || !isScopeId(scope) || parts.length < 3) return null;
    const p = plugins.get(scope) ?? new Map<string, Buffer>();
    p.set(parts.slice(2).join("/"), data);
    plugins.set(scope, p);
  }
  if (!sameTree(core, want)) return null;
  for (const p of plugins.values()) if (skills.size === 0 || !sameTree(p, skills)) return null;
  return new Set(plugins.keys());
}

/** Writes `files` into a new folder `dest` (which must not exist), through a temp folder beside `tempBase`. */
async function writeFolder(tempBase: string, dest: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  const tmp = path.join(tempBase, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await fs.mkdir(tmp);
    for (const [rel, data] of files) {
      const file = path.join(tmp, ...rel.split("/"));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data, { flag: "wx" });
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

const raced = (err: unknown) => ["EEXIST", "ENOTEMPTY"].includes((err as NodeJS.ErrnoException).code ?? "");

/**
 * Adds scope `scope`'s plugin to a verified snapshot `final` (one that shares the hash with another scope's, or whose
 * plugin went missing): the hashed skills, written whole and renamed into place. A racing add of the same is fine.
 */
async function addPlugin(final: string, scope: string, skills: ReadonlyMap<string, Buffer>): Promise<void> {
  await writeFolder(path.dirname(final), path.join(final, "plugins", pluginName(scope)), skills).catch((err: unknown) => {
    if (!raced(err)) throw err;
  });
}

/**
 * Writes the snapshot of `config` (one that `readEngineConfig` returned, without refusals) for scope `scope` and
 * returns its folder. Built only from the bytes that were hashed. Atomic: written into a temp folder next to it, then
 * renamed into place. A snapshot already there with exactly these files is kept (a no-op, or only this scope's plugin
 * added); a damaged one is replaced.
 */
export async function writeSnapshot(userData: string, config: EngineConfig, scope: string): Promise<string> {
  if (config.refusals.length > 0) throw new Error("An engine config with refusals can't be approved");
  checkHash(config.hash);
  const plugin = pluginName(scope);
  if (engineHash(config.files, config.scriptFiles) !== config.hash) throw new Error("The engine config's bytes don't match its hash");
  const final = snapshotDir(userData, config.hash);
  const want = layout(config.files, config.scriptFiles, config.agents);
  const skills = skillsOf(config.files);
  const base = path.dirname(final);

  const kept = async (): Promise<boolean> => {
    const have = await readTree(final);
    const scopes = have && pluginsIn(have, want, skills);
    if (!scopes) return false;
    if (skills.size > 0 && !scopes.has(scope)) await addPlugin(final, scope, skills);
    return true;
  };

  if (await fs.lstat(final).catch(() => null)) {
    if (await kept()) return final;
    // Damaged (or not a folder): moved aside whole, then removed; the fresh copy is written below. Other scopes'
    // plugins go with it: `loadSnapshot` adds a scope's plugin back from the verified bytes.
    const aside = path.join(base, `.tmp-${randomBytes(8).toString("hex")}`);
    await fs.rename(final, aside).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
    await fs.rm(aside, { recursive: true, force: true });
  }

  await fs.mkdir(base, { recursive: true });
  const all = new Map(want);
  for (const [rel, data] of skills) all.set(`plugins/${plugin}/${rel}`, data);
  try {
    await writeFolder(base, final, all);
  } catch (err) {
    // Another write of the same hash won the rename: kept when it holds these files.
    if (raced(err) && (await kept())) return final;
    throw err;
  }
  return final;
}

/**
 * Loads the snapshot of `hash` for scope `scope`: re-hashes its source, derives the config again from it with today's
 * context `o` (`o.dir` the scope's live engine folder), and checks the folder holds exactly what `writeSnapshot` would
 * write for those bytes. Throws "The approved engine config changed on disk" when anything differs, is missing, or is
 * a link. The scope's plugin, when missing, is written from the verified bytes. What today's context refuses comes
 * back in `refusals`, and so does a change in which scripts the commands name.
 */
export async function loadSnapshot(userData: string, hash: string, scope: string, o: LoadSnapshotOptions): Promise<EngineSnapshot> {
  const dir = snapshotDir(userData, hash);
  const plugin = pluginName(scope);
  const tree = await readTree(dir);
  if (!tree) throw new Error(CHANGED);

  let scriptList: unknown;
  try {
    scriptList = JSON.parse(tree.get("source/scripts.json")?.toString("utf8") ?? "");
  } catch {
    throw new Error(CHANGED);
  }
  if (!Array.isArray(scriptList) || !scriptList.every((s): s is string => typeof s === "string" && path.isAbsolute(s))) throw new Error(CHANGED);
  const files = new Map<string, Buffer>();
  for (const [rel, data] of tree) if (rel.startsWith("source/files/")) files.set(rel.slice("source/files/".length), data);
  const scripts = new Map<string, Buffer>();
  for (const abs of scriptList) {
    const data = tree.get(`source/scripts/${scriptName(abs)}`);
    if (!data) throw new Error(CHANGED);
    scripts.set(abs, data);
  }
  if (engineHash(files, scripts) !== hash) throw new Error(CHANGED);

  const { config, commands } = configFromFiles(files, scripts, o);
  const skills = skillsOf(files);
  const scopes = pluginsIn(tree, layout(files, scripts, config.agents), skills);
  if (!scopes) throw new Error(CHANGED);
  if (skills.size > 0 && !scopes.has(scope)) await addPlugin(dir, scope, skills);

  const refusals = [...config.refusals];
  const now = await externalScripts(commands, o.dir, o);
  if (now.length !== config.scripts.length || now.some((s, i) => s !== config.scripts[i])) {
    refusals.push({ file: ".", message: "The scripts the approved commands run are not the ones approved" });
  }

  return {
    hash,
    dir,
    base: config.base,
    ...(skills.size > 0 ? { pluginDir: path.join(dir, "plugins", plugin) } : {}),
    ...(tree.has("agents.json") ? { agentsFile: path.join(dir, "agents.json") } : {}),
    ...(config.settings ? { settings: config.settings } : {}),
    servers: config.servers,
    ...(config.codex ? { codex: config.codex } : {}),
    instructions: config.instructions,
    actions: config.actions,
    refusals,
  };
}

/**
 * Moves to the system Trash (`trash`) the snapshots not in `keep` (the scopes' approvals and the hashes of tasks
 * younger than 30 days) whose folder is older than 30 days, and temp folders a crash left behind. Never follows a
 * link; a failure is logged and the rest go on.
 */
export async function pruneSnapshots(userData: string, keep: ReadonlySet<string>, now: Date, trash: (dir: string) => Promise<void>): Promise<void> {
  const base = path.join(userData, "engine-config");
  const baseStat = await fs.lstat(base).catch(() => null);
  if (baseStat === null) return;
  if (!baseStat.isDirectory()) {
    console.error(`The engine config snapshots folder isn't a plain folder; nothing is pruned: ${base}`);
    return;
  }
  for (const name of await fs.readdir(base).catch(() => [] as string[])) {
    if (!(HASH.test(name) && !keep.has(name)) && !TEMP.test(name)) continue;
    const dir = path.join(base, name);
    const st = await fs.lstat(dir).catch(() => null);
    if (!st?.isDirectory()) continue;
    if (now.getTime() - st.mtimeMs <= SNAPSHOT_KEEP_DAYS * 86_400_000) continue;
    await trash(dir).catch((err: unknown) => console.error(`Could not move an old engine config snapshot to the Trash: ${dir}`, err));
  }
}
