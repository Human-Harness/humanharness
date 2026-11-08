import { promises as fs } from "node:fs";
import path from "node:path";
import { type ModJson, modJsonSchema } from "@humanharness/mod-sdk";
import type { ModOrigin } from "./config";

export interface ResolvedMod {
  json: ModJson;
  dir: string;
  /** For the on/off rule: "harness" when the manifest declares it, whoever shipped it. */
  origin: ModOrigin;
  /** Who shipped the code. */
  shipped: ModOrigin;
  config: Record<string, unknown> | undefined;
}
export interface ResolveProblem {
  id: string;
  reason: string;
}

async function readJson(dir: string): Promise<ModJson> {
  const raw = JSON.parse(await fs.readFile(path.join(dir, "mod.json"), "utf8")) as unknown;
  const r = modJsonSchema.safeParse(raw);
  if (!r.success) throw new Error(`mod.json: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Every mod this app could run, read without running code: the harness's declared ones (a core mod of that id first,
 * else `<harnessModsDir>/<id>`), then the core mods it doesn't declare, then the person's local folders.
 * Problems are reported, never thrown.
 */
export async function resolveMods(o: {
  declared: Record<string, Record<string, unknown>> | undefined;
  harnessModsDir: string;
  local: string[];
  core: Record<string, { dir: string }>;
}): Promise<{ mods: ResolvedMod[]; problems: ResolveProblem[] }> {
  const mods: ResolvedMod[] = [];
  const problems: ResolveProblem[] = [];
  const taken = (id: string) => mods.some((m) => m.json.id === id);
  for (const [id, config] of Object.entries(o.declared ?? {})) {
    const core = Object.hasOwn(o.core, id) ? o.core[id] : undefined;
    const dir = core ? core.dir : path.join(o.harnessModsDir, id);
    try {
      const json = await readJson(dir);
      if (json.id !== id) throw new Error(`mod.json says "${json.id}"`);
      mods.push({ json, dir, origin: "harness", shipped: core ? "core" : "harness", config });
    } catch (err) {
      problems.push({ id, reason: why(err) });
    }
  }
  // Core mods the manifest doesn't declare are listed too, off, so the person can turn them on; before the local
  // folders, so a local folder can't take a core id.
  for (const [id, { dir }] of Object.entries(o.core)) {
    if (taken(id)) continue;
    try {
      const json = await readJson(dir);
      if (json.id !== id) throw new Error(`mod.json says "${json.id}"`);
      mods.push({ json, dir, origin: "core", shipped: "core", config: undefined });
    } catch (err) {
      problems.push({ id, reason: why(err) });
    }
  }
  for (const dir of o.local) {
    try {
      const json = await readJson(dir);
      if (taken(json.id)) throw new Error(`the id "${json.id}" is already used`);
      mods.push({ json, dir, origin: "local", shipped: "local", config: undefined });
    } catch (err) {
      problems.push({ id: dir, reason: why(err) });
    }
  }
  return { mods, problems };
}
