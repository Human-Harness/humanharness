import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type * as PluginBuild from "../src/plugin-build";

/**
 * For tests about something other than the plugin build (`plugin dev`, `plugin check`): a plugin whose sources did not
 * change since its last build, and whose dist/ is still there, is not built again. A plugin build is 1-3 s of esbuild
 * (React and plugin-ui are bundled), and `plugin dev` and `plugin check` run it every time, so a file that opens the
 * same plugin in each test spent most of its time on the same build.
 *
 * Use it as `vi.mock("../src/plugin-build", async (real) => (await import("./cached-plugin-build")).withCache(await real()))`.
 * Only successful builds are remembered; a failing build runs every time. Tests of the build itself
 * (plugin-build.test.ts) never use this.
 */
export function withCache(real: typeof PluginBuild): typeof PluginBuild {
  const done = new Map<string, Awaited<ReturnType<typeof PluginBuild.buildPlugin>>>();
  const buildPlugin: typeof PluginBuild.buildPlugin = async (dir, o = {}) => {
    const out = path.resolve(o.out ?? path.join(dir, "dist"));
    const key = createHash("sha256").update(`${path.resolve(dir)}\0${out}\0`).update(sources(path.resolve(dir))).digest("hex");
    const hit = done.get(key);
    if (hit && fs.existsSync(path.join(out, "plugin.json"))) return hit;
    const built = await real.buildPlugin(dir, o);
    done.set(key, built);
    return built;
  };
  return { ...real, buildPlugin };
}

/** Every file of the plugin folder but dist/, node_modules/ and dot-folders: name and bytes. */
function sources(dir: string): Buffer {
  const hash = createHash("sha256");
  const walk = (folder: string) => {
    for (const e of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "dist" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const file = path.join(folder, e.name);
      if (e.isDirectory()) walk(file);
      else hash.update(`${path.relative(dir, file)}\0`).update(fs.readFileSync(file)).update("\0");
    }
  };
  walk(dir);
  return hash.digest();
}
