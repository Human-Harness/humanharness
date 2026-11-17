import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type * as KitCheck from "../src/kit/check";
import { CORE } from "./helpers";

const TEMPLATE_MOD = path.join(CORE, "packages", "cli", "template", "mods", "example");

/** The files of a mod folder and their bytes, as one hash. */
function folderHash(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const hash = createHash("sha256");
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
  for (const file of files) hash.update(`${path.relative(dir, file)}\0`).update(fs.readFileSync(file)).update("\0");
  return hash.digest("hex");
}

const TEMPLATE_HASH = folderHash(TEMPLATE_MOD);

/**
 * For tests about something other than mods (check rules, dev, run, plugins): the template's untouched sample mod
 * passes without its bundles and render. A real `checkMod` builds the ui runtime once per process (~5–10 s), and every
 * harness made with `init` has the mod, so under a parallel run those tests crossed their timeouts. Any other mod
 * folder gets the real check. check-mods.test.ts and init.test.ts never use this: they check the template's mod for
 * real.
 *
 * Use it as `vi.mock("../src/kit/check", async (real) => (await import("./stub-mod-check")).withStub(await real()))`.
 */
export function withStub(real: typeof KitCheck): typeof KitCheck {
  const checkMod: typeof KitCheck.checkMod = async (home, folder) => {
    if (TEMPLATE_HASH !== null && folderHash(path.resolve(typeof home === "string" ? home : home.harness, folder)) === TEMPLATE_HASH) {
      return { ok: true, checks: [{ name: "mod.json", ok: true }, { name: "ui", ok: true, detail: "stubbed: the template's mod" }] };
    }
    return real.checkMod(home, folder);
  };
  return { ...real, checkMod };
}
