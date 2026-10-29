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

describe("recipes surface (tools spec §7; D0)", () => {
  it("D0: buildJobsHost passes tools only when the tools host exists", async () => {
    const index = await read("index.ts");
    const build = group(index, index.indexOf("function buildJobsHost("), /\{/);
    expect(build).toContain("...(toolsHost ? { tools: recipeTools(toolsHost) } : {}),");
    // The jobs host's `tools` key is set there only; recipeTools is defined once and called once.
    expect(count(build, /\btools: /)).toBe(1);
    expect(count(index, /\brecipeTools\(/)).toBe(2);
    // toolsHost is set (under hasTools) before buildJobsHost's first call, at "ready".
    expect(index.indexOf("toolsHost = createToolsHost(")).toBeLessThan(index.indexOf("buildJobsHost(board.gate"));
  });

  it("readBrief reads a brief only for a prompt job", async () => {
    const index = await read("index.ts");
    const build = group(index, index.indexOf("function buildJobsHost("), /\{/);
    expect(build).toContain(
      'readBrief: (job) => (job.prompt !== undefined ? fs.readFile(resolveInHarness(harness, job.prompt), "utf8") : Promise.reject(new Error("A recipe has no brief"))),',
    );
  });

  it("a recipe's tools: the registry, the run's trailer, the job's limits, the trace's last call and the AI step's brief in the harness folder", async () => {
    const index = await read("index.ts");
    const fn = group(index, index.indexOf("function recipeTools("), /\{/);
    expect(fn).toContain("registry: t.registry,");
    expect(fn).toContain("withRunTrailer: (trailer, fn) => t.withRunTrailer(trailer, fn),");
    expect(fn).toContain("limits: (job) => jobLimits(harness, job),");
    // The last call, never a trace note: lastCallOf's behaviour is tested in jobs-recipes/tools-host-run-trailer.test.ts.
    expect(fn).toContain("lastCall: async (run) => lastCallOf(await t.trace(run)),");
    expect(fn).toContain('readAiBrief: (p) => fs.readFile(resolveInHarness(harness, p), "utf8"),');
  });
});
