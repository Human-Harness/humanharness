import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOD_ID, type ModDefinition, type ModJson, modJsonSchema } from "@humanharness/mod-sdk";
import { MAIN_SHARED_MODULES, bundleMod } from "@humanharness/mod-sdk/bundle";
import { writeMainShims } from "@humanharness/shell/mod-shims";
import { findHome } from "./app-home";
import { CliError, type Io, UsageError, parseCommand } from "./cli";

export const MOD_USAGE = [
  "Usage: humanharness mod <command>",
  "",
  "Commands:",
  "  check <folder>                           Check a mod without the app: mod.json, its bundles, main and each block",
  "  clone <id> [as] [--home <dir>]           Copy a core or harness mod to mods/<as> in the app's home folder",
  "",
].join("\n");
export const LAYOUT_USAGE = "Usage: humanharness layout clone <name> [as] [--home <dir>]\n";

/** The layout file names the app reads (shell's layout.ts). */
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAIN_TIMEOUT_MS = 10_000;
const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `humanharness mod <check|clone>`. */
export async function modCommand(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "check") return modCheck(rest, io);
  if (sub === "clone") return modClone(rest, io);
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    (sub === undefined ? io.stderr : io.stdout).write(MOD_USAGE);
    return sub === undefined ? 2 : 0;
  }
  throw new UsageError(`Unknown mod command: ${sub}\n\n${MOD_USAGE}`);
}

/** `humanharness layout clone`. */
export async function layoutCommand(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "clone") throw new UsageError(LAYOUT_USAGE.trimEnd());
  const { values, positionals } = parseCommand(rest, { home: { type: "string" } });
  const [name, as = name] = positionals;
  if (name === undefined || positionals.length > 2) throw new UsageError(LAYOUT_USAGE.trimEnd());
  if (!LAYOUT_NAME.test(as)) throw new CliError(`${as} isn't a valid layout name: letters, digits, - and _`);
  const home = findHome(io.cwd, values.home);
  const target = path.join(home, "layouts", `${as}.json`);
  if (existsSync(target)) throw new CliError(`${target} already exists`);
  const source = LAYOUT_NAME.test(name) ? ["harness", "core"].map((l) => path.join(home, l, "layouts", `${name}.json`)).find((f) => existsSync(f)) : undefined;
  if (!source) throw new CliError(`No layout ${name} in harness/layouts or core/layouts`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  io.stdout.write(`Copied ${path.relative(home, source)} to ${target}\n`);
  return 0;
}

// ---- mod clone ---------------------------------------------------------------------------------------------------

/** The source file of a built entry (`ui.js` → `src/ui.tsx`); the entry itself when it is a source already. */
function sourceEntry(dir: string, entry: string): string | undefined {
  const stem = entry.replace(/\.(m?js|cjs|tsx?|jsx)$/, "");
  const tries = ["tsx", "ts", "jsx"].flatMap((ext) => [path.join("src", `${path.basename(stem)}.${ext}`), `${stem}.${ext}`]);
  for (const t of [...tries, entry]) if (existsSync(path.join(dir, t))) return t.split(path.sep).join("/");
  return undefined;
}

const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && SOURCE_FILE.test(e.name)) out.push(path.join(e.parentPath, e.name));
  }
  return out;
}

