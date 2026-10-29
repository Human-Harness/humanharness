import { createHash } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import { cleanCodex, cleanMcp, cleanSettings, type CleanContext, type CleanSettings, type Hooks } from "./clean";
import { agentFromMarkdown, skillFromMarkdown, type AgentDefinition } from "./frontmatter";
import { commandWords, scriptRefs, type ScriptCommand } from "./script-refs";
import { parseToml } from "./toml-lite";

// Reads a scope's engine folder, `.harness/engine/<scope>/` (hatches spec §5.1–5.4), into an EngineConfig: what each
// file says after cleaning, every refusal (collected, never thrown, so the screen can show them all), the referenced
// scripts (E2) and one hash over all of it. The folder is written by anyone who can write the person's folder: every
// entry is lstat'ed and opened without following links, symlinks are refused, and sizes are capped (E8). The bytes
// read are kept so the snapshot writes exactly what was hashed (E3).

export interface EngineLayer {
  instructions: string;
  servers: McpServerSpec[];
  settings: CleanSettings | null;
  /** Keys dropped rather than refused (`defaultMode`, an agent's `permissionMode`), named with their file. */
  ignored: string[];
}
export interface EngineRefusal {
  /** The path relative to the engine folder ("." for the folder itself). */
  file: string;
  message: string;
}
export interface EngineConfig extends EngineLayer {
  base: "isolated" | "global";
  skills: { name: string; description: string }[];
  agents: Record<string, AgentDefinition>;
  codex: Record<string, unknown> | null;
  actions: Record<string, EngineLayer>;
  /** Files outside the engine folder that joined the hash (E2), absolute and sorted. */
  scripts: string[];
  refusals: EngineRefusal[];
  /** sha256 hex over the sorted (relative path, bytes) of every file read plus every script. */
  hash: string;
  /** The bytes that were hashed, by path relative to the engine folder (posix), so the snapshot writes exactly them. */
  files: Map<string, Buffer>;
  /** The scripts' bytes that were hashed, by absolute path. */
  scriptFiles: Map<string, Buffer>;
}

export interface ReadEngineOptions extends CleanContext {
  /** The harness's actions: an action layer's id must be one of them (`Object.hasOwn`). */
  actions?: Readonly<Record<string, unknown>>;
  /** The manifest's `permissions.web`: codex.toml keys that reach the network pass only when true. */
  web?: boolean;
}

export const ENGINE_FILE_MAX = 256 * 1024;
export const ENGINE_FOLDER_MAX = 2 * 1024 * 1024;
export const ENGINE_FILES_MAX = 200;
/** A file's path has at most this many parts (`skills/<name>/<dir>/<file>`). */
export const ENGINE_DEPTH_MAX = 4;

const TOP_FILES = new Set(["base", "instructions.md", "mcp.json", "settings.json", "codex.toml"]);
const TOP_DIRS = new Set(["skills", "agents", "actions"]);
const LAYER_FILES = new Set(["instructions.md", "mcp.json", "settings.json"]);
/** Finder's metadata: never read, never hashed, never copied. */
const SKIPPED = new Set([".DS_Store"]);

type Read =
  | { kind: "file"; data: Buffer }
  | { kind: "symlink" }
  | { kind: "large" }
  | { kind: "hardlink" }
  | { kind: "changed" }
  | { kind: "other" };

/**
 * Opens without following a final symlink and checks the open file itself: a regular file, with one name only (a hard
 * link could be a second name of a file outside, like an account file), and the same file the lstat before saw (a
 * parent folder swapped in between would show another device or inode).
 */
async function readRegular(abs: string, max: number): Promise<Read> {
  const before = await fs.lstat(abs);
  if (before.isSymbolicLink()) return { kind: "symlink" };
  let h: FileHandle;
  try {
    h = await fs.open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOOP") return { kind: "symlink" };
    throw err;
  }
  try {
    const st = await h.stat();
    if (!st.isFile()) return { kind: "other" };
    if (st.dev !== before.dev || st.ino !== before.ino) return { kind: "changed" };
    if (st.nlink > 1) return { kind: "hardlink" };
    if (st.size > max) return { kind: "large" };
    const data = await h.readFile();
    return data.length > max ? { kind: "large" } : { kind: "file", data };
  } finally {
    await h.close();
  }
}

class Walk {
  files = new Map<string, Buffer>();
  dirs: string[] = [];
  refusals: EngineRefusal[] = [];
  total = 0;
  count = 0;
  /** Set when a folder-wide cap was hit: the walk stops and nothing it read counts. */
  capped: string | null = null;

