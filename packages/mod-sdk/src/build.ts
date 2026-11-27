// Node only (`@humanharness/mod-sdk/build`): builds a mod into the one file the app loads. No relative imports, so the
// shell's build config can load it as it is.
import { readFileSync, promises as fs } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Message, type Plugin, build } from "esbuild";

/** What a mod may import besides its own files; the app gives its own copy of each (minimal-core 0b2). */
export const SHARED_IMPORTS: ReadonlySet<string> = new Set(["react", "react/jsx-runtime", "@humanharness/mod-sdk", "@humanharness/ui", "zod"]);

export type BundleResult = { ok: true } | { ok: false; problems: string[] };
export interface BundleOptions {
  /** The mod's folder: nothing outside it may be imported. */
  dir: string;
  /** The source file, relative to `dir`. */
  entry: string;
  /** `main` runs in node and imports the app's copies by path; `ui` runs in the window and reads `globalThis.__hhModules`. */
  part: "main" | "ui";
  outFile: string;
  /** The app's copy of a shared import, as an absolute file path (used by a `main` that is not a core mod's). */
  resolveShared(spec: string): string;
  /**
   * A core mod, built with the app (mods-1a): besides the shared imports it may import `node:` builtins and the
   * packages its `package.json` declares. Core `@humanharness/*` packages are bundled in, with the npm packages they
   * import; the mod's own npm packages stay outside, found beside the app; another mod (`@humanharness/mod-*`) never. A core main reads the shared imports from
   * `globalThis.__hhMainModules`, which the app fills before it loads any mod.
   */
  core?: boolean;
  /** A core mod's worker thread entry: it has none of the app's globals, so its shared imports are bundled in (with `core`). */
  worker?: boolean;
}

const refused = (spec: string) => `${spec} can't be imported by a mod; use react, @humanharness/ui, @humanharness/mod-sdk, zod or a file in the mod's folder`;
const refusedCore = (spec: string) =>
  `${spec} can't be imported by a core mod; use a shared import, a node: builtin, a package its package.json declares or a file in the mod's folder`;
const BUILTINS = new Set(builtinModules);
/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
const packageOf = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
const isMod = (name: string) => name.startsWith("@humanharness/mod-") && name !== "@humanharness/mod-sdk";
const isBuiltin = (spec: string) => spec.startsWith("node:") || BUILTINS.has(packageOf(spec));
const bare = (spec: string) => !spec.startsWith(".") && !path.isAbsolute(spec);
function declared(dir: string): Set<string> {
  try {
    const json = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    return new Set(Object.keys(json.dependencies ?? {}));
  } catch {
    return new Set();
  }
}

const inside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const SHIM = "hh-shared";

function guard(o: BundleOptions, dir: string): Plugin {
  const deps = o.core ? declared(dir) : new Set<string>();
  const global = o.part === "main" ? "__hhMainModules" : "__hhModules";
  return {
    name: "hh-mod-imports",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const spec = args.path;
        if (SHARED_IMPORTS.has(spec) && o.core && o.worker) return undefined;
        if (SHARED_IMPORTS.has(spec)) {
          return o.part === "main" && !o.core ? { path: pathToFileURL(o.resolveShared(spec)).href, external: true } : { path: spec, namespace: SHIM };
        }
        if (o.core) return core(spec, args.resolveDir);
        const local = spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
        if (local && inside(dir, path.resolve(args.resolveDir, spec))) return undefined;
        return { errors: [{ text: refused(spec) }] };
      });
      /** A core mod's import: its own files, or what the allowlist lets in; a bundled core package imports freely. */
      function core(spec: string, from: string) {
        const own = inside(dir, path.join(from, "x")) && !path.relative(dir, from).split(path.sep).includes("node_modules");
        if (!bare(spec)) return own && !inside(dir, path.resolve(from, spec)) ? { errors: [{ text: refusedCore(spec) }] } : undefined;
        const name = packageOf(spec);
        if (isBuiltin(spec)) return o.part === "main" && (!own || spec.startsWith("node:") || deps.has(name)) ? { path: spec, external: true } : { errors: [{ text: refusedCore(spec) }] };
        if (isMod(name) || (own && !deps.has(name))) return { errors: [{ text: refusedCore(spec) }] };
        // A core package's own npm imports are bundled with it: nothing beside the built mod could resolve them (the
        // app bundles them into its main the same way). The mod's own npm packages stay outside.
        return name.startsWith("@humanharness/") || !own ? undefined : { path: spec, external: true };
      }
      // A CommonJS shim, so `import { useState } from "react"` works against the object the app fills in.
      b.onLoad({ filter: /.*/, namespace: SHIM }, (args) => ({ contents: `module.exports = globalThis.${global}[${JSON.stringify(args.path)}];`, loader: "js" }));
    },
  };
}

const line = (m: Message) => (m.location ? `${m.location.file}:${m.location.line}: ${m.text}` : m.text);

/** Bundles one entry of a mod with esbuild into one ESM file; problems come back as `file:line: text`, never thrown. */
export async function bundleMod(o: BundleOptions): Promise<BundleResult> {
  try {
    // esbuild resolves through symlinks (macOS's /var is /private/var): the folder is compared as it really is.
    const dir = await fs.realpath(path.resolve(o.dir));
    await build({
      absWorkingDir: dir,
      entryPoints: [path.resolve(dir, o.entry)],
      outfile: o.outFile,
      bundle: true,
      format: "esm",
      platform: o.part === "main" ? "node" : "browser",
      target: "es2022",
      jsx: "automatic",
      write: true,
      logLevel: "silent",
      plugins: [guard(o, dir)],
      // A bundled CommonJS package's `require` of a node builtin needs a real one in an ESM file.
      ...(o.core && o.part === "main" ? { banner: { js: 'import { createRequire as __hhCreateRequire } from "node:module";\nconst require = __hhCreateRequire(import.meta.url);' } } : {}),
    });
    return { ok: true };
  } catch (err) {
    const errors = (err as { errors?: Message[] }).errors;
    if (Array.isArray(errors) && errors.length > 0) return { ok: false, problems: errors.map(line) };
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  }
}