async function modClone(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { home: { type: "string" } });
  const [id, as = id] = positionals;
  if (id === undefined || positionals.length > 2) throw new UsageError("Usage: humanharness mod clone <id> [as] [--home <dir>]");
  if (!MOD_ID.test(as)) throw new CliError(`${as} isn't a valid mod id: lowercase letters, digits and -, at most 40`);
  const home = findHome(io.cwd, values.home);
  const target = path.join(home, "mods", as);
  if (existsSync(target)) throw new CliError(`${target} already exists`);
  const source = MOD_ID.test(id) ? ["core", "harness"].map((l) => path.join(home, l, "mods", id)).find((d) => existsSync(path.join(d, "mod.json"))) : undefined;
  if (!source) throw new CliError(`No mod ${id} in core/mods or harness/mods`);

  const raw = JSON.parse(await fs.readFile(path.join(source, "mod.json"), "utf8")) as Record<string, unknown>;
  const parsed = modJsonSchema.safeParse(raw);
  if (!parsed.success) throw new CliError(`${path.join(source, "mod.json")} isn't valid: ${parsed.error.issues[0]?.message}`);
  const json = parsed.data;
  const entries: Partial<Record<"main" | "ui", string>> = {};
  for (const key of ["main", "ui"] as const) {
    const entry = json[key];
    if (entry === undefined) continue;
    const src = sourceEntry(source, entry);
    if (!src) throw new CliError(`${id}'s ${key} (${entry}) has no source file to copy`);
    entries[key] = src;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, filter: (f) => !f.split(path.sep).includes("node_modules") });
  const next = { ...raw, id: as, ...entries, clonedFrom: { id: json.id, version: json.version } };
  await fs.writeFile(path.join(target, "mod.json"), `${JSON.stringify(next, null, 2)}\n`);
  if (as !== id) {
    const pattern = new RegExp(`(defineMod\\(\\s*\\{\\s*id:\\s*)(["'])${id}\\2`, "g");
    for (const file of await sourceFiles(target)) {
      const text = await fs.readFile(file, "utf8");
      const changed = text.replace(pattern, (_m, head: string, q: string) => `${head}${q}${as}${q}`);
      if (changed !== text) await fs.writeFile(file, changed);
    }
  }
  io.stdout.write(`Copied ${path.relative(home, source)} to ${target}. It starts off: turn the original off and the clone on in Settings › Mods.\n`);
  return 0;
}

// ---- mod check ---------------------------------------------------------------------------------------------------

interface Runtime {
  react: typeof import("react");
  jsx: Record<string, unknown>;
  server: { renderToString(node: unknown): string };
  ui: Record<string, unknown>;
}
let runtime: Promise<Runtime> | undefined;

/**
 * React, react-dom/server and `@humanharness/ui` as one ESM file for node: the ui package imports CSS and fonts,
 * which node can't load, so they are bundled away. Built once per process.
 */
