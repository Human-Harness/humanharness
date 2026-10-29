import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { CleanSettings } from "./clean";
import { ENGINE_FILE_MAX, engineHash, type EngineConfig, type EngineLayer } from "./read-config";

// The approved engine config's snapshot, `<userData>/engine-config/<hash>/` (hatches spec §5.2, E3). Engines get only
// this folder, never the scope's live one: an agent that edits `.harness/engine/` mid-session can't load what the
// person didn't approve. The snapshot is written from the bytes `readEngineConfig` hashed (never read again from the
// person's folder), and re-hashed every time it is loaded.
//
//   source/files/<rel>          the engine folder's files, verbatim (for the re-hash)
//   source/scripts/<sha16>      each referenced script, named by its path's sha256 (for the re-hash only: engines
//   source/scripts.json         run the live path, which the hash check at session start covers); the paths, sorted
//   plugin/skills/<name>/…      the skills, laid out as a plugin for `--plugin-dir` (nothing else in it)
//   agents.json                 for `--agents`; absent without agents
//   settings.json               the cleaned settings; absent without them
//   mcp.json                    the cleaned servers (already `scope-<name>`), a list
//   codex.json                  the cleaned codex.toml; absent without it
//   actions.json                the action layers; absent without them
//   instructions.md

export interface EngineSnapshot {
  hash: string;
  dir: string;
  base: "isolated" | "global";
  /** The plugin folder holding `skills/`; absent without skills. */
  pluginDir?: string;
  /** agents.json; absent without agents. */
  agentsFile?: string;
  settings?: CleanSettings;
  servers: McpServerSpec[];
  codex?: Record<string, unknown>;
  instructions: string;
  actions: Record<string, EngineLayer>;
}

/** How long a snapshot nothing keeps stays in the data folder (Decision 13). */
export const SNAPSHOT_KEEP_DAYS = 30;
const HASH = /^[0-9a-f]{64}$/;
const TEMP = /^\.tmp-[0-9a-f]{16}$/;
const CHANGED = "The approved engine config changed on disk";
/** The snapshot folder's own files are capped as the engine folder's are, plus room for the derived JSON. */
const DERIVED_MAX = 4 * ENGINE_FILE_MAX;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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

/** A relative posix path from the engine folder's walk, checked again before it becomes a path on disk. */
function safeRel(rel: string): string[] {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) throw new Error(`Invalid engine file path: ${rel}`);
  return parts;
}

async function put(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: "wx" });
}

/**
 * Writes the snapshot of `config` (one that `readEngineConfig` returned, without refusals) and returns its folder.
 * The same hash twice is a no-op. Atomic: written into a temp folder next to it, then renamed into place.
 */
export async function writeSnapshot(userData: string, config: EngineConfig): Promise<string> {
  if (config.refusals.length > 0) throw new Error("An engine config with refusals can't be approved");
  checkHash(config.hash);
  if (engineHash(config.files, config.scriptFiles) !== config.hash) throw new Error("The engine config's bytes don't match its hash");
  const final = snapshotDir(userData, config.hash);
  if (await fs.lstat(final).catch(() => null)) return final;

  const base = path.dirname(final);
  await fs.mkdir(base, { recursive: true });
  const tmp = path.join(base, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await fs.mkdir(tmp);
    for (const [rel, data] of config.files) {
      const parts = safeRel(rel);
      await put(path.join(tmp, "source", "files", ...parts), data);
      if (parts[0] === "skills") await put(path.join(tmp, "plugin", ...parts), data);
    }
    const scripts = [...config.scriptFiles.keys()].sort();
    await fs.mkdir(path.join(tmp, "source", "scripts"), { recursive: true });
    for (const abs of scripts) await put(path.join(tmp, "source", "scripts", scriptName(abs)), config.scriptFiles.get(abs)!);
    await put(path.join(tmp, "source", "scripts.json"), `${JSON.stringify(scripts, null, 2)}\n`);

    const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
    if (Object.keys(config.agents).length > 0) await put(path.join(tmp, "agents.json"), json(config.agents));
    if (config.settings) await put(path.join(tmp, "settings.json"), json(config.settings));
    await put(path.join(tmp, "mcp.json"), json(config.servers));
    if (config.codex) await put(path.join(tmp, "codex.json"), json(config.codex));
    if (Object.keys(config.actions).length > 0) await put(path.join(tmp, "actions.json"), json(config.actions));
    await put(path.join(tmp, "instructions.md"), config.instructions);

    await fs.rename(tmp, final);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    // Another write of the same hash won the rename: its snapshot holds the same bytes.
    const code = (err as NodeJS.ErrnoException).code;
    if ((code === "EEXIST" || code === "ENOTEMPTY") && (await fs.lstat(final).catch(() => null))?.isDirectory()) return final;
    throw err;
  }
  return final;
}

