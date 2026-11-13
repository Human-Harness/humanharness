// Writes packages/shell/scripts/hh.d.ts: the mod API of this version, as the app's home folder carries it (minimal-core
// spec §5.1). Run with `corepack pnpm --filter @humanharness/shell hh-dts`; manual.test.ts fails while it is stale.
//
// The TypeScript compiler emits the declarations of `@humanharness/mod-sdk` (its index: `bundle` is not part of it)
// and of the block API in `@humanharness/ui` (BlockProps, AppValue, useApp, and the guide's names `@humanharness/ui`
// exports). Each emitted file becomes an ambient module of its own under `<package>/_internal/`, its relative imports
// rewritten to those names; the two public modules re-export only the contract. Other packages (react, zod, the
// protocol) stay imports: a mod's folder resolves them, or reads them as `any`.
//
// The file lives beside this script, not under src/: the repo's tsconfig compiles src/, and an ambient
// `declare module "@humanharness/mod-sdk"` there would replace the real package for the whole repo.
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.resolve(here, "../..");
/** The checked-in file, the app's copy (main imports it as text). */
export const HH_DTS_FILE = path.join(here, "hh.d.ts");
export const HH_DTS_COMMAND = "corepack pnpm --filter @humanharness/shell hh-dts";

const UI_INDEX = path.join(PACKAGES, "ui", "src", "index.ts");
/** The public modules and what each re-exports: `[specifier relative to packages/, export clause]`. */
const BLOCK_API: [string, string][] = [
  ["ui/src/layout/registry", "export type { BlockProps, BlockComponent }"],
  ["ui/src/layout/app", "export { type AppValue, useApp }"],
];
const ENTRIES = ["mod-sdk/src/index.ts", "ui/src/layout/registry.ts", "ui/src/layout/app.ts", "ui/src/guide/index.ts"];

const posix = (p: string) => p.split(path.sep).join("/");
/** `ui/src/layout/app` → `@humanharness/ui/_internal/src/layout/app`. */
function internalName(rel: string): string {
  const [pkg, ...rest] = posix(rel).split("/");
  return `@humanharness/${pkg}/_internal/${rest.join("/")}`;
}

/** What `@humanharness/ui` re-exports from the guide: its `export … from "./guide…"` statements, as they are. */
function guideExports(): [string, string][] {
  const src = readFileSync(UI_INDEX, "utf8");
  const out: [string, string][] = [];
  for (const m of src.matchAll(/^export\s+(\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+"(\.\/guide(?:\/[^"]*)?)";/gm)) {
    const target = m[2] === "./guide" ? "ui/src/guide/index" : `ui/src/${m[2].slice(2)}`;
    out.push([target, `export ${m[1].replace(/\s+/g, " ")}`]);
  }
  return out;
}

function runTsc(outDir: string): void {
  const req = createRequire(import.meta.url);
  const tsc = path.join(path.dirname(req.resolve("typescript/package.json")), "bin", "tsc");
  const args = [
    tsc,
    "--ignoreConfig",
    "--declaration",
    "--noUncheckedSideEffectImports",
    "false",
    "--emitDeclarationOnly",
    "--outDir",
    outDir,
    "--rootDir",
    PACKAGES,
    "--target",
    "ES2023",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--jsx",
    "react-jsx",
    "--strict",
    "--skipLibCheck",
    "--isolatedModules",
    "--lib",
    "ES2023,DOM,DOM.Iterable",
    "--types",
    "node",
    ...ENTRIES.map((e) => path.join(PACKAGES, e)),
  ];
  try {
    execFileSync(process.execPath, args, { cwd: PACKAGES, stdio: "pipe" });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`tsc could not emit the declarations:\n${String(e.stdout ?? "")}${String(e.stderr ?? "")}`);
  }
}

