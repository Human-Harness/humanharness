import { type FSWatcher, existsSync, watch as fsWatch, promises as fs, mkdirSync } from "node:fs";
import path from "node:path";
import { bundleMod } from "@humanharness/mod-sdk/bundle";
import type { ModReview } from "@humanharness/protocol";
import type { ModsSettings } from "./config";
import type { ModHost, UserBuilds } from "./host";
import { type ResolveProblem, type ResolvedMod, readModJson } from "./resolve";

/** The user layer (minimal-core 0b2): mods the person, or an agent, writes by hand in the home folder. */
export const userModsDir = (home: string) => path.join(home, "mods");
/** Where the app keeps the user layer's builds: `<userData>/<harness>/mod-build/<id>/`, beside the home folder. */
export const modBuildRoot = (userData: string, harnessId: string) => path.join(userData, harnessId, "mod-build");
export const USER_DEBOUNCE_MS = 300;

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2_000);

/** Every folder in `app/mods/` with a `mod.json`, sorted; none when the folder doesn't exist. */
export async function userModFolders(home: string): Promise<string[]> {
  const dir = userModsDir(home);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) if (e.isDirectory() && (await exists(path.join(dir, e.name, "mod.json")))) out.push(path.join(dir, e.name));
  return out.sort();
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
type MainModules = Record<string, Record<string, unknown>>;
const g = globalThis as { __hhMainModules?: MainModules };

/**
 * Writes one small ESM file per shared import a built main part may use, each re-exporting the app's own copy (kept
 * on `globalThis.__hhMainModules`), so a mod and the app share one zod and one mod-sdk, packaged or not. A shared
 * import the main part can't have (react, @humanharness/ui: the window's) gets a file that throws when imported.
 * Returns `resolveShared` for `bundleMod`.
 */
export async function writeMainShims(dir: string, modules: Readonly<MainModules>): Promise<(spec: string) => string> {
  g.__hhMainModules = { ...g.__hhMainModules, ...modules };
  await fs.mkdir(dir, { recursive: true });
  const fileOf = (spec: string) => path.join(dir, `${spec.replace(/[^a-z0-9]+/gi, "_")}.mjs`);
  for (const [spec, mod] of Object.entries(modules)) {
    const names = Object.keys(mod).filter((n) => n !== "default" && IDENT.test(n));
    const lines = [`const m = globalThis.__hhMainModules[${JSON.stringify(spec)}];`, `export default "default" in m ? m.default : m;`];
    names.forEach((n, i) => lines.push(`const _${i} = m[${JSON.stringify(n)}];`, `export { _${i} as ${n} };`));
    await fs.writeFile(fileOf(spec), `${lines.join("\n")}\n`);
  }
  return (spec) => {
    if (Object.hasOwn(modules, spec)) return fileOf(spec);
    const file = path.join(dir, `ui-only-${spec.replace(/[^a-z0-9]+/gi, "_")}.mjs`);
    // Written once, synchronously enough for the build that asked: the file only has to exist when main imports it.
    void fs.writeFile(file, `throw new Error(${JSON.stringify(`${spec} is for a mod's ui part; its main part can't import it`)});\n`);
    return file;
  };
}

const PARTS = [
  { key: "main", part: "main", file: "main.mjs" },
  { key: "ui", part: "ui", file: "ui.js" },
] as const;

/** Builds user-layer mods into `<root>/<id>/{main.mjs,ui.js}`, with the last good build in `<root>/<id>/last-good/`. */
export class ModBuilds implements UserBuilds {
  constructor(
    private readonly root: string,
    private readonly resolveShared: (spec: string) => string,
  ) {}

  dir(id: string): string {
    return path.join(this.root, id);
  }

  async build(mod: ResolvedMod): Promise<{ ok: true; main?: string } | { ok: false; file: string; reason: string }> {
    const out = this.dir(mod.json.id);
    await fs.mkdir(out, { recursive: true });
    for (const p of PARTS) {
      const src = mod.json[p.key];
      const outFile = path.join(out, p.file);
      // A part the mod dropped leaves no stale file behind.
      if (src === undefined) {
        await fs.rm(outFile, { force: true });
        continue;
      }
      const r = await bundleMod({ dir: mod.dir, entry: src, part: p.part, outFile, resolveShared: this.resolveShared });
      if (!r.ok) return { ok: false, file: src, reason: r.problems.join("\n") };
    }
    return mod.json.main === undefined ? { ok: true } : { ok: true, main: path.join(out, "main.mjs") };
  }