/** Reads a regular file without following a link; anything else is a changed snapshot. */
async function readOwn(file: string, max: number): Promise<Buffer> {
  let h;
  try {
    h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(CHANGED);
  }
  try {
    const st = await h.stat();
    if (!st.isFile() || st.size > max) throw new Error(CHANGED);
    return await h.readFile();
  } finally {
    await h.close();
  }
}

/** Whether `p` is a real folder (not a link); missing is false, anything else a changed snapshot. */
async function isRealDir(p: string): Promise<boolean> {
  const st = await fs.lstat(p).catch(() => null);
  if (!st) return false;
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(CHANGED);
  return true;
}

/** Every file under `dir` by posix path relative to it; a link or anything but a file or folder throws. */
async function walk(dir: string, rel = "", out = new Map<string, Buffer>()): Promise<Map<string, Buffer>> {
  const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  for (const e of entries) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) await walk(dir, r, out);
    else if (e.isFile()) out.set(r, await readOwn(path.join(dir, r), ENGINE_FILE_MAX));
    else throw new Error(CHANGED);
  }
  return out;
}

async function optionalJson(file: string): Promise<unknown> {
  const st = await fs.lstat(file).catch(() => null);
  if (!st) return undefined;
  try {
    return JSON.parse((await readOwn(file, DERIVED_MAX)).toString("utf8")) as unknown;
  } catch {
    throw new Error(CHANGED);
  }
}

/**
 * Loads the snapshot of `hash`: re-hashes its source files and scripts, checks the plugin folder holds exactly the
 * skills' bytes, and returns what the engines get. Throws "The approved engine config changed on disk" when anything
 * differs, is missing, or is a link.
 */
export async function loadSnapshot(userData: string, hash: string): Promise<EngineSnapshot> {
  const dir = snapshotDir(userData, hash);
  if (!(await isRealDir(path.dirname(dir))) || !(await isRealDir(dir))) throw new Error(CHANGED);
  const sourceDir = path.join(dir, "source");
  if (!(await isRealDir(sourceDir)) || !(await isRealDir(path.join(sourceDir, "files")))) throw new Error(CHANGED);

  const files = await walk(path.join(sourceDir, "files"));
  const scriptList = await optionalJson(path.join(sourceDir, "scripts.json"));
  if (!Array.isArray(scriptList) || !scriptList.every((s): s is string => typeof s === "string" && path.isAbsolute(s))) throw new Error(CHANGED);
  const scripts = new Map<string, Buffer>();
  const names = new Set(scriptList.map(scriptName));
  if (!(await isRealDir(path.join(sourceDir, "scripts")))) throw new Error(CHANGED);
  const onDisk = await walk(path.join(sourceDir, "scripts"));
  if (onDisk.size !== names.size || [...onDisk.keys()].some((k) => !names.has(k))) throw new Error(CHANGED);
  for (const abs of scriptList) scripts.set(abs, onDisk.get(scriptName(abs))!);
  if (engineHash(files, scripts) !== hash) throw new Error(CHANGED);

  // The plugin folder is what Claude reads: it must be exactly the hashed skills.
  const skills = new Map([...files].filter(([rel]) => rel.startsWith("skills/")));
  const pluginDir = path.join(dir, "plugin");
  const plugin = (await isRealDir(pluginDir)) ? await walk(pluginDir) : new Map<string, Buffer>();
  if (plugin.size !== skills.size || [...skills].some(([rel, data]) => !plugin.get(rel)?.equals(data))) throw new Error(CHANGED);

  const text = (rel: string) => files.get(rel)?.toString("utf8");
  const servers = await optionalJson(path.join(dir, "mcp.json"));
  if (!Array.isArray(servers)) throw new Error(CHANGED);
  const agents = await optionalJson(path.join(dir, "agents.json"));
  const settings = await optionalJson(path.join(dir, "settings.json"));
  const codex = await optionalJson(path.join(dir, "codex.json"));
  const actions = (await optionalJson(path.join(dir, "actions.json"))) ?? {};
  for (const v of [agents, settings, codex]) if (v !== undefined && !isObject(v)) throw new Error(CHANGED);
  if (!isObject(actions)) throw new Error(CHANGED);
  // Instructions come from the re-hashed source, not the derived copies.
  for (const [id, layer] of Object.entries(actions)) {
    if (!isObject(layer)) throw new Error(CHANGED);
    layer.instructions = text(`actions/${id}/instructions.md`) ?? "";
  }

  return {
    hash,
    dir,
    base: text("base")?.trim() === "global" ? "global" : "isolated",
    ...(plugin.size > 0 ? { pluginDir } : {}),
    ...(agents !== undefined ? { agentsFile: path.join(dir, "agents.json") } : {}),
    ...(settings !== undefined ? { settings: settings as CleanSettings } : {}),
    servers: servers as McpServerSpec[],
    ...(codex !== undefined ? { codex: codex as Record<string, unknown> } : {}),
    instructions: text("instructions.md") ?? "",
    actions: actions as Record<string, EngineLayer>,
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