const SPEC = /(from\s+|import\(\s*)(["'])([^"']+)\2/g;
const exists = (file: string) => fs.access(file).then(() => true, () => false);

/**
 * Where an import in an emitted file points, as a path under packages/ without `.d.ts`: a relative one, or a workspace
 * package's export (`@humanharness/protocol`) when its declarations were emitted. Null: it stays an import as it is.
 */
async function resolveSpec(outDir: string, from: string, spec: string): Promise<string | null> {
  if (spec.startsWith(".")) {
    const base = posix(path.join(path.dirname(from), spec.replace(/\.js$/, "")));
    for (const c of [base, `${base}/index`]) if (await exists(path.join(outDir, `${c}.d.ts`))) return c;
    throw new Error(`${from}: no declarations for ${spec}`);
  }
  const m = /^@humanharness\/([^/]+)(\/.+)?$/.exec(spec);
  if (!m) return null;
  const pkg = JSON.parse(await fs.readFile(path.join(PACKAGES, m[1], "package.json"), "utf8").catch(() => "{}")) as { exports?: Record<string, unknown> };
  const target = pkg.exports?.[`.${m[2] ?? ""}`];
  const file = typeof target === "string" ? target : (target as { types?: string } | undefined)?.types;
  if (typeof file !== "string") return null;
  const rel = posix(path.join(m[1], file.replace(/\.tsx?$/, "")));
  return (await exists(path.join(outDir, `${rel}.d.ts`))) ? rel : null;
}

/** The emitted files the entries reach, keyed by their path under packages/ without `.d.ts`, and where each import points. */
async function closure(outDir: string): Promise<{ files: Map<string, string>; resolved: Map<string, string> }> {
  const files = new Map<string, string>();
  const resolved = new Map<string, string>();
  const visit = async (rel: string): Promise<void> => {
    if (files.has(rel)) return;
    const text = await fs.readFile(path.join(outDir, `${rel}.d.ts`), "utf8");
    files.set(rel, text);
    for (const m of text.matchAll(SPEC)) {
      const to = await resolveSpec(outDir, rel, m[3]);
      if (to === null) continue;
      resolved.set(`${rel}\0${m[3]}`, to);
      await visit(to);
    }
  };
  for (const e of ENTRIES) await visit(e.replace(/\.tsx?$/, ""));
  return { files, resolved };
}

/** One emitted file as the body of an ambient module: imports renamed, CSS imports and `declare` dropped, indented. */
function body(rel: string, text: string, resolved: Map<string, string>): string {
  const lines = text
    .replace(/^import\s+["'][^"']+\.css["'];\n/gm, "")
    .replace(SPEC, (all, lead: string, q: string, spec: string) => {
      const to = resolved.get(`${rel}\0${spec}`);
      return to === undefined ? all : `${lead}${q}${internalName(to)}${q}`;
    })
    .replace(/^(export\s+)?declare\s+/gm, "$1")
    .replace(/\n+$/, "")
    .split("\n");
  return lines.map((l) => (l === "" ? "" : `  ${l}`)).join("\n");
}

const block = (name: string, inner: string) => `declare module "${name}" {\n${inner}\n}\n`;

/** hh.d.ts as this version's sources declare it. */
export async function generateHhDts(): Promise<string> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-dts-"));
  try {
    runTsc(outDir);
    const { files, resolved } = await closure(outDir);
    const version = JSON.parse(readFileSync(path.join(PACKAGES, "shell", "package.json"), "utf8")).version as string;
    const parts = [
      `// The mod API of Human Harness ${version}: what a mod imports from @humanharness/mod-sdk and @humanharness/ui.\n`,
      `// Generated by \`${HH_DTS_COMMAND}\` (packages/shell/scripts/hh-dts.ts). Rewritten on every start: don't edit.\n`,
      `// Only the two modules at the end are the contract; the "_internal" modules hold what they refer to.\n\n`,
    ];
    for (const rel of [...files.keys()].sort()) parts.push(block(internalName(rel), body(rel, files.get(rel)!, resolved)), "\n");
    parts.push(block("@humanharness/mod-sdk", `  export * from "${internalName("mod-sdk/src/index")}";`), "\n");
    const ui = [...BLOCK_API, ...guideExports()].map(([rel, clause]) => `  ${clause} from "${internalName(rel)}";`);
    parts.push(block("@humanharness/ui", ui.join("\n")));
    return parts.join("");
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

/** The ambient modules of a hh.d.ts text: name → body. */
function modules(dts: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of dts.matchAll(/^declare module "([^"]+)" \{\n([\s\S]*?)\n\}$/gm)) out.set(m[1], m[2]);
  return out;
}

/** The names a module exports, following `export *` into the other modules of the same file. */
function namesOf(mods: Map<string, string>, name: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  const text = mods.get(name);
  if (text === undefined || seen.has(name)) return out;
  seen.add(name);
  for (const m of text.matchAll(/^ {2}export (?:default )?(?:abstract )?(?:type|interface|const|let|var|function|class|enum|namespace) (\w+)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^ {2}export (?:type )?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (n) out.add(n);
    }
  }
  for (const m of text.matchAll(/^ {2}export \* as (\w+) from/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^ {2}export \* from "([^"]+)"/gm)) for (const n of namesOf(mods, m[1], seen)) out.add(n);
  return out;
}

/** Every name the two public modules of a hh.d.ts text export, sorted (spec §8: each must appear in AGENTS.md). */
export function publicNames(dts: string): string[] {
  const mods = modules(dts);
  const names = new Set([...namesOf(mods, "@humanharness/mod-sdk"), ...namesOf(mods, "@humanharness/ui")]);
  names.delete("default");
  return [...names].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await fs.writeFile(HH_DTS_FILE, await generateHhDts());
  console.log(`Wrote ${path.relative(process.cwd(), HH_DTS_FILE)}`);
}
