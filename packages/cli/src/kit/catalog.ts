import { promises as fs } from "node:fs";
import path from "node:path";
import { layoutSchema, modJsonSchema } from "@humanharness/mod-sdk";

/** The three layers of the home folder, as the catalog names them, and where each keeps its mods and layouts. */
export type Layer = "core" | "harness" | "user";
const LAYER_DIRS: Record<Layer, string> = { core: "core", harness: "harness", user: "." };
/** The layout file names the app reads (shell's layout.ts). */
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/**
 * Core mods that are on until the person turns them off: shell's `CORE_MOD_SWITCHES` (core-mods.ts), which the CLI
 * can't import. Home is the screen the app opens on.
 */
const CORE_ON_BY_DEFAULT = new Set(["home"]);
const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/;

export interface CatalogMod {
  id: string;
  layer: Layer;
  name: string;
  description: string;
  version: string;
  /** The blocks the mod registers: `mod.json`'s `blocks` when it lists them, else read from its source. */
  blocks: string[];
  /** What its `main` hooks into (`turnEnd`, `ipc <name>`): `mod.json`'s `hooks`, else read from its source. */
  hooks: string[];
  /** The keys of its config schema: `mod.json`'s `settings`, else read from its source. */
  settings: string[];
  clonedFrom?: { id: string; version: string };
  /** From the app's `config.json`; `unknown` when there is none to read. */
  state: "on" | "off" | "unknown";
  /** The app's `.error` files in the mod's folder (`<file>: why`), or why its `mod.json` can't be read. */
  error?: string;
}
export interface CatalogLayout {
  name: string;
  layer: Layer;
  /** The one the screen shows: `settings.json`'s pick, else the harness's `main`, else the core's. */
  shown: boolean;
}
export interface CatalogType {
  /** `@humanharness/mod-sdk` or `@humanharness/ui`. */
  module: string;
  name: string;
  /** The first line of its doc comment in `hh.d.ts`. */
  doc?: string;
}
export interface Catalog {
  mods: CatalogMod[];
  layouts: CatalogLayout[];
  /** What a mod may import, as `hh.d.ts` types it: read that file for the details. */
  types: CatalogType[];
}

const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((s) => typeof s === "string") ? v : undefined);

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Every file under `dir` (relative, with `/`), without `node_modules`; none when it doesn't exist. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((f) => !f.split("/").includes("node_modules"))
    .sort();
}

/** The top-level keys of `schema: z.object({ ... })` in `text`, by a scan that skips strings and nested braces. */
function schemaKeys(text: string): string[] {
  const m = /schema\s*:\s*z\s*\.\s*(?:strictObject|object)\(\s*\{/.exec(text);
  if (!m) return [];
  const keys: string[] = [];
  let depth = 0;
  let expectKey = true;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) break;
      if (depth === 0 && expectKey && /^\s*:/.test(text.slice(end + 1))) keys.push(text.slice(i + 1, end));
      expectKey = false;
      i = end;
    } else if ("({[".includes(ch)) depth++;
    else if (")}]".includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && ch === ",") expectKey = true;
    else if (depth === 0 && expectKey && /[A-Za-z_$]/.test(ch)) {
      const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0] ?? "";
      if (/^\s*:/.test(text.slice(i + id.length))) keys.push(id);
      expectKey = false;
      i += id.length - 1;
    } else if (!/\s/.test(ch)) expectKey = false;
  }
  return keys;
}

const unique = (xs: string[]) => [...new Set(xs)];

