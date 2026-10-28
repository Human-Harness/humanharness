import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import {
  type HarnessPlugins,
  PLUGIN_API,
  PLUGIN_ID,
  PLUGIN_JSON_MAX_BYTES,
  type PluginManifest,
  pluginCollections,
  pluginManifestSchema,
  pluginSettings,
  pluginsAccepted,
  z,
} from "@humanharness/harness-sdk";

/**
 * Plugin loading (plugins spec §3): bundled plugins from `<harness>/plugins/<id>/dist`, local ones from the
 * pointers file outside the work folder (B13), dev ones from HH_PLUGIN_DIRS. `dist/` is read as data only:
 * nothing in it ever runs here. A plugin folder is hostile input: a link that leaves `dist/`, a special file,
 * a folder too big or too deep makes the plugin unloadable (B3, B11), before anything in it is read.
 */

export type PluginOrigin = "bundled" | "local" | "dev";

export interface PluginEntry {
  id: string;
  origin: PluginOrigin;
  /** The `dist/` folder the app serves (absolute, realpath when the plugin loaded). */
  dist: string;
  /** What Settings shows: the plugin's folder for local ones ("local: ~/my-plugins/oncall"). */
  folder: string;
  manifest: PluginManifest | null;
  distHash?: string;
  error?: string;
}

export type DistRead = { ok: true; manifest: PluginManifest; distHash: string; dist: string } | { ok: false; error: string };

const BACKEND_MAX_BYTES = 5 * 1024 * 1024;
/** Files, folders and links together (Decision 21). */
const DIST_MAX_ENTRIES = 500;
const DIST_MAX_BYTES = 50 * 1024 * 1024;
const DIST_MAX_DEPTH = 32;
const TOO_LARGE = "dist is too large";
/** A hard link may share its bytes with a file outside `dist/`, and realpath can't tell: none are allowed. */
const hardLinked = (rel: string) => `${rel}: hard links are not allowed`;

interface Walked {
  files: { rel: string; real: string; size: number }[];
  /** Links to folders inside `dist/`: hashed by target, never walked (no loops, no double counting). */
  folderLinks: { rel: string; target: string }[];
}

const inside = (real: string, root: string) => real === root || real.startsWith(root + path.sep);

/** Every entry under `root` (a realpath), checked with lstat only: nothing is opened. A string is the refusal. */
async function walk(root: string): Promise<Walked | string> {
  const out: Walked = { files: [], folderLinks: [] };
  let entries = 0;
  let bytes = 0;
  const stack: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: "", depth: 0 }];
  while (stack.length > 0) {
    const { dir, rel, depth } = stack.pop()!;
    if (depth > DIST_MAX_DEPTH) return `${rel} is nested too deep`;
    const names: string[] = [];
    for await (const d of await fs.opendir(dir)) {
      if (++entries > DIST_MAX_ENTRIES) return TOO_LARGE;
      names.push(d.name);
    }
    for (const name of names) {
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = await fs.lstat(full);
      if (st.isDirectory()) {
        stack.push({ dir: full, rel: r, depth: depth + 1 });
      } else if (st.isFile()) {
        if (st.nlink > 1) return hardLinked(r);
        bytes += st.size;
        out.files.push({ rel: r, real: full, size: st.size });
      } else if (st.isSymbolicLink()) {
        let real: string;
        try {
          real = await fs.realpath(full);
        } catch {
          return `${r} is a broken link`;
        }
        if (!inside(real, root)) return `${r} points outside the plugin's dist folder`;
        const target = await fs.stat(real);
        if (target.isDirectory()) out.folderLinks.push({ rel: r, target: path.relative(root, real) });
        else if (target.isFile()) {
          if (target.nlink > 1) return hardLinked(r);
          bytes += target.size;
          out.files.push({ rel: r, real, size: target.size });
        } else return `${r} is not a regular file`;
      } else {
        return `${r} is not a regular file`;
      }
      if (bytes > DIST_MAX_BYTES) return TOO_LARGE;
    }
  }
  return out;
}

/**
 * At most `max + 1` bytes of a regular file, never blocking on a pipe; by default never following a link at
 * the last step and refusing a hard link (checked again on the open file, after the walk's lstat).
 */
