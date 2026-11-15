import { promises as fs } from "node:fs";
import path from "node:path";
import { layoutSchema } from "@humanharness/mod-sdk";

export type Layer = "core" | "harness" | "user";
/** Each layer's folder under the home folder, in the order the app reads them for mods. */
const MOD_DIRS: [Layer, string][] = [
  ["core", path.join("core", "mods")],
  ["harness", path.join("harness", "mods")],
  ["user", "mods"],
];
const LAYOUT_DIRS: [Layer, string][] = [
  ["user", "layouts"],
  ["harness", path.join("harness", "layouts")],
  ["core", path.join("core", "layouts")],
];
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HOOKS = ["beforeSend", "turnStart", "turnEnd", "taskOpen", "taskClose"] as const;
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

export interface CatalogMod {
  id: string;
  layer: Layer;
  name: string;
  description: string;
  version: string;
  /** The blocks it registers: `blocks` in mod.json, else read from its source (`ctx.block("…")`, `registerBlock`). */
  blocks: string[];
  /** The hooks it registers: `hooks` in mod.json, else read from its source (`ctx.on.<hook>`). */
  hooks: string[];
  /** Its config keys, when mod.json lists them (`settings`). */
  settings: string[];
  clonedFrom?: { id: string; version: string };
  /** From the sibling `config.json`; `unknown` when there is none. */
  state: "on" | "off" | "unknown";
  /** Why the app refused it: its `.error` files, else the reason config.json turned it off. */
  error?: string;
}
export interface CatalogLayout {
  name: string;
  layer: Layer;
  /** The one the screen shows: settings.json's pick, else the harness's `main`, else the core's. */
  shown: boolean;
}
export interface CatalogType {
  name: string;
  /** The module a mod imports it from: `@humanharness/mod-sdk` or `@humanharness/ui`. */
  module: string;
  doc?: string;
}
export interface Catalog {
  mods: CatalogMod[];
  layouts: CatalogLayout[];
  types: CatalogType[];
}

interface ModsConfig {
  on?: Record<string, unknown>;
  trusted?: unknown[];
  failed?: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : undefined);
const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);

/** `config.json` beside the home folder → `mods`; null when there is no readable file. */
async function readModsConfig(home: string): Promise<ModsConfig | null> {
  const text = await readText(path.join(home, "..", "config.json"));
  if (text === null) return null;
  try {
    const json = JSON.parse(text) as unknown;
    return isObj(json) && isObj(json.mods) ? (json.mods as ModsConfig) : {};
  } catch {
    return null;
  }
}

/** On or off as the app decides it (shell's `isModOn` and the host's trust rule); core mods are off by default. */
function stateOf(id: string, layer: Layer, c: ModsConfig | null): CatalogMod["state"] {
  if (c === null) return "unknown";
  if (isObj(c.failed) && c.failed[id] !== undefined) return "off";
  const own = isObj(c.on) ? c.on[id] : undefined;
  if (layer === "user") return own === true && Array.isArray(c.trusted) && c.trusted.includes(id) ? "on" : "off";
  if (typeof own === "boolean") return own ? "on" : "off";
  return layer === "harness" ? "on" : "off";
}

async function filesOf(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && keep(e.name) && !path.relative(dir, e.parentPath).split(path.sep).includes("node_modules"))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

