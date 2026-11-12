import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** A read-only layer's sources: mod id → its folder, layout name → its `.json` file. */
export interface Layer {
  mods: Record<string, string>;
  layouts: Record<string, string>;
}

const LAYERS = ["core", "harness"] as const;
type LayerName = (typeof LAYERS)[number];
/** `.layers.json`: path under the home folder (with `/`) → sha256 of what the app wrote there last time. */
const RECORD = ".layers.json";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const posix = (p: string) => p.split(path.sep).join("/");
const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Every regular file under `dir`, as paths relative to it; none when it doesn't exist. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

/** The harness's layer: its declared mods that have a `mods/<id>/` folder (core ids already left out) and `layouts/*.json`. */
export async function harnessLayer(root: string, declared: string[]): Promise<Layer> {
  const mods: Record<string, string> = {};
  for (const id of declared) {
    const dir = path.join(root, "mods", id);
    if ((await fs.stat(dir).catch(() => null))?.isDirectory()) mods[id] = dir;
  }
  const layouts: Record<string, string> = {};
  const names = await fs.readdir(path.join(root, "layouts"), { withFileTypes: true }).catch(() => []);
  for (const e of names) if (e.isFile() && e.name.endsWith(".json")) layouts[e.name.slice(0, -".json".length)] = path.join(root, "layouts", e.name);
  return { mods, layouts };
}

/** What a layer should hold: home-relative path → source file. */
async function wanted(name: LayerName, layer: Layer): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, dir] of Object.entries(layer.mods)) for (const rel of await filesUnder(dir)) out.set(`${name}/mods/${id}/${posix(rel)}`, path.join(dir, rel));
  for (const [layout, file] of Object.entries(layer.layouts)) out.set(`${name}/layouts/${layout}.json`, file);
  return out;
}

/**
 * The edited item a file belongs to: a mod folder or a layout file, with where it moves in the user layer. Any other
 * file (a stray: `core/notes.md`, `harness/layouts/sub/x.json`) is its own item and moves to the same path without
 * the layer, `-edited` before its extension.
 */
function itemOf(rel: string): { from: string; to: (n: number) => string; stray?: true } {
  const [, kind, name, ...rest] = rel.split("/");
  if (kind === "mods" && name && rest.length > 0) {
    const from = rel.split("/").slice(0, 3).join("/");
    return { from, to: (n) => `mods/${name}-edited${n > 1 ? `-${n}` : ""}` };
  }
  if (kind === "layouts" && name?.endsWith(".json") && rest.length === 0) {
    const base = name.slice(0, -".json".length);
    return { from: rel, to: (n) => `layouts/${base}-edited${n > 1 ? `-${n}` : ""}.json` };
  }
  const under = rel.split("/").slice(1).join("/");
  const ext = path.posix.extname(under);
  const stem = under.slice(0, under.length - ext.length);
  return { from: rel, to: (n) => `${stem}-edited${n > 1 ? `-${n}` : ""}${ext}`, stray: true };
}

/** Writes a file through a temp file and a rename, so a reader never sees half of it. */
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Removes empty folders under `dir` (deepest first), keeping `dir`. */
async function pruneEmpty(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    await pruneEmpty(sub);
    if ((await fs.readdir(sub)).length === 0) await fs.rmdir(sub);
  }
}

/**
 * Rewrites the home folder's read-only layers, `core/` and `harness/`, from the app's sources (spec §5.1). A file
 * there that differs from what the app wrote last time, or that the app never wrote, is the person's edit: its mod
 * folder moves to `mods/<id>-edited` (a layout to `layouts/<name>-edited.json`), the original comes back, and
 * `notice` says so once per moved item. Runs on every start; a failure is logged and never stops the app.
 */
export async function writeLayers(o: { home: string; core: Layer; harness: Layer; notice: (text: string) => void }): Promise<void> {
  try {
    const recordFile = path.join(o.home, RECORD);
    const raw = await fs.readFile(recordFile, "utf8").catch(() => "{}");
    let last: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) last = parsed as Record<string, unknown>;
    } catch {
      console.error(`${recordFile} is not valid JSON: every file in the layers counts as an edit`);
    }

    const want = new Map<string, { data: Buffer; hash: string }>();
    for (const [key, src] of [...(await wanted("core", o.core)), ...(await wanted("harness", o.harness))]) {
      const data = await fs.readFile(src);
      want.set(key, { data, hash: sha(data) });
    }

    // 1. The person's edits: what's on disk against what the app wrote.
    const edited = new Map<string, { to: (n: number) => string; stray?: true }>();
    const onDisk = new Map<string, string>();
    for (const layer of LAYERS) {
      for (const rel of await filesUnder(path.join(o.home, layer))) {
        const key = `${layer}/${posix(rel)}`;
        const hash = sha(await fs.readFile(path.join(o.home, key)));
        onDisk.set(key, hash);
        // Same as last written, or already what this start writes (a start cut short before the record): not an edit.
        if (last[key] === hash || want.get(key)?.hash === hash) continue;
        const item = itemOf(key);
        edited.set(item.from, item);
      }
    }

    // 2. Move each edited item aside, to a free name in the user layer.
    const moved: { from: string; dest: string; stray?: true }[] = [];
    for (const [from, { to, stray }] of edited) {
      let n = 1;
      while (await exists(path.join(o.home, to(n)))) n += 1;
      const dest = to(n);
      await fs.mkdir(path.dirname(path.join(o.home, dest)), { recursive: true });
      await fs.rename(path.join(o.home, from), path.join(o.home, dest));
      moved.push({ from, dest, ...(stray ? { stray } : {}) });
      for (const key of [...onDisk.keys()]) if (key === from || key.startsWith(`${from}/`)) onDisk.delete(key);
    }

    // 3. Rewrite: what differs or is missing, and drop what the layers no longer have.
    const record: Record<string, string> = {};
    for (const [key, { data, hash }] of want) {
      record[key] = hash;
      if (onDisk.get(key) !== hash) await writeAtomic(path.join(o.home, key), data);
    }
    for (const key of onDisk.keys()) if (!want.has(key)) await fs.rm(path.join(o.home, key), { force: true });
    for (const layer of LAYERS) await pruneEmpty(path.join(o.home, layer));

    for (const m of moved) {
      o.notice(m.stray ? `Your file ${m.from} was moved to ${m.dest}; the app rewrites ${m.from.split("/")[0]}/ on every start.` : `Your change to ${m.from} was moved to ${m.dest}; the original is back.`);
    }

    // 4. The record last.
    const text = `${JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
    if (raw !== text) await writeAtomic(recordFile, text);
  } catch (err) {
    console.error("Could not write the app's home folder layers", err);
  }
}
