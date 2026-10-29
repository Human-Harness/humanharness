import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type LoadedHarness, type ToolMeta, type ToolsJson, loadHarness, resolveInHarness, toolsJsonSchema } from "@humanharness/harness-sdk";
import { CliError } from "./cli";
import { MANIFEST } from "./paths";
import { type Toolchain, bundleError, common, toolchain, writeDist } from "./plugin-build";

/** One tool that didn't build: its file (relative to the harness folder) and why. */
export interface ToolBuildProblem {
  file: string;
  message: string;
}

/** A failed build: every tool's problem, one per line in `message`. */
export class ToolBuildError extends CliError {
  constructor(readonly problems: ToolBuildProblem[]) {
    super(problems.map((p) => p.message).join("\n"));
  }
}

export interface ToolBuildResult {
  /** What `dist/tools.json` holds. */
  json: ToolsJson;
  /** `tools/<id>.js` and `tools.json`, relative to dist/. */
  files: Map<string, Uint8Array | string>;
}

const req = createRequire(import.meta.url);
const NODE_BUILTINS = new Set(builtinModules);
const isNodeBuiltin = (name: string) => name.startsWith("node:") || NODE_BUILTINS.has(name);

/**
 * Fails the sandbox bundle on any Node built-in (tools spec D2, T1), naming it; esbuild puts the importing file and
 * line in front (bundleError: "tools/x.ts:1: imports node:fs, …").
 */
function refuseNode() {
  return {
    name: "hh-tool-no-node",
    setup(b: { onResolve(o: { filter: RegExp }, f: (a: { path: string }) => unknown): void }) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (!isNodeBuiltin(a.path)) return undefined;
        return { errors: [{ text: `imports ${a.path}, which a tool can't use: tools reach the world only through ctx` }] };
      });
    },
  };
}

/** The SDK's tool file, under every name a tool may import it by. */
function toolAliases(t: Toolchain): Record<string, string> {
  const tool = req.resolve("@humanharness/harness-sdk/tool");
  return { "@humanharness/cli/tool": tool, "@humanharness/harness-sdk/tool": tool, "@humanharness/harness-sdk": t.sdk };
}

/** The tool's sandbox bundle: ESM for the browser, no Node built-ins, nothing left to import. */
async function sandboxBundle(t: Toolchain, dir: string, id: string, abs: string, rel: string): Promise<Uint8Array> {
  const base = common(t, dir, toolAliases(t));
  let out;
  try {
    out = await t.esbuild.build({
      ...base,
      plugins: [refuseNode(), ...base.plugins],
      alias: { ...t.folders, zod: t.zod },
      entryPoints: [abs],
      platform: "browser",
      format: "esm",
      target: "chrome130",
      outfile: `${id}.js`,
    });
  } catch (err) {
    throw bundleError(err, t, dir);
  }
  const names = out.outputFiles.map((f) => path.basename(f.path));
  if (names.length !== 1 || names[0] !== `${id}.js`) throw new CliError(`${rel}: the bundle would write ${names.join(", ")}; a tool imports only code`);
  return out.outputFiles[0].contents;
}

/**
 * The tool's `tools.json` entry: the file bundled for Node with `toolMeta` (one zod copy, so `instanceof` and
 * `z.toJSONSchema` agree), run from a temp `.mjs` that is removed after, as `plugin build` reads plugin.config.ts.
 */