/** The blocks and hooks a mod's source registers, in the order they appear. */
async function scanSource(dir: string): Promise<{ blocks: string[]; hooks: string[] }> {
  const blocks = new Set<string>();
  const hooks = new Set<string>();
  for (const file of await filesOf(dir, (n) => SOURCE_FILE.test(n))) {
    const text = (await readText(file)) ?? "";
    for (const m of text.matchAll(/\.block\(\s*["'`]([^"'`]+)["'`]|registerBlock\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/g)) blocks.add((m[1] ?? m[2]) as string);
    for (const m of text.matchAll(new RegExp(`\\.on\\.(${HOOKS.join("|")})\\s*\\(`, "g"))) hooks.add(m[1] as string);
  }
  return { blocks: [...blocks], hooks: [...hooks] };
}

/** The README's first paragraph that isn't a heading. */
async function readmeLine(dir: string): Promise<string> {
  const text = await readText(path.join(dir, "README.md"));
  if (text === null) return "";
  const para = text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p !== "" && !p.startsWith("#"));
  return para?.replace(/\s*\n\s*/g, " ") ?? "";
}

async function readMod(dir: string, id: string, layer: Layer, config: ModsConfig | null): Promise<CatalogMod> {
  let raw: Record<string, unknown> = {};
  let jsonProblem: string | undefined;
  const text = await readText(path.join(dir, "mod.json"));
  if (text === null) jsonProblem = "it has no mod.json";
  else {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isObj(parsed)) raw = parsed;
      else jsonProblem = "mod.json isn't an object";
    } catch (err) {
      jsonProblem = `mod.json isn't valid JSON: ${(err as Error).message}`;
    }
  }
  const scanned = strings(raw.blocks) && strings(raw.hooks) ? undefined : await scanSource(dir);
  const errors: string[] = [];
  for (const file of await filesOf(dir, (n) => n.endsWith(".error"))) errors.push(((await readText(file)) ?? "").trim());
  if (errors.length === 0 && jsonProblem) errors.push(jsonProblem);
  const failed = isObj(config?.failed) ? config.failed[id] : undefined;
  if (errors.length === 0 && typeof failed === "string") errors.push(failed);
  const clonedFrom = isObj(raw.clonedFrom) && typeof raw.clonedFrom.id === "string" && typeof raw.clonedFrom.version === "string" ? { id: raw.clonedFrom.id, version: raw.clonedFrom.version } : undefined;
  return {
    id,
    layer,
    name: typeof raw.name === "string" ? raw.name : id,
    description: typeof raw.description === "string" ? raw.description : await readmeLine(dir),
    version: typeof raw.version === "string" ? raw.version : "",
    blocks: strings(raw.blocks) ?? scanned?.blocks ?? [],
    hooks: strings(raw.hooks) ?? scanned?.hooks ?? [],
    settings: strings(raw.settings) ?? [],
    ...(clonedFrom ? { clonedFrom } : {}),
    state: stateOf(id, layer, config),
    ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
  };
}

async function listMods(home: string, config: ModsConfig | null): Promise<CatalogMod[]> {
  const out: CatalogMod[] = [];
  for (const [layer, rel] of MOD_DIRS) {
    const root = path.join(home, rel);
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const ids = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
    for (const id of ids) {
      // core and harness are the app's copies: a folder without mod.json there is no mod.
      if (layer !== "user" && (await readText(path.join(root, id, "mod.json"))) === null) continue;
      out.push(await readMod(path.join(root, id), id, layer, config));
    }
  }
  return out;
}

async function isValidLayout(file: string): Promise<boolean> {
  const text = await readText(file);
  if (text === null) return false;
  try {
    return layoutSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

/** The layouts of the three layers (the person's first), with the one the screen shows (shell's `shownLayout`). */
async function listLayouts(home: string): Promise<CatalogLayout[]> {
  const found: { name: string; layer: Layer }[] = [];
  for (const [layer, rel] of LAYOUT_DIRS) {
    const entries = await fs.readdir(path.join(home, rel), { withFileTypes: true }).catch(() => []);
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name.slice(0, -".json".length)).filter((n) => LAYOUT_NAME.test(n));
    // The core's main is always there: built into the app when the file is missing.
    if (layer === "core" && !names.includes("main")) names.push("main");
    for (const name of names.sort()) found.push({ name, layer });
  }
  const settings = await readText(path.join(home, "settings.json"));
  let picked: string | undefined;
  try {
    const s = settings === null ? undefined : (JSON.parse(settings) as unknown);
    if (isObj(s) && typeof s.layout === "string" && LAYOUT_NAME.test(s.layout)) picked = s.layout;
  } catch {
    // A settings.json that doesn't parse picks nothing.
  }
  const order: { layer: Layer; name: string }[] = [];
  if (picked !== undefined) order.push({ layer: "user", name: picked }, { layer: "harness", name: picked });
  order.push({ layer: "harness", name: "main" }, { layer: "core", name: "main" });
  let shown: { layer: Layer; name: string } = { layer: "core", name: "main" };
  for (const o of order) {
    const rel = LAYOUT_DIRS.find(([l]) => l === o.layer)?.[1] as string;
    if (await isValidLayout(path.join(home, rel, `${o.name}.json`))) {
      shown = o;
      break;
    }
  }
  return found.map((l) => ({ ...l, shown: l.layer === shown.layer && l.name === shown.name }));
}

interface DtsModule {
  own: Map<string, string | undefined>;
  starFrom: string[];
  named: { name: string; from: string }[];
}

/** The `/** … *\/` comment right above line `i`: its first sentence. */
function docAbove(lines: string[], i: number): string | undefined {
  let j = i - 1;
  if (j < 0 || !lines[j]?.trim().endsWith("*/")) return undefined;
  const body: string[] = [];
  for (; j >= 0; j--) {
    const l = (lines[j] as string).trim();
    body.unshift(l);
    if (l.startsWith("/**")) break;
  }
  const text = body
    .join("\n")
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l !== "" && !l.startsWith("@"));
  if (text.length === 0) return undefined;
  // One line: the first sentence.
  return text.join(" ").split(/(?<=[.:])\s+(?=[A-Z`])/)[0];
}

function parseDts(text: string): Map<string, DtsModule> {
  const modules = new Map<string, DtsModule>();
  const lines = text.split("\n");
  let current: DtsModule | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const open = /^declare module "([^"]+)" \{/.exec(line);
    if (open) {
      current = { own: new Map(), starFrom: [], named: [] };
      modules.set(open[1] as string, current);
      continue;
    }
    if (line === "}") {
      current = undefined;
      continue;
    }
    if (!current) continue;
    // Only the module's own level (two spaces in): members of an interface are not exports.
    const star = /^ {2}export \* from "([^"]+)"/.exec(line);
    if (star) {
      current.starFrom.push(star[1] as string);
      continue;
    }
    const named = /^ {2}export (?:type )?\{([^}]*)\} from "([^"]+)"/.exec(line);
    if (named) {
      for (const part of (named[1] as string).split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
        if (name) current.named.push({ name, from: named[2] as string });
      }
      continue;
    }
    const decl = /^ {2}export (?:declare )?(?:abstract )?(?:function|const|let|type|interface|class|enum|namespace) ([A-Za-z_$][\w$]*)/.exec(line);
    if (decl) current.own.set(decl[1] as string, docAbove(lines, i));
  }
  return modules;
}

/** The names a module exports, with their docs, following `export *` and `export { … } from`. */
function exportsOf(modules: Map<string, DtsModule>, name: string, seen = new Set<string>()): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const m = modules.get(name);
  if (!m || seen.has(name)) return out;
  seen.add(name);
  for (const [n, doc] of m.own) out.set(n, doc);
  for (const from of m.starFrom) for (const [n, doc] of exportsOf(modules, from, seen)) if (!out.has(n)) out.set(n, doc);
  for (const { name: n, from } of m.named) {
    const all = exportsOf(modules, from, new Set(seen));
    out.set(n, all.get(n));
  }
  return out;
}

/** The names `hh.d.ts` exports from the modules a mod may import (not its `_internal` ones). */
async function listTypes(home: string): Promise<CatalogType[]> {
  const text = await readText(path.join(home, "hh.d.ts"));
  if (text === null) return [];
  const modules = parseDts(text);
  const out: CatalogType[] = [];
  for (const name of modules.keys()) {
    if (name.includes("/_internal/")) continue;
    for (const [n, doc] of exportsOf(modules, name)) out.push(doc === undefined ? { name: n, module: name } : { name: n, module: name, doc });
  }
  return out;
}

/**
 * What the app in `home` is made of: every mod of the three layers with its state, every layout with the one shown,
 * and the names `hh.d.ts` exports. Reads only; never needs the app running.
 */
export async function catalog(home: string): Promise<Catalog> {
  const config = await readModsConfig(home);
  const [mods, layouts, types] = await Promise.all([listMods(home, config), listLayouts(home), listTypes(home)]);
  return { mods, layouts, types };
}
