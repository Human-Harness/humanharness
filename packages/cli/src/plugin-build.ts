import { randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type PluginManifest, parsePluginManifest } from "@humanharness/harness-sdk";
import { CliError } from "./cli";

/** What `build` wrote: the dist folder, its files (relative, sorted) and the manifest as the app will read it. */
export interface BuildResult {
  dist: string;
  files: string[];
  manifest: PluginManifest;
}

/** The part of esbuild's API `build` uses (esbuild comes through tsx: no types of its own here). */
interface EsbuildMessage {
  text: string;
  location?: { file: string; line: number } | null;
}
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
}

const req = createRequire(import.meta.url);
/** The folder of a package, found from `from` (a file or package.json path). */
const packageDir = (from: string, name: string) => path.dirname(createRequire(from).resolve(`${name}/package.json`));

/**
 * esbuild as tsx carries it (no install: spike P-S8; making it a direct CLI dependency is an open question), and the
 * CLI's own copies of everything a plugin imports, so a plugin folder outside the repo builds without node_modules.
 */
export function toolchain() {
  const esbuild = createRequire(req.resolve("tsx/package.json"))("esbuild") as Esbuild;
  const pluginUi = req.resolve("@humanharness/ui/plugin-ui");
  const sdk = req.resolve("@humanharness/harness-sdk");
  const files = {
    "@humanharness/plugin-ui": pluginUi,
    "@humanharness/plugin-ui/styles.css": req.resolve("@humanharness/ui/plugin-ui/styles.css"),
    "@humanharness/harness-sdk/plugin-backend": req.resolve("@humanharness/harness-sdk/plugin-backend"),
  };
  const folders = {
    react: packageDir(fileURLToPath(import.meta.url), "react"),
    // react-dom doesn't resolve from the CLI (spike P-S9): take the ui package's, the one plugin-ui is written against.
    "react-dom": packageDir(pluginUi, "react-dom"),
  };
  const real = [...Object.values(files), ...Object.values(folders)].map((p) => realpathSync(p));
  return { esbuild, files, folders, sdk, zod: packageDir(sdk, "zod"), root: commonAncestor(real) };
}