  async keep(mod: ResolvedMod): Promise<void> {
    const out = this.dir(mod.json.id);
    const good = path.join(out, "last-good");
    await fs.rm(good, { recursive: true, force: true });
    await fs.mkdir(good, { recursive: true });
    for (const p of PARTS) if (await exists(path.join(out, p.file))) await fs.copyFile(path.join(out, p.file), path.join(good, p.file));
    // Every `.error` of the mod goes: this version builds and runs.
    const entries = await fs.readdir(mod.dir, { withFileTypes: true, recursive: true }).catch(() => []);
    for (const e of entries) if (e.isFile() && e.name.endsWith(".error")) await fs.rm(path.join(e.parentPath, e.name), { force: true });
  }

  async fail(mod: ResolvedMod, file: string, reason: string): Promise<{ restored: boolean; main?: string }> {
    await fs.writeFile(path.join(mod.dir, `${file}.error`), `${reason}\n`).catch((err: unknown) => console.error(`Mod ${mod.json.id}: could not write ${file}.error`, err));
    const out = this.dir(mod.json.id);
    const good = path.join(out, "last-good");
    if (!(await exists(good))) return { restored: false };
    for (const p of PARTS) {
      if (await exists(path.join(good, p.file))) await fs.copyFile(path.join(good, p.file), path.join(out, p.file));
      else await fs.rm(path.join(out, p.file), { force: true });
    }
    return (await exists(path.join(out, "main.mjs"))) ? { restored: true, main: path.join(out, "main.mjs") } : { restored: true };
  }
}

/**
 * Watches `app/mods/` (recursive) and calls `onChange` with a mod folder's path once its files have been quiet for
 * `ms` (per folder). A `.error` file the app writes is not a change.
 */
export function watchUserLayer(home: string, onChange: (dir: string) => void, ms = USER_DEBOUNCE_MS): { close(): void } {
  const root = userModsDir(home);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let w: FSWatcher | undefined;
  try {
    mkdirSync(root, { recursive: true });
    w = fsWatch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = name.toString();
      if (rel.endsWith(".error")) return;
      const folder = rel.split(/[\\/]/)[0];
      if (!folder || folder.startsWith(".")) return;
      // macOS reports the watched folder itself by its own name: not a mod folder unless one has that name.
      if (rel === path.basename(root) && !existsSync(path.join(root, rel))) return;
      clearTimeout(timers.get(folder));
      timers.set(
        folder,
        setTimeout(() => {
          timers.delete(folder);
          onChange(path.join(root, folder));
        }, ms),
      );
    });
    w.on("error", (err) => console.error("The home folder's mods watcher stopped", err));
  } catch (err) {
    console.error(`Could not watch ${root}`, err);
  }
  return {
    close: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      w?.close();
    },
  };
}

/**
 * Watches the person's layouts (0b2): any file in `app/layouts/` and `app/settings.json` (the pick). `onChange` runs
 * once the burst has been quiet for `ms`. A `.error` (the app's) or `.tmp` (an atomic write's) file is not a change.
 */
