import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(__dirname, "../src/main");
const read = (f: string) => fs.readFile(path.join(main, f), "utf8");

/** The text from `start` to the end of the first balanced group `opener` finds (as tools-surface.test.ts). */
function group(text: string, start: number, opener = /[({]/): string {
  if (start < 0) throw new Error("not found");
  const open = text.slice(start).search(opener) + start;
  const close = text[open] === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

const count = (text: string, re: RegExp) => [...text.matchAll(new RegExp(re.source, "g"))].length;

describe("tools pre-steps surface (tools spec §6; D0)", () => {
  it("D0: prepare and phaseEnded are passed only under hasTools and hasPre/hasExpects", async () => {
    const index = await read("index.ts");
    const deps = group(index, index.indexOf("const taskDeps: TaskDeps = {"), /\{/);
    // Each is a getter of taskDeps (board lanes copy its getters): defined only when toolsHost exists (built only under
    // hasTools) and the harness declares pre (or expects); otherwise undefined, and the TaskManager runs nothing.
    const prepare = group(deps, deps.indexOf("get prepare()"), /\{/);
    expect(prepare).toContain("const tools = toolsHost;");
    expect(prepare).toContain("return tools && hasPre(harness) ? tools.prepare : undefined;");
    const ended = group(deps, deps.indexOf("get phaseEnded()"), /\{/);
    expect(ended).toContain("const tools = toolsHost;");
    expect(ended).toContain("return tools && hasExpects(harness) ? tools.phaseEnded : undefined;");
    // Named nowhere else in index.ts.
    expect(count(index, /\.prepare\b/)).toBe(1);
    expect(count(index, /\.phaseEnded\b/)).toBe(1);
    expect(count(index, /\bhasPre\(/)).toBe(1);
    expect(count(index, /\bhasExpects\(/)).toBe(1);
    // The task deps' `actions` are the loaded harness's, whose entries carry `pre` (the TaskManager's gate reads it).
    expect(deps).toContain("get actions() {\n    return harness.actions;\n  },");
  });

  it("the tools host gets the usage log, the engine and the scopes from the app", async () => {
    const index = await read("index.ts");
    const deps = group(index, index.indexOf("toolsHost = createToolsHost("));
    expect(deps).toContain("usage: async (record) => {");
    expect(deps).toContain("await new UsageLog(baseOf(c)).append(record);");
    expect(deps).toContain('engine: async () => (await config.load()).engineId ?? "",');
    expect(deps).toContain("scoped,");
  });

  it("the tools host emits no pre call live: pre calls go only to the first turn", async () => {
    const host = await read(path.join("tools", "tools-host.ts"));
    const called = group(host, host.indexOf("called: (e) =>"), /\{/);
    expect(called).toContain('if (e.caller === "pre")');
    expect(called.indexOf('if (e.caller === "pre")')).toBeLessThan(called.indexOf("d.emitToTask("));
  });
});
