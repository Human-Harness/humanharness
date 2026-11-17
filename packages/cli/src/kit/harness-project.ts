import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { CORE_DIR, MANIFEST } from "../paths";

/**
 * Where the kit works in harness mode: the harness project (its `mods/` and `layouts/`) and the core checkout it is
 * built on (the core mods it can compose and clone).
 */
export interface HarnessRoot {
  harness: string;
  core: string;
}
/** The app's home folder (app mode), or a harness project and its core (harness mode). */
export type KitRoot = string | HarnessRoot;

/** The folder a new mod (`mods/<id>`) or a layout clone (`layouts/<as>.json`) goes in. */
export const rootDir = (root: KitRoot): string => (typeof root === "string" ? root : root.harness);

/** Whether `dir` is a harness project: it has the manifest. */
export const isHarnessProject = (dir: string): boolean => existsSync(path.join(dir, MANIFEST));

/** The core's mods: `<core>/packages/mods/<id>`. */
export const coreModsDir = (core: string): string => path.join(core, "packages", "mods");
/** The core's default layout, the one the app ships as `core/layouts/main.json`. */
export const coreLayoutFile = (core: string): string => path.join(core, "packages", "shell", "src", "main", "mods", "default-layout.json");

/**
 * The core checkout a harness project is built on: where its `@humanharness/cli` link points (installed, else the
 * `link:` in package.json), else the one this CLI runs from.
 */
export function coreOf(dir: string): string {
  try {
    return path.resolve(realpathSync(path.join(dir, "node_modules", "@humanharness", "cli")), "..", "..");
  } catch {
    // Not installed: read the link from package.json.
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, unknown> };
    const dep = pkg.dependencies?.["@humanharness/cli"];
    if (typeof dep === "string" && dep.startsWith("link:")) return path.resolve(dir, dep.slice("link:".length), "..", "..");
  } catch {
    // No package.json yet (a new folder): the running CLI's core.
  }
  return CORE_DIR;
}