/** The deepest folder holding every path: the workspace root in the monorepo. */
function commonAncestor(paths: string[]): string {
  let parts = path.dirname(paths[0]).split(path.sep);
  for (const p of paths.slice(1)) {
    const other = path.dirname(p).split(path.sep);
    let i = 0;
    while (i < parts.length && i < other.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || path.sep;
}

export type Toolchain = ReturnType<typeof toolchain>;

interface ResolveArgs {
  path: string;
  importer: string;
  namespace: string;
  resolveDir: string;
  kind: string;
  pluginData?: unknown;
}
interface ResolveResult {
  path: string;
  namespace: string;
  external?: boolean;
  errors: unknown[];
  warnings: unknown[];
  sideEffects?: boolean;
  suffix?: string;
}
interface PluginBuild {
  onResolve(o: { filter: RegExp; namespace?: string }, f: (a: ResolveArgs) => unknown): void;
  onLoad(o: { filter: RegExp; namespace: string }, f: (a: { path: string }) => unknown): void;
  resolve(path: string, o: { importer: string; namespace: string; resolveDir: string; kind: string; pluginData: unknown }): Promise<ResolveResult>;
}

/** Resolves the plugin's `@humanharness/…` imports to the CLI's files, by exact name (no regex from plugin input). */
function aliasPlugin(files: Record<string, string>) {
  const names = new Map(Object.entries(files));
  return {
    name: "hh-plugin-aliases",
    setup(b: PluginBuild) {
      b.onResolve({ filter: /^@humanharness\// }, (a) => {
        const hit = names.get(a.path);
        return hit ? { path: hit } : undefined;
      });
    },
  };
}

/** The namespace the plugin's own files load under, by their path relative to the plugin folder. */
const LOCAL = "hh-plugin";
const LOADERS: Record<string, string> = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx", ".css": "css", ".json": "json" };
const isInside = (folder: string, p: string) => {
  const rel = path.relative(folder, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Every file of the plugin's own loads as `hh-plugin:<path from the plugin folder>`, so whatever esbuild prints of
 * a module's name (a CommonJS wrapper's key, an error's file) is the same wherever the plugin folder sits. esbuild
 * resolves as usual; only the result is renamed. A file outside both the plugin folder and the toolchain is refused:
 * its name could only be a machine path.
 */
function localPlugin(dir: string, root: string) {
  const realDir = realpathSync(dir);
  const skip = { hhLocal: true };
  return {
    name: "hh-plugin-local",
    setup(b: PluginBuild) {
      b.onResolve({ filter: /.*/ }, async (a) => {
        if (a.pluginData === skip) return undefined;
        const r = await b.resolve(a.path, { importer: a.importer, namespace: a.namespace === LOCAL ? "file" : a.namespace, resolveDir: a.resolveDir, kind: a.kind, pluginData: skip });
        if (r.errors.length > 0) return { errors: r.errors };
        if (r.external || r.namespace !== "file") return r;
        const real = realpathSync(r.path);
        if (isInside(realDir, real)) return { path: path.relative(realDir, real).split(path.sep).join("/"), namespace: LOCAL, sideEffects: r.sideEffects, suffix: r.suffix };
        if (isInside(root, real)) return r;
        return { errors: [{ text: `${a.path}: a plugin imports only its own files and the toolchain's packages` }] };
      });
      b.onLoad({ filter: /.*/, namespace: LOCAL }, async (a) => {
        const abs = path.join(realDir, ...a.path.split("/"));
        const loader = LOADERS[path.extname(abs)];
        if (!loader) return { errors: [{ text: `${a.path}: a plugin imports only code, .css and .json` }] };
        return { contents: await fs.readFile(abs), loader, resolveDir: path.dirname(abs) };
      });
    },
  };
}

/**
 * The options every bundle shares (Decision 17, spike P-S9). `absWorkingDir` is the folder the aliases point into
 * and `minifyWhitespace` drops the path comments; the plugin's own files load under `hh-plugin:` (localPlugin), so the
 * output names no machine path and doesn't depend on where the plugin sits. Top-level await is refused: panels are classic scripts and Task 17 runs backend.js as an IIFE.
 */
export function common(t: Toolchain, dir: string, files: Record<string, string>) {
  return {
    bundle: true,
    write: false,
    minify: false,
    minifyWhitespace: true,
    legalComments: "none",
    charset: "utf8",
    logLevel: "silent",
    metafile: false,
    absWorkingDir: t.root,
    alias: t.folders,
    plugins: [aliasPlugin(files), localPlugin(dir, t.root)],
    define: { "process.env.NODE_ENV": '"production"' },
    supported: { "top-level-await": false },
    jsx: "automatic",
  };
}

/** esbuild's errors as one CliError, each "file:line: text" with the file relative to the plugin. */
export function bundleError(err: unknown, t: Toolchain, dir: string): unknown {
  const errors = (err as { errors?: EsbuildMessage[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return err;
  const lines = errors.map((e) => {
    const text = /top-level await/i.test(e.text) ? "top-level await is not allowed: do the work inside a function" : e.text;
    if (!e.location?.file) return text;
    if (e.location.file.startsWith(`${LOCAL}:`)) return `${e.location.file.slice(LOCAL.length + 1)}:${e.location.line}: ${text}`;
    const file = path.relative(realpathSync(dir), path.resolve(t.root, e.location.file)).split(path.sep).join("/");
    return `${file}:${e.location.line}: ${text}`;
  });
  return new CliError(lines.join("\n"));
}

/** The panel page (Decision 6): the stylesheet, `#root`, then the IIFE as a classic script (spike P-S2). */
export const panelHtml = (id: string) =>
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./panel-${id}.css"><div id="root"></div><script src="./panel-${id}.js"></script>\n`;

/** plugin.json's top-level keys in the order `build` writes them; nested keys keep the definition's order. */
const KEY_ORDER = ["id", "name", "version", "api", "harness", "permissions", "sources", "data", "panels", "chips", "settings", "actions"];
function orderedJson(json: Record<string, unknown>): string {
  const keys = [...KEY_ORDER.filter((k) => Object.hasOwn(json, k)), ...Object.keys(json).filter((k) => !KEY_ORDER.includes(k)).sort()];
  return `${JSON.stringify(Object.fromEntries(keys.map((k) => [k, json[k]])), null, 2)}\n`;
}

const exists = (p: string) =>
  fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  );

/**
 * plugin.config.ts → plugin.json: bundled for Node with the SDK and its zod, run from a temp `.mjs` (removed after),
 * and turned into plain data by the bundle's own `pluginJson`, so the schemas and `z.toJSONSchema` are one zod copy.
 */
async function configJson(t: Toolchain, dir: string): Promise<Record<string, unknown>> {
  const entry = [
    'import * as config from "./plugin.config.ts";',
    'import { pluginJson } from "@humanharness/harness-sdk";',
    "export default () => {",
    "  const d = config.default;",
    '  if (typeof d !== "object" || d === null || typeof d.id !== "string") throw new Error("plugin.config.ts must export default definePlugin({ ... })");',
    "  return pluginJson(d);",
    "};",
  ].join("\n");
  let out;
  try {
    out = await t.esbuild.build({
      ...common(t, dir, { "@humanharness/harness-sdk": t.sdk }),
      alias: { ...t.folders, zod: t.zod },
      stdin: { contents: entry, resolveDir: dir, sourcefile: "hh-plugin-config.ts", loader: "ts" },
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: "config.mjs",
      supported: {},
    });
  } catch (err) {
    throw bundleError(err, t, dir);
  }
  const temp = path.join(os.tmpdir(), `hh-plugin-config-${randomBytes(8).toString("hex")}.mjs`);
  try {
    await fs.writeFile(temp, out.outputFiles[0].contents);
    const mod = (await import(pathToFileURL(temp).href)) as { default: () => Record<string, unknown> };
    return mod.default();
  } catch (err) {
    throw new CliError(`plugin.config.ts: ${configError(err)}`);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/** A config error in one line per problem: a zod error (the bundle's own zod, so no instanceof) as "path: message". */
function configError(err: unknown): string {
  const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (Array.isArray(issues) && issues.length > 0) return issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)).join("\n");
  return err instanceof Error ? err.message : String(err);
}

/** The names the panel handler serves (plugin-panels.ts ASSET), without the `assets/` prefix. */
const ASSET_NAME = /^[A-Za-z0-9_-]{1,64}\.(svg|png)$/;

/** assets/ as the panel handler serves it (P7): a real folder, flat, `.svg` and `.png` only, no links. */
async function readAssets(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const folder = path.join(dir, "assets");
  const stat = await fs.lstat(folder).catch(() => null);
  if (!stat) return files;
  if (!stat.isDirectory()) throw new CliError("assets/ must be a plain folder, not a link or a file");
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isFile()) throw new CliError(`assets/${e.name}: only plain .svg and .png files go in assets/ (no folders or links)`);
    if (!/\.(svg|png)$/.test(e.name)) throw new CliError(`assets/${e.name}: only .svg and .png files go in assets/`);
    if (!ASSET_NAME.test(e.name)) throw new CliError(`assets/${e.name}: an asset name is 1-64 letters, digits, _ or - before .svg or .png`);
    files.set(`assets/${e.name}`, await fs.readFile(path.join(folder, e.name)));
  }
  return files;
}

/** `p` with its deepest existing ancestor's links resolved: where a folder about to be made would really be. */
async function realish(p: string): Promise<string> {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...rest.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/**
 * `out` is removed and replaced, so it must not be (or hold) the plugin's sources, and when it exists it is empty
 * or a previous build (has a plugin.json).
 */
async function checkOut(dir: string, out: string): Promise<void> {
  const [realDir, realOut] = await Promise.all([realish(path.resolve(dir)), realish(out)]);
  if (realOut === realDir || isInside(realOut, realDir)) throw new CliError(`--out ${out}: that folder holds the plugin itself; pick a folder of its own`);
  const stat = await fs.lstat(out).catch(() => null);
  if (!stat) return;
  if (!stat.isDirectory()) throw new CliError(`--out ${out}: not a folder`);
  const entries = await fs.readdir(out);
  if (entries.length > 0 && !(await exists(path.join(out, "plugin.json")))) throw new CliError(`--out ${out}: the folder has files and is not a previous build (no plugin.json); pick an empty or new folder`);
}

/** Writes `files` to a temp folder beside `out`, then swaps it in: a failed write leaves the previous build whole. */
export async function writeDist(out: string, files: Map<string, Uint8Array | string>): Promise<void> {
  const tag = randomBytes(6).toString("hex");
  const temp = `${out}.tmp-${tag}`;
  const old = `${out}.old-${tag}`;
  try {
    await fs.mkdir(temp, { recursive: true });
    for (const [name, contents] of files) {
      await fs.mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await fs.writeFile(path.join(temp, name), contents);
    }
  } catch (err) {
    await fs.rm(temp, { recursive: true, force: true });
    throw err;
  }
  const had = await fs.lstat(out).then(
    () => true,
    () => false,
  );
  if (had) await fs.rename(out, old);
  try {
    await fs.rename(temp, out);
  } catch (err) {
    if (had) await fs.rename(old, out).catch(() => undefined);
    await fs.rm(temp, { recursive: true, force: true });
    throw err;
  }
  if (had) await fs.rm(old, { recursive: true, force: true });
}

/**
 * `humanharness plugin build` (spec §3.1, Decision 17): plugin.config.ts → plugin.json, backend.ts → backend.js,
 * panels → html/js/css, assets/ copied. Everything is built in memory first; dist/ is replaced only on success.
 */
export async function buildPlugin(dir: string, o: { out?: string } = {}): Promise<BuildResult> {
  const out = path.resolve(o.out ?? path.join(dir, "dist"));
  await checkOut(dir, out);
  const t = toolchain();
  const json = await configJson(t, dir);
  const manifest = parsePluginManifest(json);

  if (!(await exists(path.join(dir, "backend.ts")))) throw new CliError("backend.ts is missing");
  for (const p of manifest.panels) if (!(await exists(path.join(dir, "panels", `${p.id}.tsx`)))) throw new CliError(`panels/${p.id}.tsx is missing`);

  const files = new Map<string, Uint8Array | string>([["plugin.json", orderedJson(json)]]);
  const assets = await readAssets(dir);
  const browser = { ...common(t, dir, t.files), platform: "browser", target: "chrome130" };
  try {
    const backend = await t.esbuild.build({ ...browser, entryPoints: [path.join(dir, "backend.ts")], format: "esm", outfile: "backend.js" });
    files.set("backend.js", backend.outputFiles[0].contents);
    for (const p of manifest.panels) {
      const name = `panel-${p.id}`;
      const entry = [
        'import { mountPanel } from "@humanharness/plugin-ui";',
        'import "@humanharness/plugin-ui/styles.css";',
        `import Panel from ${JSON.stringify(`./panels/${p.id}.tsx`)};`,
        "mountPanel(Panel);",
      ].join("\n");
      const panel = await t.esbuild.build({
        ...browser,
        stdin: { contents: entry, resolveDir: dir, sourcefile: `${name}-entry.tsx`, loader: "tsx" },
        format: "iife",
        outfile: `${name}.js`,
      });
      for (const f of panel.outputFiles) {
        const base = path.basename(f.path);
        if (base !== `${name}.js` && base !== `${name}.css`) throw new CliError(`panels/${p.id}.tsx: the bundle would write ${base}; a panel imports only code and .css`);
        files.set(base, f.contents);
      }
      if (!files.has(`${name}.css`)) files.set(`${name}.css`, "");
      files.set(`${name}.html`, panelHtml(p.id));
    }
  } catch (err) {
    throw bundleError(err, t, dir);
  }
  for (const [name, bytes] of assets) files.set(name, bytes);
  await writeDist(out, files);
  const list = [...files.keys()].map((f) => f.split("/").join(path.sep)).sort();
  return { dist: out, files: list, manifest };
}
