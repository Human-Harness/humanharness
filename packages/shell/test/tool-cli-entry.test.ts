import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.join(__dirname, "../src/main");
/** Each import of a file, and whether the compiler erases it: a whole-statement type import (`import type …`,
 * `export type …`) or a type query (`typeof import("…")`) never loads its module at run time. */
const importsOf = (text: string) =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|(\btypeof\s+)?\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => ({
    spec: m[1] ?? m[3] ?? m[4],
    typeOnly: m[1] !== undefined ? /^\s*(?:import|export)\s+type\s/.test(m[0]) : m[2] !== undefined,
  }));

describe("@humanharness/shell/tools: the CLI's entry into the registry (A1)", () => {
  it("loads without Electron and exports the registry's parts", async () => {
    const mod = await import("../src/main/tools/tool-cli");
    for (const name of ["ToolRegistry", "ToolBroker", "ToolTrace", "toolFiles", "runPreSteps", "runToolStep", "preparedSection", "readToolsJson", "prepareTask"]) expect(typeof (mod as Record<string, unknown>)[name], name).toBe("function");
  });

  // tool-registry.ts takes ToolHostCall/ToolHostAnswer from tool-host.ts, which takes Electron's types (`import type`,
  // `typeof import("electron")`): all erased, so neither tool-host.ts nor electron loads. A value import of electron anywhere still fails.
  it("no file of its import graph inside the shell imports electron (types aside) or node:vm", async () => {
    const seen = new Set<string>();
    const walk = async (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await fs.readFile(file, "utf8");
      for (const { spec, typeOnly } of importsOf(text)) {
        if (!typeOnly) expect(spec, `${path.basename(file)} imports ${spec}`).not.toMatch(/^electron(\/|$)/);
        expect(spec, `${path.basename(file)} imports ${spec}`).not.toMatch(/^(node:)?vm$/);
        if (spec.startsWith(".")) await walk(path.resolve(path.dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`));
      }
    };
    await walk(path.join(main, "tools/tool-cli.ts"));
    for (const f of ["tool-cli.ts", "tool-registry.ts", "tool-broker.ts", "tool-trace.ts", "tool-files.ts", "pre-steps.ts", "prepared-section.ts", "tools-json.ts"]) expect(seen.has(path.join(main, "tools", f)), f).toBe(true);
  });

  it("the import scan sees each import form, and only whole-statement type imports as type-only", () => {
    expect(importsOf('import a from "x";\nimport type { B } from "y";\nexport type { C } from "z";\nimport { type D } from "u";\nimport "w";\nconst c = await import("v");\ntype E = typeof import("t");')).toEqual([
      { spec: "x", typeOnly: false },
      { spec: "y", typeOnly: true },
      { spec: "z", typeOnly: true },
      { spec: "u", typeOnly: false },
      { spec: "w", typeOnly: false },
      { spec: "v", typeOnly: false },
      { spec: "t", typeOnly: true },
    ]);
  });

  // The scan reads import statements; this loads the real graph (end follow-up M1): a fresh Node with tsx and a resolve
  // hook that refuses electron and vm, whatever form asks for them (import, dynamic import, require, createRequire).
  describe("under Node with electron and vm refused at resolve", () => {
    const shell = path.join(__dirname, "..");
    const BLOCK = `import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (/^(node:)?vm$/.test(specifier) || /^electron(\\/|$)/.test(specifier)) throw new Error("blocked: " + specifier);
    return next(specifier, context);
  },
});
`;
    /** Runs `code` (an ES module) in a fresh Node from the shell package with the hook on; its stdout, or the throw. */
    const node = async (code: string) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-cli-entry-"));
      try {
        const block = path.join(dir, "block.mjs");
        await fs.writeFile(block, BLOCK);
        await fs.writeFile(path.join(dir, "uses-vm.ts"), 'import { createRequire } from "node:module";\nexport const vm: unknown = createRequire(import.meta.url)("vm");\n');
        return execFileSync(process.execPath, ["--import", "tsx", "--import", block, "--input-type=module", "-e", code.replaceAll("$DIR", dir)], { cwd: shell, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    };

    it("the hook works: electron, node:vm and a TS file's require of vm are refused", async () => {
      const out = await node(`
for (const load of [() => import("electron"), () => import("node:vm"), () => import("$DIR/uses-vm.ts")]) {
  try { await load(); console.log("loaded"); } catch (e) { console.log(String(e.message).match(/blocked: \\S+/)?.[0] ?? e.message); }
}`);
      expect(out.trim().split("\n")).toEqual(["blocked: electron", "blocked: node:vm", "blocked: vm"]);
    }, 60_000);

    it("@humanharness/shell/tools loads, and exports the registry's parts", async () => {
      const out = await node(`const m = await import("@humanharness/shell/tools"); console.log(Object.keys(m).filter((k) => typeof m[k] === "function").sort().join(","));`);
      for (const name of ["ToolRegistry", "ToolBroker", "ToolTrace", "toolFiles", "runPreSteps", "preparedSection", "prepareTask", "readToolsJson", "readToolRecordings", "recordedToolTransport"]) expect(out.trim().split(","), name).toContain(name);
    }, 60_000);
  });
});