async function readCapped(file: string, max: number, o: { follow?: boolean } = {}): Promise<Buffer> {
  const flags = constants.O_RDONLY | (o.follow ? 0 : (constants.O_NOFOLLOW ?? 0)) | (constants.O_NONBLOCK ?? 0);
  const h = await fs.open(file, flags);
  try {
    const st = await h.stat();
    if (!st.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
    if (!o.follow && st.nlink > 1) throw new Error(hardLinked(path.basename(file)));
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await h.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    return buf.subarray(0, n);
  } finally {
    await h.close();
  }
}

/** A zod error's first issue as "<path>: <message>"; anything else, its message. */
function firstIssue(err: unknown): string {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    if (!issue) return err.message;
    return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Reads and checks a plugin's `dist/` (spec §3.1) and hashes it. Never throws; never runs plugin code. */
export async function readDist(dist: string, harnessId: string): Promise<DistRead> {
  try {
    return await readDistOrThrow(dist, harnessId);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, error: code ? `Can't read the plugin folder (${code})` : firstIssue(err) };
  }
}

async function readDistOrThrow(dist: string, harnessId: string): Promise<DistRead> {
  let root: string;
  try {
    root = await fs.realpath(dist);
  } catch {
    return { ok: false, error: "There is no plugin folder here" };
  }
  if (!(await fs.stat(root)).isDirectory()) return { ok: false, error: "The plugin's dist is not a folder" };
  const walked = await walk(root);
  if (typeof walked === "string") return { ok: false, error: walked };
  const file = (rel: string) => walked.files.find((f) => f.rel === rel);

  const json = file("plugin.json");
  if (!json) return { ok: false, error: "plugin.json is missing" };
  if (json.size > PLUGIN_JSON_MAX_BYTES) return { ok: false, error: "plugin.json is over 256 KB" };
  const backend = file("backend.js");
  if (!backend) return { ok: false, error: "backend.js is missing" };
  if (backend.size > BACKEND_MAX_BYTES) return { ok: false, error: "backend.js is over 5 MB" };

  // A folder on the way may have been swapped for a link since the walk: every read re-checks its real path.
  const readInside = async (f: { rel: string; real: string }, max: number): Promise<Buffer | string> => {
    let real: string;
    try {
      real = await fs.realpath(f.real);
    } catch {
      return `${f.rel} changed while it was read`;
    }
    if (!inside(real, root)) return `${f.rel} points outside the plugin's dist folder`;
    return readCapped(real, max);
  };

  const text = await readInside(json, PLUGIN_JSON_MAX_BYTES);
  if (typeof text === "string") return { ok: false, error: text };
  if (text.length > PLUGIN_JSON_MAX_BYTES) return { ok: false, error: "plugin.json is over 256 KB" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.toString("utf8"));
  } catch {
    return { ok: false, error: "plugin.json is not valid JSON" };
  }
  // The api first: a newer plugin may carry fields this app doesn't know, and the schema would hide why.
  const api = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as { api?: unknown }).api : undefined;
  if (typeof api === "number" && api !== PLUGIN_API) {
    return { ok: false, error: `This plugin needs Human Harness plugin api ${api}; this app has ${PLUGIN_API}` };
  }
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const manifest = parsed.data;
  if (manifest.harness !== "*" && manifest.harness !== harnessId) return { ok: false, error: `This plugin is for the harness "${manifest.harness}"` };
  // Both can throw on what the manifest schema lets through (a bad key, a control the settings model refuses).
  try {
    pluginCollections(manifest);
  } catch (err) {
    return { ok: false, error: `data: ${firstIssue(err)}` };
  }
  try {
    pluginSettings(manifest);
  } catch (err) {
    return { ok: false, error: `settings: ${firstIssue(err)}` };
  }

  // distHash is what the person's approval binds to, and the backend runner executes the very bytes it
  // hashed (Task 15), so each byte hashed here must come from inside dist/ at the moment it is read.
  const lines: string[] = [];
  for (const f of walked.files) {
    const content = await readInside(f, f.size);
    if (typeof content === "string") return { ok: false, error: content };
    if (content.length !== f.size) return { ok: false, error: `${f.rel} changed while it was read` };
    lines.push(`${f.rel}\0${f.size}\0${createHash("sha256").update(content).digest("hex")}\n`);
  }
  for (const l of walked.folderLinks) lines.push(`${l.rel}\0link\0${l.target}\n`);
  lines.sort();
  const hash = createHash("sha256");
  for (const l of lines) hash.update(l);
  return { ok: true, manifest, distHash: hash.digest("hex"), dist: root };
}

const exists = (p: string) =>
  fs.lstat(p).then(
    () => true,
    () => false,
  );

/** The `dist/` of a picked folder: `<folder>/dist` when it holds plugin.json, else the folder itself when it does (Decision 18). */
export async function distFolderOf(folder: string): Promise<string | null> {
  const dist = path.join(folder, "dist");
  if (await exists(path.join(dist, "plugin.json"))) return dist;
  if (await exists(path.join(folder, "plugin.json"))) return folder;
  return null;
}

export interface PluginPointer {
  id: string;
  folder: string;
}

const FOLDER_MAX = 4096;
/** Far more than any real list of pointers; a bigger file is treated as corrupt. */
const POINTERS_MAX_BYTES = 1024 * 1024;
const validPointer = (id: unknown, folder: unknown): boolean =>
  typeof id === "string" && PLUGIN_ID.test(id) && typeof folder === "string" && folder.length <= FOLDER_MAX && path.isAbsolute(folder);