  constructor(private readonly root: string) {}

  refuse(file: string, message: string) {
    this.refusals.push({ file, message: `${file}: ${message}` });
  }

  async dir(rel: string, depth: number): Promise<void> {
    const entries = (await fs.readdir(path.join(this.root, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (this.capped) return;
      if (SKIPPED.has(e.name)) continue;
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      const parts = depth + 1;
      if (e.isSymbolicLink()) this.refuse(r, "symbolic links are not allowed");
      else if (e.isDirectory()) {
        if (parts >= ENGINE_DEPTH_MAX) this.refuse(r, `folders are nested too deep (over ${ENGINE_DEPTH_MAX} levels)`);
        else {
          this.dirs.push(r);
          await this.dir(r, parts);
        }
      } else if (e.isFile()) {
        if (++this.count > ENGINE_FILES_MAX) {
          this.capped = `the engine folder has more than ${ENGINE_FILES_MAX} files`;
          return;
        }
        const read = await readRegular(path.join(this.root, r), ENGINE_FILE_MAX);
        if (read.kind === "symlink") this.refuse(r, "symbolic links are not allowed");
        else if (read.kind === "large") this.refuse(r, `is over ${ENGINE_FILE_MAX / 1024} KB`);
        else if (read.kind === "hardlink") this.refuse(r, "hard links are not allowed");
        else if (read.kind === "changed") this.refuse(r, "changed while it was read");
        else if (read.kind === "other") this.refuse(r, "is not a regular file");
        else {
          this.total += read.data.length;
          if (this.total > ENGINE_FOLDER_MAX) {
            this.capped = `the engine folder is over ${ENGINE_FOLDER_MAX / 1024 / 1024} MB`;
            return;
          }
          this.files.set(r, read.data);
        }
      } else this.refuse(r, "is not a regular file");
    }
  }
}

/** The hash input: each file sorted by path as `path\0length\0bytes`, then each script as `script:<path>\0length\0bytes`. */
export function engineHash(files: ReadonlyMap<string, Buffer>, scripts: ReadonlyMap<string, Buffer>): string {
  const h = createHash("sha256");
  const add = (name: string, data: Buffer) => {
    h.update(`${name}\0${data.length}\0`);
    h.update(data);
  };
  for (const k of [...files.keys()].sort()) add(k, files.get(k)!);
  for (const k of [...scripts.keys()].sort()) add(`script:${k}`, scripts.get(k)!);
  return h.digest("hex");
}

/** The message of a cleaner's or parser's error, led by the file's path relative to the engine folder. */
function messageFor(file: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith(`${file}:`)) return msg;
  const base = path.posix.basename(file);
  if (msg.startsWith(`${base}:`)) return `${file}${msg.slice(base.length)}`;
  return `${file}: ${msg}`;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The commands a hooks object runs. */
const hookCommands = (hooks: Hooks | undefined): string[] =>
  Object.values(hooks ?? {}).flatMap((matchers) => matchers.flatMap((m) => m.hooks.map((h) => h.command)));

const emptyConfig = (): EngineConfig => ({
  base: "isolated",
  instructions: "",
  servers: [],
  settings: null,
  ignored: [],
  skills: [],
  agents: {},
  codex: null,
  actions: {},
  scripts: [],
  refusals: [],
  hash: "",
  files: new Map(),
  scriptFiles: new Map(),
});

/** Every folder that holds a file, by posix path (what a walk sees, less empty folders). */
function dirsOf(files: ReadonlyMap<string, Buffer>): string[] {
  const dirs = new Set<string>();
  for (const rel of files.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...dirs].sort();
}

/** Refusals unique and sorted by file; `scripts` and the hash from the bytes the config holds. */
function finish(config: EngineConfig): EngineConfig {
  const unique = new Map(config.refusals.map((r) => [`${r.file}\0${r.message}`, r]));
  config.refusals = [...unique.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  config.scripts = [...config.scriptFiles.keys()].sort();
  config.hash = engineHash(config.files, config.scriptFiles);
  return config;
}

/**
 * What the engine folder's `files` say, cleaned with today's context `o` (pure: no disk). `scriptFiles` are the
 * referenced scripts' bytes, kept and hashed as given; `commands` are the ones whose scripts join the hash (for
 * `scriptRefs`). The snapshot calls it again on load with the re-hashed bytes, so a rule that the context refuses now
 * (a folder unlinked, `edit: "none"`, a new reserved server name) is refused there too. `dirs` are the folders a walk
 * saw (empty ones included); by default the ones holding a file. `refusals` are the walk's, added to.
 */
export function configFromFiles(
  files: Map<string, Buffer>,
  scriptFiles: Map<string, Buffer>,
  o: ReadEngineOptions,
  dirs: readonly string[] = dirsOf(files),
  refusals: EngineRefusal[] = [],
): { config: EngineConfig; commands: ScriptCommand[] } {
  const config = emptyConfig();
  const refuse = (file: string, message: string) => refusals.push({ file, message: `${file}: ${message}` });
  const text = (rel: string) => files.get(rel)?.toString("utf8");
  /** Runs a cleaner or parser for `rel`; a throw becomes a refusal naming the file. */
  const attempt = <T>(rel: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      refusals.push({ file: rel, message: messageFor(rel, err) });
      return undefined;
    }
  };
  const json = (rel: string): unknown => {
    const t = text(rel);
    if (t === undefined) return undefined;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      refuse(rel, "is not valid JSON");
      return undefined;
    }
  };
  const commands: ScriptCommand[] = [];
  /** A command joins the scripts' search only when its paths can be placed; otherwise it is refused naming it. */
  const command = (file: string, kind: string, c: ScriptCommand) => {
    try {
      commandWords(c, o.folder);
      commands.push(c);
    } catch (err) {
      const shown = typeof c === "string" ? c : c.join(" ");
      refuse(file, `${kind} ${JSON.stringify(shown.length > 120 ? `${shown.slice(0, 120)}…` : shown)} ${(err as Error).message}`);
    }
  };

  const layer = (prefix: string): EngineLayer => {
    const l: EngineLayer = { instructions: text(`${prefix}instructions.md`) ?? "", servers: [], settings: null, ignored: [] };
    const mcpRaw = json(`${prefix}mcp.json`);
    if (mcpRaw !== undefined) l.servers = attempt(`${prefix}mcp.json`, () => cleanMcp(mcpRaw, o)) ?? [];
    const settingsRaw = json(`${prefix}settings.json`);
    if (settingsRaw !== undefined) {
      const cleaned = attempt(`${prefix}settings.json`, () => cleanSettings(settingsRaw, o));
      if (cleaned) {
        l.settings = cleaned.settings;
        l.ignored.push(...cleaned.ignored.map((k) => `${prefix}settings.json: ${k}`));
        for (const c of hookCommands(cleaned.settings.hooks)) command(`${prefix}settings.json`, "the hook command", c);
      }
    }
    for (const s of l.servers) command(`${prefix}mcp.json`, `the server ${s.name.slice("scope-".length)}`, [s.command, ...s.args]);
    return l;
  };

  // Which files may be where: the top, skills/<name>/…, agents/<name>.md, actions/<id>/<layer file>.
  for (const rel of files.keys()) {
    const parts = rel.split("/");
    const top = parts[0]!;
    if (parts.length === 1) {
      if (!TOP_FILES.has(top)) refuse(rel, "is not allowed in the engine folder");
    } else if (!TOP_DIRS.has(top)) refuse(top, "is not allowed in the engine folder");
    else if (top === "skills" && parts.length === 2) refuse(rel, "each skill is a folder with a SKILL.md");
    else if (top === "agents" && (parts.length > 2 || !rel.endsWith(".md"))) refuse(rel, "only .md agent files are allowed");
    else if (top === "actions") {
      if (parts.length === 2) refuse(rel, "each action layer is a folder");
      else if (parts.length > 3 || !LAYER_FILES.has(parts[2]!)) refuse(rel, "is not allowed in an action layer");
    }
  }
  for (const d of dirs) {
    const parts = d.split("/");
    if (parts.length === 1 && !TOP_DIRS.has(d) && ![...files.keys()].some((k) => k.startsWith(`${d}/`))) {
      // An empty unknown folder: nothing to read, but still not allowed.
      refuse(d, "is not allowed in the engine folder");
    } else if (parts[0] === "skills" && parts.length === 2 && [...files.keys()].some((k) => k.startsWith(`${d}/`)) && !files.has(`${d}/SKILL.md`)) {
      refuse(d, "SKILL.md is missing");
    } else if (parts[0] === "actions" && parts.length === 2 && !(o.actions && Object.hasOwn(o.actions, parts[1]!))) {
      refuse(d, `${parts[1]} is not an action of this harness`);
    }
  }

  const base = text("base");
  if (base !== undefined) {
    const b = base.trim();
    if (b === "isolated" || b === "global") config.base = b;
    else refuse("base", 'must be "isolated" or "global"');
  }

  Object.assign(config, layer(""));

  for (const d of dirs) {
    const parts = d.split("/");
    if (parts[0] !== "skills" || parts.length !== 2) continue;
    const skill = text(`${d}/SKILL.md`);
    if (skill === undefined) continue;
    const s = attempt(`${d}/SKILL.md`, () => skillFromMarkdown(parts[1]!, skill));
    if (s) config.skills.push(s);
  }

  for (const rel of files.keys()) {
    const parts = rel.split("/");
    if (parts[0] !== "agents" || parts.length !== 2 || !rel.endsWith(".md")) continue;
    const a = attempt(rel, () => agentFromMarkdown(parts[1]!, text(rel)!));
    if (!a) continue;
    if (Object.hasOwn(config.agents, a.name)) refuse(rel, `the agent name ${a.name} is used twice`);
    else {
      Object.defineProperty(config.agents, a.name, { value: a.agent, enumerable: true, writable: true, configurable: true });
      config.ignored.push(...a.ignored.map((k) => `${rel}: ${k}`));
    }
  }

  const toml = text("codex.toml");
  if (toml !== undefined) {
    const codex = attempt("codex.toml", () => cleanCodex(parseToml(toml), { web: o.web === true }));
    if (codex) {
      config.codex = codex;
      if (isPlainObject(codex.hooks)) for (const c of hookCommands(codex.hooks as Hooks)) command("codex.toml", "the hook command", c);
    }
  }

  for (const d of dirs) {
    const parts = d.split("/");
    if (parts[0] !== "actions" || parts.length !== 2) continue;
    const id = parts[1]!;
    if (!(o.actions && Object.hasOwn(o.actions, id))) continue;
    Object.defineProperty(config.actions, id, { value: layer(`${d}/`), enumerable: true, writable: true, configurable: true });
  }

  config.files = files;
  config.scriptFiles = scriptFiles;
  config.refusals = refusals;
  return { config: finish(config), commands };
}

/** The files `commands` name outside the engine folder `dir` (those inside are already in its files), sorted. */
export async function externalScripts(commands: readonly ScriptCommand[], dir: string, o: ReadEngineOptions): Promise<string[]> {
  const engineRoot = path.resolve(dir);
  return (await scriptRefs(commands, o)).filter((s) => !(s === engineRoot || s.toLowerCase().startsWith(engineRoot.toLowerCase() + path.sep)));
}

/**
 * Reads the engine folder `dir` of a scope. Null when it is absent or holds no file (D0 for the scope); otherwise the
 * config with every refusal. A config with refusals can be shown but never approved.
 */
export async function readEngineConfig(dir: string, o: ReadEngineOptions): Promise<EngineConfig | null> {
  let st;
  try {
    st = await fs.lstat(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const empty = emptyConfig();
  if (st.isSymbolicLink() || !st.isDirectory()) {
    empty.refusals.push({ file: ".", message: st.isSymbolicLink() ? "the engine folder is a symbolic link" : "the engine folder is not a folder" });
    return finish(empty);
  }

  const walk = new Walk(dir);
  await walk.dir("", 0);
  if (walk.capped) {
    empty.refusals.push({ file: ".", message: walk.capped });
    return finish(empty);
  }
  if (walk.files.size === 0 && walk.refusals.length === 0) return null;
  const { config, commands } = configFromFiles(walk.files, new Map(), o, walk.dirs, walk.refusals);
  const refusals = config.refusals;

  // Referenced scripts: files outside the engine folder (those inside are already in `files`).
  for (const script of await externalScripts(commands, dir, o)) {
    const read = await readRegular(script, ENGINE_FILE_MAX).catch(() => ({ kind: "other" }) as Read);
    if (read.kind === "file") {
      walk.total += read.data.length;
      if (walk.total > ENGINE_FOLDER_MAX) {
        refusals.push({ file: ".", message: `the engine folder and its scripts are over ${ENGINE_FOLDER_MAX / 1024 / 1024} MB` });
        break;
      }
      config.scriptFiles.set(script, read.data);
    } else if (read.kind === "large") refusals.push({ file: script, message: `${script}: the script is over ${ENGINE_FILE_MAX / 1024} KB` });
    else if (read.kind === "hardlink") refusals.push({ file: script, message: `${script}: the script has hard links, which are not allowed` });
    else refusals.push({ file: script, message: `${script}: the script could not be read as a regular file` });
  }
  return finish(config);
}
