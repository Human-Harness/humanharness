import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { MOD_ID, modJsonSchema } from "@humanharness/mod-sdk";
import { CliError } from "../cli";

/** The layout file names the app reads (shell's layout.ts). */
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface ClonedMod {
  id: string;
  path: string;
  clonedFrom: { id: string; version: string };
  /** Where it was copied from, relative to the home folder (`core/mods/home`). */
  source: string;
}
export interface ClonedLayout {
  name: string;
  path: string;
  /** Where it was copied from, relative to the home folder (`harness/layouts/main.json`). */
  source: string;
}

/** Throws unless `as` can name a layout file. */
export function assertLayoutName(as: string): void {
  if (!LAYOUT_NAME.test(as)) throw new CliError(`${as} isn't a valid layout name: letters, digits, - and _`);
}

/** Throws unless `as` can be a mod's id. */
export function assertModId(as: string): void {
  if (!MOD_ID.test(as)) throw new CliError(`${as} isn't a valid mod id: lowercase letters, digits and -, at most 40`);
}

/** Copies the harness's layout `name` (else the core's) to `layouts/<as>.json` in the home folder. */
export async function cloneLayout(home: string, name: string, as = name): Promise<ClonedLayout> {
  assertLayoutName(as);
  const target = path.join(home, "layouts", `${as}.json`);
  if (existsSync(target)) throw new CliError(`${target} already exists`);
  const source = LAYOUT_NAME.test(name) ? ["harness", "core"].map((l) => path.join(home, l, "layouts", `${name}.json`)).find((f) => existsSync(f)) : undefined;
  if (!source) throw new CliError(`No layout ${name} in harness/layouts or core/layouts`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return { name: as, path: target, source: path.relative(home, source) };
}

/** The source file of a built entry (`ui.js` → `src/ui.tsx`); the entry itself when it is a source already. */
function sourceEntry(dir: string, entry: string): string | undefined {
  const stem = entry.replace(/\.(m?js|cjs|tsx?|jsx)$/, "");
  const tries = ["tsx", "ts", "jsx"].flatMap((ext) => [path.join("src", `${path.basename(stem)}.${ext}`), `${stem}.${ext}`]);
  for (const t of [...tries, entry]) if (existsSync(path.join(dir, t))) return t.split(path.sep).join("/");
  return undefined;
}

const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && SOURCE_FILE.test(e.name)) out.push(path.join(e.parentPath, e.name));
  }
  return out;
}

/** Copies a core or harness mod to `mods/<as>` with its source entries, the new id and `clonedFrom`. */
export async function cloneMod(home: string, id: string, as = id): Promise<ClonedMod> {
  assertModId(as);
  const target = path.join(home, "mods", as);
  if (existsSync(target)) throw new CliError(`${target} already exists`);
  const source = MOD_ID.test(id) ? ["core", "harness"].map((l) => path.join(home, l, "mods", id)).find((d) => existsSync(path.join(d, "mod.json"))) : undefined;
  if (!source) throw new CliError(`No mod ${id} in core/mods or harness/mods`);

  const raw = JSON.parse(await fs.readFile(path.join(source, "mod.json"), "utf8")) as Record<string, unknown>;
  const parsed = modJsonSchema.safeParse(raw);
  if (!parsed.success) throw new CliError(`${path.join(source, "mod.json")} isn't valid: ${parsed.error.issues[0]?.message}`);
  const json = parsed.data;
  const entries: Partial<Record<"main" | "ui", string>> = {};
  for (const key of ["main", "ui"] as const) {
    const entry = json[key];
    if (entry === undefined) continue;
    const src = sourceEntry(source, entry);
    if (!src) throw new CliError(`${id}'s ${key} (${entry}) has no source file to copy`);
    entries[key] = src;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, filter: (f) => !f.split(path.sep).includes("node_modules") });
  const clonedFrom = { id: json.id, version: json.version };
  const next = { ...raw, id: as, ...entries, clonedFrom };
  await fs.writeFile(path.join(target, "mod.json"), `${JSON.stringify(next, null, 2)}\n`);
  if (as !== id) {
    const pattern = new RegExp(`(defineMod\\(\\s*\\{\\s*id:\\s*)(["'])${id}\\2`, "g");
    for (const file of await sourceFiles(target)) {
      const text = await fs.readFile(file, "utf8");
      const changed = text.replace(pattern, (_m, head: string, q: string) => `${head}${q}${as}${q}`);
      if (changed !== text) await fs.writeFile(file, changed);
    }
  }
  return { id: as, path: target, clonedFrom, source: path.relative(home, source) };
}
