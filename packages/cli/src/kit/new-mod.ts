import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "../cli";
import { assertModId } from "./clone";

/** The smallest mod that passes `checkMod`, with `__ID__`, `__NAME__`, `__DESCRIPTION__` and `__BLOCK__` to fill. */
const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mod-template");
/** A block's name: what a layout's `{ "mod", "block" }` names. */
const BLOCK_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export interface NewMod {
  id: string;
  path: string;
  block: string;
}

/**
 * Makes `mods/<id>/` in the home folder from the mod template: a `main`, one block (`block`, default `main`) and a
 * README. Refuses an id a core or harness mod has: that one is cloned (`mod clone`), not made again.
 */
export async function newMod(home: string, o: { id: string; name: string; description: string; block?: string }): Promise<NewMod> {
  const block = o.block ?? "main";
  assertModId(o.id);
  if (!BLOCK_NAME.test(block)) throw new CliError(`${block} isn't a valid block name: lowercase letters, digits and -, at most 40`);
  const name = o.name.trim();
  if (name.length === 0 || name.length > 60) throw new CliError("A mod's name has 1 to 60 characters");
  const layer = ["core", "harness"].find((l) => existsSync(path.join(home, l, "mods", o.id)));
  if (layer) throw new CliError(`${o.id} is a ${layer} mod: clone it with mod_clone (humanharness mod clone ${o.id}) to change it, or pick another id`);
  const target = path.join(home, "mods", o.id);
  if (existsSync(target)) throw new CliError(`${target} already exists`);

  const description = o.description.trim() || "What this mod does.";
  // Each placeholder as the file needs it: quoted values go in as JSON strings (a quote in the name stays a quote).
  const fill = (text: string) =>
    text
      .replaceAll('"__NAME__"', JSON.stringify(name))
      .replaceAll("__NAME__", name)
      .replaceAll("__DESCRIPTION__", description)
      .replaceAll("__ID__", o.id)
      .replaceAll("__BLOCK__", block);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Written to a temporary folder first, so a failure leaves no half mod for the app's watcher.
  const tmp = await fs.mkdtemp(path.join(path.dirname(target), `.${o.id}-`));
  try {
    for (const file of await fs.readdir(TEMPLATE)) {
      await fs.writeFile(path.join(tmp, file), fill(await fs.readFile(path.join(TEMPLATE, file), "utf8")));
    }
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
  return { id: o.id, path: target, block };
}