async function metadata(t: Toolchain, dir: string, id: string, rel: string): Promise<ToolMeta> {
  const entry = [
    `import * as tool from ${JSON.stringify(`./${rel}`)};`,
    'import { toolMeta } from "@humanharness/harness-sdk";',
    "export default () => {",
    "  const d = tool.default;",
    `  if (typeof d !== "object" || d === null || typeof d.run !== "function") throw new Error(${JSON.stringify(`${rel}: the default export must be defineTool({ ... })`)});`,
    `  return toolMeta(${JSON.stringify(id)}, d);`,
    "};",
  ].join("\n");
  let out;
  try {
    out = await t.esbuild.build({
      ...common(t, dir, toolAliases(t)),
      alias: { ...t.folders, zod: t.zod },
      stdin: { contents: entry, resolveDir: dir, sourcefile: "hh-tool-meta.ts", loader: "ts" },
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: "meta.mjs",
      supported: {},
    });
  } catch (err) {
    throw bundleError(err, t, dir);
  }
  const temp = path.join(os.tmpdir(), `hh-tool-meta-${randomBytes(8).toString("hex")}.mjs`);
  try {
    await fs.writeFile(temp, out.outputFiles[0].contents);
    let read: () => ToolMeta;
    try {
      read = ((await import(pathToFileURL(temp).href)) as { default: () => ToolMeta }).default;
    } catch (err) {
      throw new CliError(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      return read();
    } catch (err) {
      throw new CliError(err instanceof Error ? err.message : String(err));
    }
  } finally {
    await fs.rm(temp, { force: true });
  }
}

const isFile = (p: string) =>
  fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  );

/**
 * `humanharness build` (tools spec §3.2, Decision 2): each tool file bundled for the sandbox into `tools/<id>.js`, and
 * its metadata into `tools.json`. Everything is built in memory; with `write`, `<dir>/dist/tools/` and
 * `dist/tools.json` are replaced only when every tool built, and the rest of dist/ stays. `check` builds without writing.
 */
export async function buildTools(dir: string, o: { write: boolean; harness?: LoadedHarness }): Promise<ToolBuildResult> {
  const root = path.resolve(dir);
  const harness = o.harness ?? (await loadHarness(path.join(root, MANIFEST)));
  const t = toolchain();
  const problems: ToolBuildProblem[] = [];
  const tools: Record<string, ToolMeta> = {};
  const files = new Map<string, Uint8Array | string>();
  for (const id of Object.keys(harness.tools ?? {}).sort()) {
    let rel = harness.tools?.[id] ?? "";
    try {
      // The manifest's pattern checks only the `./` prefix and the extension: the file must stay in the folder.
      const abs = resolveInHarness(harness, rel);
      rel = path.relative(root, abs).split(path.sep).join("/");
      if (!(await isFile(abs))) throw new CliError(`${rel} is missing`);
      files.set(`tools/${id}.js`, await sandboxBundle(t, root, id, abs, rel));
      tools[id] = await metadata(t, root, id, rel);
    } catch (err) {
      problems.push({ file: rel, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (problems.length > 0) throw new ToolBuildError(problems);
  const parsed = toolsJsonSchema.safeParse({ version: 1, tools });
  if (!parsed.success) {
    throw new ToolBuildError(
      parsed.error.issues.map((i) => {
        const [, id] = i.path.map(String);
        return { file: (id && harness.tools?.[id]?.replace(/^\.\//, "")) || MANIFEST, message: `${i.path.slice(1).map(String).join(".")}: ${i.message}` };
      }),
    );
  }
  const json = { version: 1 as const, tools };
  files.set("tools.json", `${JSON.stringify(json, null, 2)}\n`);
  if (o.write) await writeTools(path.join(root, "dist"), files);
  return { json, files };
}

/** Swaps in `dist/tools/` (writeDist: a failed write leaves the previous folder), then `dist/tools.json` by rename. */
async function writeTools(dist: string, files: Map<string, Uint8Array | string>): Promise<void> {
  const bundles = new Map([...files].filter(([name]) => name.startsWith("tools/")).map(([name, c]) => [name.slice("tools/".length), c]));
  await writeDist(path.join(dist, "tools"), bundles);
  const temp = path.join(dist, `.tools-${randomBytes(6).toString("hex")}.json`);
  try {
    await fs.writeFile(temp, files.get("tools.json") ?? "");
    await fs.rename(temp, path.join(dist, "tools.json"));
  } finally {
    await fs.rm(temp, { force: true });
  }
}
