import { existsSync, promises as fs, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { loadHarness } from "@humanharness/harness-sdk";
import { layoutSchema } from "@humanharness/mod-sdk";
import { CORE_DIR, MANIFEST } from "../paths";
import { LAYOUT_NAME, type ModInfo, readMods } from "./catalog";

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

/** A mod a harness can compose: as its folder says it, and whether the manifest's `mods` declares it. */
export type HarnessMod = ModInfo & { declared: boolean };
export type HarnessCatalog =
  | {
      project: true;
      dir: string;
      core: string;
      /** The core's mods: declare one in the manifest's `mods` to use it as is, or clone it to change it. */
      coreMods: HarnessMod[];
      /** The core's layouts, to clone into `layouts/`. */
      coreLayouts: { name: string; file: string }[];
      /** The project's own `mods/<id>`. */
      mods: HarnessMod[];
      /** The project's own `layouts/<name>.json`, with why one won't load. */
      layouts: { name: string; error?: string }[];
      /** The ids the manifest's `mods` map names. */
      declared: string[];
      /** Why the manifest couldn't be read; `declared` is then empty. */
      manifestError?: string;
    }
  | { project: false; dir: string; next: string };

async function declaredMods(dir: string): Promise<{ declared: string[]; manifestError?: string }> {
  try {
    return { declared: Object.keys((await loadHarness(path.join(dir, MANIFEST))).mods ?? {}) };
  } catch (err) {
    return { declared: [], manifestError: (err instanceof Error ? err.message : String(err)).split("\n")[0] };
  }
}

/** Why a layout file won't load, or undefined when it is a valid layout. */
async function layoutProblem(file: string): Promise<string | undefined> {
  try {
    const r = layoutSchema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    return r.success ? undefined : (r.error.issues[0]?.message ?? "not a layout");
  } catch {
    return "not valid JSON";
  }
}

async function projectLayouts(dir: string): Promise<{ name: string; error?: string }[]> {
  const files = (await fs.readdir(path.join(dir, "layouts")).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (f) => {
      const name = f.slice(0, -".json".length);
      const error = LAYOUT_NAME.test(name) ? await layoutProblem(path.join(dir, "layouts", f)) : "the app reads only names of letters, digits, - and _";
      return error === undefined ? { name } : { name, error };
    }),
  );
}

/**
 * What a harness can be composed of: the core's mods and layouts, the project's own `mods/` and `layouts/`, and which
 * mods the manifest declares. Read from the files; nothing is written.
 */
export async function harnessCatalog(dir: string, core: string): Promise<HarnessCatalog> {
  if (!isHarnessProject(dir)) {
    return { project: false, dir, next: `${dir} has no ${MANIFEST}: harness_init (humanharness init) makes a harness project there, with a sample mod and a layout.` };
  }
  const { declared, manifestError } = await declaredMods(dir);
  const mark = (mods: ModInfo[]): HarnessMod[] => mods.map((m) => ({ ...m, declared: declared.includes(m.id) }));
  const layoutFile = coreLayoutFile(core);
  return {
    project: true,
    dir,
    core,
    coreMods: mark(await readMods(coreModsDir(core))),
    coreLayouts: existsSync(layoutFile) ? [{ name: "main", file: layoutFile }] : [],
    mods: mark(await readMods(path.join(dir, "mods"))),
    layouts: await projectLayouts(dir),
    declared,
    ...(manifestError !== undefined ? { manifestError } : {}),
  };
}
