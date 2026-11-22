// A core mod's engine sessions (`ctx.app.sessions`, minimal-core 1a): their working folders and briefs, outside the base.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";

const ID = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Session `id`'s working folder for core mod `mod`: under the app's userData, one per base (so per profile), never
 * inside the base, so the task's CLAUDE.md / AGENTS.md never load into the session. Sidekick's (`sidekick`) stay
 * where they were.
 */
export function sessionWorkDir(userData: string, mod: string, base: string, id: string = mod): string {
  if (!ID.test(mod)) throw new Error(`Invalid mod id: "${mod}"`);
  if (!ID.test(id)) throw new Error(`Invalid session id: "${id}"`);
  const key = createHash("sha256").update(path.resolve(base)).digest("hex").slice(0, 16);
  return path.join(userData, mod, key, id);
}

/** Writes the brief as AGENTS.md (+ the engine's own file) when it changed, so the cached prefix survives. True when it wrote. */
export async function writeSessionBrief(folder: string, text: string, engine: EngineDef): Promise<boolean> {
  await fs.mkdir(folder, { recursive: true });
  let wrote = false;
  const put = async (name: string, content: string) => {
    const file = path.join(folder, name);
    if ((await fs.readFile(file, "utf8").catch(() => null)) === content) return;
    const tmp = path.join(folder, `.${name}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    wrote = true;
  };
  await put("AGENTS.md", text);
  const extra = engine.instructionsFile;
  if (extra) {
    if (path.basename(extra.path) !== extra.path) throw new Error(`Engine instructions file must be a plain file name, got "${extra.path}"`);
    await put(extra.path, extra.content);
  }
  return wrote;
}
