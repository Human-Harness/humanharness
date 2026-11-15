import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHARED_IMPORTS } from "@humanharness/mod-sdk/bundle";
import { CliError } from "../cli";
import { assertModId } from "./clone";

/** The smallest mod that passes `checkMod`: mod.json, main.ts, ui.tsx with one block, README.md. */
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mod-template");
/** A block's name: what a layout's `{ "mod", "block" }` names. */
const BLOCK_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export interface NewModInput {
  id: string;
  name: string;
  description: string;
  /** The block `ui.tsx` registers; `main` when absent. */
  block?: string;
}
export interface NewMod {
  id: string;
  path: string;
  block: string;
  /** The files written, relative to `path`. */
  files: string[];
}

/** Creates `mods/<id>/` from the template with the id, name, description and block filled in. */
export async function newMod(home: string, input: NewModInput): Promise<NewMod> {
  const { id, name, description } = input;
  const block = input.block ?? "main";
  assertModId(id);
  for (const layer of ["core", "harness"]) {
    if (existsSync(path.join(home, layer, "mods", id))) {
      throw new CliError(`${id} is a ${layer} mod: copy it into your layer with mod_clone (humanharness mod clone ${id}) instead`);
    }
  }
  if (name.trim() === "" || name.length > 60) throw new CliError("A mod's name is 1 to 60 characters");
  if (!BLOCK_NAME.test(block)) throw new CliError(`${block} isn't a valid block name: lowercase letters, digits and -, at most 40`);
  const target = path.join(home, "mods", id);
  if (existsSync(target)) throw new CliError(`${target} already exists: pick another id, or edit that mod`);

  const imports = [...SHARED_IMPORTS].map((s) => `\`${s}\``).join(", ");
  // Quoted placeholders become JSON strings (safe in code); a function replacer keeps `$` in a value as it is.
  const values: [string, string][] = [
    ['"__ID__"', JSON.stringify(id)],
    ['"__NAME__"', JSON.stringify(name)],
    ['"__BLOCK__"', JSON.stringify(block)],
    ["__ID__", id],
    ["__BLOCK__", block],
    ["__TITLE__", name],
    ["__IMPORTS__", imports],
    ["__DESCRIPTION__", description.trim() || "(No description yet.)"],
  ];
  const fill = (text: string) => values.reduce((t, [key, value]) => t.replaceAll(key, () => value), text);

  const files = (await fs.readdir(TEMPLATE)).sort();
  await fs.mkdir(target, { recursive: true });
  for (const file of files) {
    const text = await fs.readFile(path.join(TEMPLATE, file), "utf8");
    const out = file === "mod.json" ? `${JSON.stringify({ ...(JSON.parse(text) as object), id, name }, null, 2)}\n` : fill(text);
    await fs.writeFile(path.join(target, file), out);
  }
  return { id, path: target, block, files };
}
