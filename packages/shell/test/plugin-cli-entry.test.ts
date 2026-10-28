import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.join(__dirname, "../src/main");
const importsOf = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2] ?? m[3]);

describe("@humanharness/shell/plugins: the CLI's entry into the broker (P12)", () => {
  it("loads without Electron and exports the broker's parts", async () => {
    const mod = await import("../src/main/plugin-cli");
    for (const name of ["PluginBroker", "pluginFetch", "pluginExec", "runFile", "PluginData"]) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
  });

  it("no file of its import graph inside the shell imports electron", async () => {
    const seen = new Set<string>();
    const walk = async (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await fs.readFile(file, "utf8");
      for (const spec of importsOf(text)) {
        expect(spec, `${path.basename(file)} imports ${spec}`).not.toMatch(/^electron(\/|$)/);
        if (spec.startsWith(".")) await walk(path.resolve(path.dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`));
      }
    };
    await walk(path.join(main, "plugin-cli.ts"));
    for (const f of ["plugin-cli.ts", "plugin-broker.ts", "plugin-fetch.ts", "plugin-exec.ts", "plugin-data.ts"]) expect(seen.has(path.join(main, f)), f).toBe(true);
  });

  it("the import scan sees each import form", () => {
    expect(importsOf('import a from "x";\nimport { b } from \'y\';\nexport * from "z";\nimport "w";\nconst c = await import("v");')).toEqual(["x", "y", "z", "w", "v"]);
  });

  it("no shell source imports plugin.config or node:vm (the app never runs authoring code)", async () => {
    const src = path.join(__dirname, "../src");
    const all = (await fs.readdir(src, { recursive: true })).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
    expect(all.length).toBeGreaterThan(20);
    for (const f of all) {
      const specs = importsOf(await fs.readFile(path.join(src, f), "utf8"));
      expect(specs.filter((s) => /plugin\.config|^(node:)?vm$/.test(s)), f).toEqual([]);
    }
  });
});
