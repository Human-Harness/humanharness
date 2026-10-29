import { promises as fs } from "node:fs";
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
    for (const name of ["ToolRegistry", "ToolBroker", "ToolTrace", "toolFiles", "runPreSteps", "runToolStep", "preparedSection", "readToolsJson"]) expect(typeof (mod as Record<string, unknown>)[name], name).toBe("function");
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
});