export function watchLayouts(home: string, onChange: () => void, ms = USER_DEBOUNCE_MS): { close(): void } {
  const dir = path.join(home, "layouts");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, ms);
  };
  const watchers: FSWatcher[] = [];
  const add = (folder: string, keep: (name: string) => boolean) => {
    try {
      const w = fsWatch(folder, (_event, name) => {
        if (name && keep(name.toString())) fire();
      });
      w.on("error", (err) => console.error(`The watcher of ${folder} stopped`, err));
      watchers.push(w);
    } catch (err) {
      console.error(`Could not watch ${folder}`, err);
    }
  };
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Could not make ${dir}`, err);
  }
  add(dir, (n) => !n.endsWith(".error") && !n.endsWith(".tmp") && n !== path.basename(dir));
  // settings.json is written by a rename: its folder is watched, not the file (whose watch would end with it).
  add(home, (n) => n === "settings.json");
  return {
    close: () => {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

/**
 * The user layer's mods as the host runs them: which folder holds which mod, the folders that can't be read, and
 * what a change in a folder does (a new mod listed off, an edit reloaded, a removed folder dropped).
 */
export class UserLayer {
  private readonly ids = new Map<string, string>();
  private readonly bad = new Map<string, string>();
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly d: {
      home: string;
      host: Pick<ModHost, "has" | "add" | "remove" | "reload">;
      /** What `resolveMods` found at start: the user layer's mods and problems are taken from it. */
      mods: ResolvedMod[];
      problems: ResolveProblem[];
      /** Settings › Mods must redraw (a problem appeared or went). */
      changed(): void;
    },
  ) {
    const root = userModsDir(d.home);
    for (const m of d.mods) if (m.user) this.ids.set(m.dir, m.json.id);
    for (const p of d.problems) if (path.dirname(p.id) === root) this.bad.set(p.id, p.reason);
  }

  /** The user-layer folders that couldn't be read as mods. */
  problems(): ResolveProblem[] {
    return [...this.bad].map(([id, reason]) => ({ id, reason }));
  }

  /** The folder of the user-layer mod with this id, if one is. */
  dirOf(id: string): string | undefined {
    for (const [dir, other] of this.ids) if (other === id) return dir;
    return undefined;
  }

  /** Reads a folder again and brings the host in line; one sync per folder at a time. */
  sync(dir: string): Promise<void> {
    const next = (this.queue.get(dir) ?? Promise.resolve()).then(() => this.syncNow(dir)).catch((err: unknown) => console.error(`Could not sync the mod in ${dir}`, err));
    this.queue.set(dir, next);
    return next;
  }

  private async syncNow(dir: string): Promise<void> {
    const known = this.ids.get(dir);
    const errorFile = path.join(dir, "mod.json.error");
    if (!(await exists(path.join(dir, "mod.json")))) {
      this.ids.delete(dir);
      const hadProblem = this.bad.delete(dir);
      if (known) await this.d.host.remove(known);
      else if (hadProblem) this.d.changed();
      return;
    }
    let mod: ResolvedMod;
    try {
      mod = { json: await readModJson(dir), dir, origin: "local", shipped: "local", config: undefined, user: true };
    } catch (err) {
      // A broken mod.json: said next to it; a running mod keeps its version.
      await fs.writeFile(errorFile, `${why(err)}\n`).catch(() => undefined);
      if (!known) this.bad.set(dir, why(err));
      return this.d.changed();
    }
    if (known && known !== mod.json.id) {
      // The id changed: the old mod goes, the new one comes in off.
      this.ids.delete(dir);
      await this.d.host.remove(known);
    }
    if (this.ids.has(dir)) {
      await fs.rm(errorFile, { force: true });
      return this.d.host.reload(mod.json.id, mod);
    }
    if (this.d.host.has(mod.json.id)) {
      const reason = `the id "${mod.json.id}" is already used`;
      await fs.writeFile(errorFile, `${reason}\n`).catch(() => undefined);
      this.bad.set(dir, reason);
      return this.d.changed();
    }
    await fs.rm(errorFile, { force: true });
    this.bad.delete(dir);
    this.ids.set(dir, mod.json.id);
    await this.d.host.add(mod);
  }
}

/**
 * Consent for user-layer mods (spec D2): the first turn-on goes through the same warning as adding a local folder;
 * accepting it records the id in `mods.trusted`. The deps `registerModsIpc` needs for it.
 */
export function userConsent(o: {
  config: { load(): Promise<ModsSettings | undefined>; save(m: ModsSettings | undefined): Promise<void> };
  host: Pick<ModHost, "set">;
  layer: Pick<UserLayer, "dirOf">;
}) {
  return {
    needsReview: async (id: string) => o.layer.dirOf(id) !== undefined && !(await o.config.load())?.trusted?.includes(id),
    reviewUser: async (id: string): Promise<ModReview | null> => {
      const folder = o.layer.dirOf(id);
      if (!folder) return null;
      const json = await readModJson(folder).catch(() => null);
      return json && json.id === id ? { id, name: json.name, version: json.version, folder } : null;
    },
    trustUser: async (id: string) => {
      const m = await o.config.load();
      await o.config.save({
        ...m,
        trusted: [...new Set([...(m?.trusted ?? []), id])],
        on: { ...m?.on, [id]: true },
        failed: Object.fromEntries(Object.entries(m?.failed ?? {}).filter(([k]) => k !== id)),
      });
      await o.host.set(id, true);
    },
  };
}
