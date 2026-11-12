// Node only (`@humanharness/mod-sdk/bundle`): builds a mod written by hand into the one file the app loads.
import { promises as fs } from "node:fs";
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
  /** The app's copy of a shared import, as an absolute file path (used by `main`). */
  resolveShared(spec: string): string;
}

const refused = (spec: string) => `${spec} can't be imported by a mod; use react, @humanharness/ui, @humanharness/mod-sdk, zod or a file in the mod's folder`;
const inside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const SHIM = "hh-shared";

function guard(o: BundleOptions, dir: string): Plugin {
  return {
    name: "hh-mod-imports",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const spec = args.path;
        if (SHARED_IMPORTS.has(spec)) {
          return o.part === "main" ? { path: pathToFileURL(o.resolveShared(spec)).href, external: true } : { path: spec, namespace: SHIM };
        }
        const local = spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
        if (local && inside(dir, path.resolve(args.resolveDir, spec))) return undefined;
        return { errors: [{ text: refused(spec) }] };
      });
      // A CommonJS shim, so `import { useState } from "react"` works against the object the window fills in.
      b.onLoad({ filter: /.*/, namespace: SHIM }, (args) => ({ contents: `module.exports = globalThis.__hhModules[${JSON.stringify(args.path)}];`, loader: "js" }));
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
    });
    return { ok: true };
  } catch (err) {
    const errors = (err as { errors?: Message[] }).errors;
    if (Array.isArray(errors) && errors.length > 0) return { ok: false, problems: errors.map(line) };
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  }
}
