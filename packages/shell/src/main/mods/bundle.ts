// Build time only (electron.vite.config.ts): never imported by the running app.
import { promises as fs } from "node:fs";
import path from "node:path";
import { bundleMod } from "@humanharness/mod-sdk/build";

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

/** The source of a core mod's built main: `main.js` (or `.mjs`) is built from `src/main.ts` (or `.tsx`). */
async function mainSource(src: string, main: string): Promise<string> {
  const stem = path.basename(main).replace(/\.m?js$/, "");
  for (const ext of [".ts", ".tsx"]) if (await exists(path.join(src, "src", stem + ext))) return `src/${stem}${ext}`;
  throw new Error(`no src/${stem}.ts for its main "${main}"`);
}

/**
 * Copies each core mod's `mod.json`, `README.md` and `src/` from `<srcRoot>/<id>/` to `<dest>/<id>/`, where
 * `CORE_MODS[id].dir` points at runtime, and bundles its main part (when `mod.json` names one) into `<dest>/<id>/<main>`
 * under the core mods' import allowlist (mods-1a). A main that does not build fails the app's build.
 */
export async function buildCoreMods(srcRoot: string, dest: string, ids: readonly string[]): Promise<void> {
  await fs.rm(dest, { recursive: true, force: true });
  for (const id of ids) {
    const src = path.join(srcRoot, id);
    for (const part of ["mod.json", "README.md", "src"]) {
      const from = path.join(src, part);
      if (await exists(from)) await fs.cp(from, path.join(dest, id, part), { recursive: true });
    }
    const json = JSON.parse(await fs.readFile(path.join(src, "mod.json"), "utf8")) as { main?: string };
    if (json.main === undefined) continue;
    try {
      const r = await bundleMod({
        dir: src,
        entry: await mainSource(src, json.main),
        part: "main",
        core: true,
        outFile: path.join(dest, id, json.main),
        resolveShared: () => {
          throw new Error("a core mod reads its shared imports from the app");
        },
      });
      if (!r.ok) throw new Error(r.problems.join("\n"));
    } catch (err) {
      throw new Error(`The core mod "${id}" does not build:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