/** Blocks, hooks and settings read from a mod's source: what `ctx.block`, `ctx.on.*`, `ctx.ipc` and `schema` name. */
async function scanSource(dir: string, files: string[]): Promise<{ blocks: string[]; hooks: string[]; settings: string[] }> {
  const blocks: string[] = [];
  const hooks: string[] = [];
  const settings: string[] = [];
  for (const f of files.filter((x) => SOURCE_FILE.test(x))) {
    const text = (await readText(path.join(dir, f))) ?? "";
    for (const m of text.matchAll(/(?:\.block|\bregisterBlock)\(\s*(["'`])([^"'`]+)\1/g)) blocks.push(m[2]);
    for (const m of text.matchAll(/\.on\.(beforeSend|turnStart|turnEnd|taskOpen|taskClose)\(|\.ipc\(\s*(["'`])([^"'`]+)\2/g)) hooks.push(m[1] ?? `ipc ${m[3]}`);
    settings.push(...schemaKeys(text));
  }
  return { blocks: unique(blocks), hooks: unique(hooks), settings: unique(settings) };
}

/** The first paragraph of a README that isn't a heading. */
function readmeLead(text: string | null): string | undefined {
  if (text === null) return undefined;
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (p && !p.startsWith("#")) return p.replace(/\s*\n\s*/g, " ");
  }
  return undefined;
}

/** `config.json` → `mods`, beside the home folder; undefined when there is no config to read. */
async function modsConfig(home: string): Promise<{ on: Record<string, unknown>; trusted: unknown[]; failed: Record<string, unknown> } | undefined> {
  const config = await readJson(path.join(home, "..", "config.json"));
  if (!isObj(config)) return undefined;
  const mods = isObj(config.mods) ? config.mods : {};
  return { on: isObj(mods.on) ? mods.on : {}, trusted: Array.isArray(mods.trusted) ? mods.trusted : [], failed: isObj(mods.failed) ? mods.failed : {} };
}

/**
 * On or off as the app decides it (shell's `isModOn` and the user layer's consent): a failed mod is off; a switch the
 * person set wins, a user mod's only once trusted; else a harness mod is on, a core mod as its default, a user mod off.
 */
function stateOf(id: string, layer: Layer, c: Awaited<ReturnType<typeof modsConfig>>): CatalogMod["state"] {
  if (!c) return "unknown";
  if (c.failed[id] !== undefined) return "off";
  const own = c.on[id];
  if (typeof own === "boolean") return own && (layer !== "user" || c.trusted.includes(id)) ? "on" : "off";
  if (layer === "harness") return "on";
  return layer === "core" && CORE_ON_BY_DEFAULT.has(id) ? "on" : "off";
}

async function modsOf(home: string, layer: Layer, config: Awaited<ReturnType<typeof modsConfig>>): Promise<CatalogMod[]> {
  const root = path.join(home, LAYER_DIRS[layer], "mods");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: CatalogMod[] = [];
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, e.name);
    const files = await filesUnder(dir);
    const errors: string[] = [];
    const raw = await readJson(path.join(dir, "mod.json"));
    const parsed = modJsonSchema.safeParse(raw);
    if (!parsed.success) errors.push(`mod.json: ${raw === undefined ? "missing or not valid JSON" : parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
    for (const f of files.filter((x) => x.endsWith(".error"))) {
      const why = ((await readText(path.join(dir, f))) ?? "").trim().split("\n")[0];
      errors.push(`${f}: ${why}`);
    }
    const json = isObj(raw) ? raw : {};
    const id = parsed.success ? parsed.data.id : e.name;
    const scanned = await scanSource(dir, files);
    const mod: CatalogMod = {
      id,
      layer,
      name: typeof json.name === "string" ? json.name : id,
      description: (typeof json.description === "string" ? json.description : readmeLead(await readText(path.join(dir, "README.md")))) ?? "",
      version: typeof json.version === "string" ? json.version : "",
      blocks: strings(json.blocks) ?? scanned.blocks,
      hooks: strings(json.hooks) ?? scanned.hooks,
      settings: strings(json.settings) ?? scanned.settings,
      ...(parsed.success && parsed.data.clonedFrom ? { clonedFrom: parsed.data.clonedFrom } : {}),
      state: stateOf(id, layer, config),
    };
    if (errors.length > 0) mod.error = errors.join("\n");
    out.push(mod);
  }
  return out;
}

/** Whether a layout file is there and the app would use it (it parses and passes `layoutSchema`). */
async function usable(file: string): Promise<boolean> {
  const json = await readJson(file);
  return json !== undefined && layoutSchema.safeParse(json).success;
}

/** The layouts of the three layers (the person's first); the shown one by the app's order (shell's `shownLayout`). */
async function layoutsOf(home: string): Promise<CatalogLayout[]> {
  const dir = (layer: Layer) => path.join(home, LAYER_DIRS[layer], "layouts");
  const out: CatalogLayout[] = [];
  for (const layer of ["user", "harness", "core"] as const) {
    const entries = await fs.readdir(dir(layer), { withFileTypes: true }).catch(() => []);
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name.slice(0, -".json".length)).filter((n) => LAYOUT_NAME.test(n));
    if (layer === "core" && !names.includes("main")) names.push("main");
    for (const name of names.sort()) out.push({ name, layer, shown: false });
  }
  const settings = await readJson(path.join(home, "settings.json"));
  const picked = isObj(settings) && typeof settings.layout === "string" && LAYOUT_NAME.test(settings.layout) ? settings.layout : undefined;
  const order: [Layer, string][] = [...(picked ? ([["user", picked], ["harness", picked]] as [Layer, string][]) : []), ["harness", "main"], ["core", "main"]];
  let shown: [Layer, string] = ["core", "main"];
  for (const [layer, name] of order) {
    if (await usable(path.join(dir(layer), `${name}.json`))) {
      shown = [layer, name];
      break;
    }
  }
  for (const l of out) l.shown = l.layer === shown[0] && l.name === shown[1];
  return out;
}

/** `hh.d.ts`'s modules: name → its body's lines (one level in, as the generator writes them). */
function dtsModules(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    const start = /^declare module "([^"]+)" \{$/.exec(line);
    if (start) out.set(start[1], (current = []));
    else if (line === "}") current = undefined;
    else current?.push(line);
  }
  return out;
}

/** The first line of the doc comment that ends just above `lines[i]`. */
function docAbove(lines: string[], i: number): string | undefined {
  const prev = lines[i - 1]?.trim();
  if (!prev?.endsWith("*/")) return undefined;
  let j = i - 1;
  while (j >= 0 && !lines[j].trim().startsWith("/**")) j--;
  if (j < 0) return undefined;
  const body = lines.slice(j, i).join("\n").replace(/^\s*\/\*\*/, "").replace(/\*\/\s*$/, "");
  return body.split("\n").map((l) => l.replace(/^\s*\*?\s?/, "").trim()).find((l) => l.length > 0);
}

/** What a module of `hh.d.ts` exports, each name with its doc line, following `export *` and `export { } from`. */
function exportsOf(modules: Map<string, string[]>, name: string, seen = new Set<string>()): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const lines = modules.get(name);
  if (!lines || seen.has(name)) return out;
  seen.add(name);
  const add = (n: string, doc: string | undefined) => {
    if (!out.has(n) || (out.get(n) === undefined && doc !== undefined)) out.set(n, doc);
  };
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith("  export ") || line.startsWith("   ")) continue;
    const star = /^ {2}export \* from "([^"]+)";/.exec(line);
    if (star) {
      for (const [n, d] of exportsOf(modules, star[1], seen)) add(n, d);
      continue;
    }
    const named = /^ {2}export (?:type )?\{([^}]*)\} from "([^"]+)";/.exec(line);
    if (named) {
      const from = exportsOf(modules, named[2], new Set(seen));
      for (const part of named[1].split(",").map((p) => p.trim().replace(/^type\s+/, "")).filter(Boolean)) {
        const [orig, as = orig] = part.split(/\s+as\s+/);
        add(as, from.get(orig));
      }
      continue;
    }
    const decl = /^ {2}export (?:declare )?(?:abstract )?(?:function|const|let|var|type|interface|class|enum|namespace) ([A-Za-z_$][\w$]*)/.exec(line);
    if (decl) add(decl[1], docAbove(lines, i));
  }
  return out;
}

/** The names `hh.d.ts` exports from the importable modules (not `_internal`), with their doc lines. */
async function typesOf(home: string): Promise<CatalogType[]> {
  const text = await readText(path.join(home, "hh.d.ts"));
  if (text === null) return [];
  const modules = dtsModules(text);
  const out: CatalogType[] = [];
  for (const module of modules.keys()) {
    if (module.includes("/_internal/")) continue;
    for (const [name, doc] of exportsOf(modules, module)) out.push(doc === undefined ? { module, name } : { module, name, doc });
  }
  return out;
}

/**
 * What the app is made of, read from its home folder: every mod of the three layers (with its state from the app's
 * `config.json` beside the folder), the layouts and which one shows, and the names `hh.d.ts` types.
 */
export async function catalog(home: string): Promise<Catalog> {
  const config = await modsConfig(home);
  const mods = [...(await modsOf(home, "core", config)), ...(await modsOf(home, "harness", config)), ...(await modsOf(home, "user", config))];
  return { mods, layouts: await layoutsOf(home), types: await typesOf(home) };
}
