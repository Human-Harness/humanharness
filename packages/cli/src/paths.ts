import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** packages/cli of the core checkout this CLI runs from (a harness repo links here). */
export const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The core checkout: `init`'s default `--core`. */
export const CORE_DIR = path.resolve(CLI_DIR, "../..");
/** The harness's manifest file, in every harness folder. */
export const MANIFEST = "harness.config.ts";
/** The harness's living decision log. */
export const HARNESS_MD = "HARNESS.md";

/** packages/cli inside a core checkout. */
export const cliDirOf = (core: string) => path.join(core, "packages", "cli");
export const templateDirOf = (core: string) => path.join(cliDirOf(core), "template");
export const guideFileOf = (core: string) => path.join(cliDirOf(core), "guide", "new-harness.md");
/** What `plugin init` copies and installs (plugins spec §9.1, §9.4). */
export const pluginTemplateDirOf = (core: string) => path.join(cliDirOf(core), "plugin-template");
export const pluginGuideFileOf = (core: string) => path.join(cliDirOf(core), "guide", "new-plugin.md");

/** packages/shell, resolved as this package's dependency: `dev` runs its electron-vite there. */
export function shellDir(): string {
  return path.dirname(createRequire(import.meta.url).resolve("@humanharness/shell/package.json"));
}
