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
function toolchain() {
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

type Toolchain = ReturnType<typeof toolchain>;

/** Resolves the plugin's `@humanharness/…` imports to the CLI's files, by exact name (no regex from plugin input). */
function aliasPlugin(files: Record<string, string>) {
  const names = new Map(Object.entries(files));
  return {
    name: "hh-plugin-aliases",
    setup(b: { onResolve(o: { filter: RegExp }, f: (a: { path: string }) => { path: string } | undefined): void }) {
      b.onResolve({ filter: /^@humanharness\// }, (a) => {
        const hit = names.get(a.path);
        return hit ? { path: hit } : undefined;
      });
    },
  };
}

/**
 * The options every bundle shares (Decision 17, spike P-S9). `absWorkingDir` is the folder the aliases point into
 * and `minifyWhitespace` drops the path comments, so the output names no machine path and doesn't depend on where
 * the plugin sits. Top-level await is refused: panels are classic scripts and Task 17 runs backend.js as an IIFE.
 */
function common(t: Toolchain, files: Record<string, string>) {
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
    plugins: [aliasPlugin(files)],
    define: { "process.env.NODE_ENV": '"production"' },
    supported: { "top-level-await": false },
    jsx: "automatic",
  };
}

/** esbuild's errors as one CliError, each "file:line: text" with the file relative to the plugin. */
function bundleError(err: unknown, t: Toolchain, dir: string): unknown {
  const errors = (err as { errors?: EsbuildMessage[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return err;
  const lines = errors.map((e) => {
    const text = /top-level await/i.test(e.text) ? "top-level await is not allowed: do the work inside a function" : e.text;
    if (!e.location?.file) return text;
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
      ...common(t, { "@humanharness/harness-sdk": t.sdk }),
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

/** assets/ as the panel handler serves it (P7): flat, `.svg` and `.png` only, no links. */
async function readAssets(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const folder = path.join(dir, "assets");
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) return files;
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isFile()) throw new CliError(`assets/${e.name}: only plain .svg and .png files go in assets/ (no folders or links)`);
    if (!/\.(svg|png)$/.test(e.name)) throw new CliError(`assets/${e.name}: only .svg and .png files go in assets/`);
    files.set(`assets/${e.name}`, await fs.readFile(path.join(folder, e.name)));
  }
  return files;
}

/**
 * `humanharness plugin build` (spec §3.1, Decision 17): plugin.config.ts → plugin.json, backend.ts → backend.js,
 * panels → html/js/css, assets/ copied. Everything is built in memory first; dist/ is replaced only on success.
 */
export async function buildPlugin(dir: string, o: { out?: string } = {}): Promise<BuildResult> {
  const out = o.out ?? path.join(dir, "dist");
  const t = toolchain();
  const json = await configJson(t, dir);
  const manifest = parsePluginManifest(json);

  if (!(await exists(path.join(dir, "backend.ts")))) throw new CliError("backend.ts is missing");
  for (const p of manifest.panels) if (!(await exists(path.join(dir, "panels", `${p.id}.tsx`)))) throw new CliError(`panels/${p.id}.tsx is missing`);

  const files = new Map<string, Uint8Array | string>([["plugin.json", orderedJson(json)]]);
  const browser = { ...common(t, t.files), platform: "browser", target: "chrome130" };
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
  for (const [name, bytes] of await readAssets(dir)) files.set(name, bytes);

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  for (const [name, contents] of files) {
    await fs.mkdir(path.dirname(path.join(out, name)), { recursive: true });
    await fs.writeFile(path.join(out, name), contents);
  }
  const list = [...files.keys()].map((f) => f.split("/").join(path.sep)).sort();
  return { dist: out, files: list, manifest };
}