/**
 * The local plugins the person added: `~/.humanharness/<harness-id>/plugins.json`, a list of `{ id, folder }`
 * (B13: code never lands in the work folder). Written only when a plugin is added or removed.
 */
export class PluginPointers {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** A missing file is empty; a broken or oversized one reads as empty and is set aside on the next write. */
  async list(): Promise<PluginPointer[]> {
    return (await this.read()).list;
  }

  /** Adds a pointer, or moves an existing one to `folder`. */
  add(id: string, folder: string): Promise<void> {
    if (!validPointer(id, folder)) return Promise.reject(new Error("A plugin pointer needs a plugin id and an absolute folder"));
    return this.change((list) => (list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? { id, folder } : p)) : [...list, { id, folder }]));
  }

  remove(id: string): Promise<void> {
    return this.change((list) => list.filter((p) => p.id !== id));
  }

  private async read(): Promise<{ list: PluginPointer[]; broken: boolean }> {
    let buf: Buffer;
    try {
      buf = await readCapped(this.file, POINTERS_MAX_BYTES, { follow: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { list: [], broken: false };
      throw err;
    }
    if (buf.length > POINTERS_MAX_BYTES) return { list: [], broken: true };
    let raw: unknown;
    try {
      raw = JSON.parse(buf.toString("utf8"));
    } catch {
      return { list: [], broken: true };
    }
    const seen = new Set<string>();
    const list: PluginPointer[] = [];
    for (const v of Array.isArray(raw) ? raw : []) {
      if (typeof v !== "object" || v === null) continue;
      const { id, folder } = v as { id?: unknown; folder?: unknown };
      if (!validPointer(id, folder) || seen.has(id as string)) continue;
      seen.add(id as string);
      list.push({ id: id as string, folder: folder as string });
    }
    return { list, broken: false };
  }

  private change(fn: (list: PluginPointer[]) => PluginPointer[]): Promise<void> {
    const run = this.writes.then(async () => {
      const { list, broken } = await this.read();
      if (broken) await fs.rename(this.file, `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify(fn(list), null, 2)}\n`);
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}

/** One entry from a `dist/` read: the plugin, or an error entry under `id` (manifest null). */
async function entryOf(id: string, origin: PluginOrigin, dist: string, folder: string, harnessId: string, expectId: boolean): Promise<PluginEntry> {
  const r = await readDist(dist, harnessId);
  if (!r.ok) return { id, origin, dist, folder, manifest: null, error: r.error };
  if (expectId && r.manifest.id !== id) return { id, origin, dist, folder, manifest: null, error: `plugin.json says id "${r.manifest.id}", but this plugin is "${id}"` };
  return { id: r.manifest.id, origin, dist: r.dist, folder, manifest: r.manifest, distHash: r.distHash };
}

/**
 * Every plugin this harness can see, in order dev, bundled, local; on an id clash the first wins. D0: a
 * harness that takes no plugins, with no dev folders, gets `[]` before the pointers file is even read.
 */
export async function loadPlugins(o: {
  harness: { id: string; root: string; plugins?: HarnessPlugins };
  pointers: PluginPointers;
  devDirs: string[];
}): Promise<PluginEntry[]> {
  const { harness } = o;
  const plugins = pluginsAccepted(harness) ? harness.plugins : undefined;
  if (!plugins && o.devDirs.length === 0) return [];
  const out: PluginEntry[] = [];
  const seen = new Set<string>();
  const push = (e: PluginEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push(e);
  };

  for (const dir of o.devDirs) {
    const dist = await distFolderOf(dir);
    // A broken dev folder shows under its folder name, when that can be an id.
    const name = path.basename(dir) === "dist" ? path.basename(path.dirname(dir)) : path.basename(dir);
    if (!dist) {
      if (PLUGIN_ID.test(name)) push({ id: name, origin: "dev", dist: dir, folder: dir, manifest: null, error: "There is no plugin.json in this folder" });
      continue;
    }
    const e = await entryOf(name, "dev", dist, dir, harness.id, false);
    if (e.manifest || PLUGIN_ID.test(e.id)) push(e);
  }
  if (!plugins) return out;

  for (const id of plugins.bundled) {
    const folder = path.join(harness.root, "plugins", id);
    push(await entryOf(id, "bundled", path.join(folder, "dist"), folder, harness.id, true));
  }

  if (plugins.local) {
    let pointers: PluginPointer[] = [];
    try {
      pointers = await o.pointers.list();
    } catch (err) {
      // An unreadable pointers file (a missing one lists as empty) costs the local plugins, not the load.
      console.error("Could not read the local plugins list", err);
    }
    for (const p of pointers) {
      if (seen.has(p.id)) continue;
      const dist = await distFolderOf(p.folder);
      if (!dist) push({ id: p.id, origin: "local", dist: p.folder, folder: p.folder, manifest: null, error: "There is no plugin in this folder any more" });
      else push(await entryOf(p.id, "local", dist, p.folder, harness.id, true));
    }
  }
  return out;
}