function loadRuntime(): Promise<Runtime> {
  runtime ??= (async () => {
    const req = createRequire(import.meta.url);
    const { build } = req("esbuild") as typeof import("esbuild");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-mod-check-rt-"));
    const outfile = path.join(dir, "runtime.mjs");
    await build({
      stdin: {
        contents: `export * as react from "react"; export * as jsx from "react/jsx-runtime"; export * as server from "react-dom/server.browser"; export * as ui from "@humanharness/ui";`,
        resolveDir: path.join(HERE, ".."),
        loader: "js",
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      logLevel: "silent",
      loader: { ".css": "empty", ".woff2": "empty", ".woff": "empty", ".ttf": "empty", ".svg": "empty", ".png": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      banner: { js: `import { createRequire as __hhCreateRequire } from "module"; const require = __hhCreateRequire(import.meta.url);` },
    });
    return (await import(pathToFileURL(outfile).href)) as Runtime;
  })();
  return runtime;
}

/** An `app` that answers anything: every property is another such value, and as text it is empty. */
function fakeValue(): unknown {
  const target = () => undefined;
  const proxy: unknown = new Proxy(target, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => "";
      if (key === "toString" || key === "valueOf") return () => "";
      if (typeof key === "symbol" || key === "then" || key === "$$typeof") return undefined;
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

/** A `MainCtx` that runs nothing and records what the mod registers. */
function fakeMainCtx(id: string, config: unknown, registered: string[]) {
  const reg = (name: string) => () => {
    registered[registered.length] = name;
    return () => undefined;
  };
  const store = new Map<string, unknown>();
  return {
    id,
    config,
    on: { beforeSend: reg("beforeSend"), turnStart: reg("turnStart"), turnEnd: reg("turnEnd"), taskOpen: reg("taskOpen"), taskClose: reg("taskClose") },
    ipc: (name: string) => reg(`ipc ${name}`)(),
    engine: { run: async () => ({ ok: false, error: "mod check runs no engine" }) },
    tasks: { running: async () => null },
    notes: { titles: async () => [] },
    storage: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => void store.set(k, v) },
    dataDir: async () => null,
    notify: () => undefined,
    provide: () => undefined,
    mods: { get: () => undefined },
    log: () => undefined,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn't finish in ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

async function importDefault(file: string): Promise<ModDefinition<unknown>> {
  const m = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: ModDefinition<unknown> };
  const def = m.default;
  if (!def || typeof def !== "object") throw new Error("it has no default export: export default defineMod({ ... })");
  return def;
}

async function modCheck(args: string[], io: Io): Promise<number> {
  const { positionals } = parseCommand(args, {});
  if (positionals.length !== 1) throw new UsageError("Usage: humanharness mod check <folder>");
  const dir = path.resolve(io.cwd, positionals[0]);
  let failed = false;
  const say = (ok: boolean, text: string) => {
    if (!ok) failed = true;
    io.stdout.write(`${ok ? "✓" : "✗"} ${text}\n`);
  };

  let json: ModJson;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, "mod.json"), "utf8")) as unknown;
    const r = modJsonSchema.safeParse(raw);
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; "));
    json = r.data;
    say(true, "mod.json");
  } catch (err) {
    say(false, `mod.json: ${why(err)}`);
    return 1;
  }

  const out = await fs.mkdtemp(path.join(os.tmpdir(), "hh-mod-check-"));
  try {
    const idMatches = (part: string, def: ModDefinition<unknown>) => {
      if (def.id === json.id) return true;
      say(false, `${part}: defineMod has id ${JSON.stringify(def.id)}, mod.json has ${JSON.stringify(json.id)}`);
      return false;
    };

    if (json.main !== undefined) {
      const outFile = path.join(out, "main.mjs");
      const resolveShared = await writeMainShims(path.join(out, ".shared"), MAIN_SHARED_MODULES);
      const b = await bundleMod({ dir, entry: json.main, part: "main", outFile, resolveShared });
      if (!b.ok) say(false, `main: ${b.problems.join("; ")}`);
      else {
        say(true, "main: bundled");
        try {
          const def = await importDefault(outFile);
          if (idMatches("main", def)) {
            let config: unknown;
            let schemaOk = true;
            if (def.schema) {
              const r = def.schema.safeParse({});
              if (r.success) {
                config = r.data;
                say(true, "main: schema accepts an empty config");
              } else {
                schemaOk = false;
                say(false, `main: schema refuses an empty config: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
              }
            }
            if (schemaOk && def.main) {
              const registered: string[] = [];
              await withTimeout(Promise.resolve(def.main(fakeMainCtx(json.id, config, registered) as never)), MAIN_TIMEOUT_MS, "main");
              say(true, `main: ran${registered.length > 0 ? ` (${registered.join(", ")})` : ""}`);
            } else if (!def.main) say(false, "main: mod.json has main but defineMod has no main(ctx)");
          }
        } catch (err) {
          say(false, `main: ${why(err)}`);
        }
      }
    }

    if (json.ui !== undefined) {
      const outFile = path.join(out, "ui.js");
      const b = await bundleMod({ dir, entry: json.ui, part: "ui", outFile, resolveShared: () => "" });
      if (!b.ok) say(false, `ui: ${b.problems.join("; ")}`);
      else {
        say(true, "ui: bundled");
        try {
          const rt = await loadRuntime();
          const app = fakeValue();
          const g = globalThis as { __hhModules?: Record<string, unknown> };
          g.__hhModules = {
            react: rt.react,
            "react/jsx-runtime": rt.jsx,
            "@humanharness/ui": { ...rt.ui, useApp: () => app },
            ...MAIN_SHARED_MODULES,
          };
          const def = await importDefault(outFile);
          if (idMatches("ui", def)) {
            if (!def.ui) say(false, "ui: mod.json has ui but defineMod has no ui(ctx)");
            else {
              const blocks: [string, unknown][] = [];
              def.ui({ id: json.id, block: (name, component) => (blocks.push([name, component]), () => undefined) });
              say(true, `ui: ran (${blocks.length} block${blocks.length === 1 ? "" : "s"})`);
              for (const [name, component] of blocks) {
                try {
                  if (typeof component !== "function" && typeof component !== "object") throw new Error("it isn't a component");
                  rt.server.renderToString(rt.react.createElement(component as never, { props: {}, app } as never));
                  say(true, `block ${name}: rendered`);
                } catch (err) {
                  say(false, `block ${name}: ${why(err)}`);
                }
              }
            }
          }
        } catch (err) {
          say(false, `ui: ${why(err)}`);
        }
      }
    }
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}
