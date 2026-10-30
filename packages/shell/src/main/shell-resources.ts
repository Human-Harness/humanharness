/**
 * The shell's resources folder: the plugin and tool hosts' pages, scripts and preloads, and the Dock icon. Never
 * relative to the built main: a build into HH_OUT_DIR (`humanharness dev --build <dir>`, the e2e builds) puts main at
 * `<dir>/main`, where `<main>/../../resources` names a folder that doesn't exist.
 *
 * - A development build (`app:build` into out/, `dev`, any HH_OUT_DIR): `built`, the absolute packages/shell/resources
 *   the build wrote in as `__SHELL_RESOURCES__` (as `__HARNESS_DIR__`).
 * - A packaged app: its own `process.resourcesPath`, where the packager puts these files (plan 4b); never a path of
 *   the machine that built it.
 */
export function shellResourcesDir(o: { packaged: boolean; resourcesPath: string; built: string }): string {
  return o.packaged ? o.resourcesPath : o.built;
}
