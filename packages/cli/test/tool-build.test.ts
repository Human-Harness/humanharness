import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolsJsonSchema } from "@humanharness/harness-sdk";
import { afterAll, describe, expect, it, vi } from "vitest";
import { checkHarness } from "../src/check";
import { type DevSpawn, devCommand } from "../src/dev";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { buildTools } from "../src/tool-build";
import { CORE, memoryIo, memoryStream, read, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-tool-build-");
afterAll(cleanup);
let n = 0;

const COUNT_NOTES = `import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: "Lists the notes of a month.",
  params: z.object({ month: z.string().optional() }),
  returns: z.array(z.object({ path: z.string() })),
  uses: { files: "read" },
  async run(args, ctx) {
    const files = await ctx.files.list("notes", args.month ? \`\${args.month}-*.md\` : "*.md");
    return files.map((p) => ({ path: p }));
  },
});
`;

/** A harness repo from the template; `tools` is added to its manifest (none: D0) and each file written. */
async function harness(tools?: Record<string, string>): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  if (tools) {
    const map = Object.fromEntries(Object.keys(tools).map((id) => [id, `./tools/${id}.ts`]));
    replaceIn(dir, "harness.config.ts", "  actions: {\n", `  tools: ${JSON.stringify(map)},\n  actions: {\n`);
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    for (const [id, code] of Object.entries(tools)) fs.writeFileSync(path.join(dir, "tools", `${id}.ts`), code);
  }
  return dir;
}

/** A tool file whose params are `params` (zod source text). */
const withParams = (params: string) => COUNT_NOTES.replace("z.object({ month: z.string().optional() })", params).replace("args.month ? `${args.month}-*.md` : ", "");

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the build to fail");
    },
    (err: Error) => err.message,
  );

describe("humanharness build (tools spec §3.2)", () => {
  it("writes dist/tools/<id>.js and dist/tools.json with JSON Schemas, description, agent, uses and timeout", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    const m = memoryIo(dir);
    expect(await main(["build"], m.io)).toBe(0);
    expect(m.out()).toBe("Built 1 tool into dist/\n");
    const json = toolsJsonSchema.parse(JSON.parse(read(dir, "dist/tools.json")));
    const meta = json.tools["count-notes"];
    expect(meta.description).toBe("Lists the notes of a month.");
    expect(meta.agent).toBe("call");
    expect(meta.uses).toEqual({ files: "read" });
    expect((meta.params as { properties: { month: { type: string } } }).properties.month.type).toBe("string");
    expect(meta.returns?.type).toBe("array");
    expect(meta.timeout).toBe(30);
    expect(meta.file).toBe("tools/count-notes.js");
    expect(fs.existsSync(path.join(dir, "dist", "tools", "count-notes.js"))).toBe(true);
    expect(read(dir, "dist/tools.json").endsWith("}\n")).toBe(true);
  });

  it("a Node built-in fails the build naming it", async () => {
    const bad = `import { readFileSync } from "node:fs";\n${COUNT_NOTES.replace('"Lists the notes of a month."', "String(readFileSync)")}`;
    const dir = await harness({ bad });
    const message = await failure(buildTools(dir, { write: true }));
    expect(message).toBe("tools/bad.ts:1: imports node:fs, which a tool can't use: tools reach the world only through ctx");
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });

  it("a bare built-in name (fs, child_process) fails too", async () => {
    const bad = `import { execSync } from "child_process";\n${COUNT_NOTES.replace('"Lists the notes of a month."', "String(execSync)")}`;
    const message = await failure(buildTools(await harness({ bad }), { write: false }));
    expect(message).toBe("tools/bad.ts:1: imports child_process, which a tool can't use: tools reach the world only through ctx");
  });

  it("a schema outside the allowlist fails naming the tool and path", async () => {
    const dir = await harness({ "count-notes": withParams("z.object({ x: z.string().regex(/x/) })") });
    const message = await failure(buildTools(dir, { write: false }));
    expect(message).toContain("count-notes: params.properties.x: ");
    expect(message).toContain('"pattern"');
  });

  it("a default export that is not defineTool(...) fails naming the file", async () => {
    const message = await failure(buildTools(await harness({ odd: "export default 42;\n" }), { write: false }));
    expect(message).toBe("tools/odd.ts: the default export must be defineTool({ ... })");
  });

  it("the sandbox bundle has no import of anything but its own code", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    const { files } = await buildTools(dir, { write: false });
    const js = Buffer.from(files.get("tools/count-notes.js") as Uint8Array).toString("utf8");
    expect(js).not.toMatch(/\bimport\s*\(/);
    expect(js).not.toMatch(/\brequire\s*\(/);
    expect(js).not.toMatch(/\bimport\s*["'{*]|\bfrom\s*["']/);
    expect(js).toMatch(/export\s*\{[^}]*\bas default\b/);
  });

  it("replaces dist/tools* only on success; other files in dist/ stay", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    fs.mkdirSync(path.join(dir, "dist", "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "keep.txt"), "mine");
    fs.writeFileSync(path.join(dir, "dist", "tools", "stale.js"), "old");
    await buildTools(dir, { write: true });
    expect(read(dir, "dist/keep.txt")).toBe("mine");
    expect(fs.readdirSync(path.join(dir, "dist", "tools"))).toEqual(["count-notes.js"]);
    const before = read(dir, "dist/tools.json");
    const bundle = read(dir, "dist/tools/count-notes.js");
    fs.writeFileSync(path.join(dir, "tools", "count-notes.ts"), `import "node:os";\n${COUNT_NOTES}`);
    await failure(buildTools(dir, { write: true }));
    expect(read(dir, "dist/tools.json")).toBe(before);
    expect(read(dir, "dist/tools/count-notes.js")).toBe(bundle);
    expect(read(dir, "dist/keep.txt")).toBe("mine");
    expect(fs.readdirSync(path.join(dir, "dist")).sort()).toEqual(["keep.txt", "tools", "tools.json"]);
  });

  it("a failed tools.json write leaves the old bundles: new bundles never pair with an old tools.json", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    await buildTools(dir, { write: true });
    const before = read(dir, "dist/tools.json");
    const bundle = read(dir, "dist/tools/count-notes.js");
    fs.writeFileSync(path.join(dir, "tools", "count-notes.ts"), COUNT_NOTES.replace("return files.map", "if (files.length > 99) return [];\n    return files.map"));
    const write = fs.promises.writeFile;
    const spy = vi.spyOn(fs.promises, "writeFile").mockImplementation((file, ...rest) => {
      if (/[\\/]\.tools-[0-9a-f]+\.json$/.test(String(file))) return Promise.reject(new Error("disk full"));
      return write(file, ...rest);
    });
    try {
      expect(await failure(buildTools(dir, { write: true }))).toBe("disk full");
    } finally {
      spy.mockRestore();
    }
    expect(read(dir, "dist/tools/count-notes.js") === bundle, "the old bundle stays").toBe(true);
    expect(read(dir, "dist/tools.json")).toBe(before);
    expect(fs.readdirSync(path.join(dir, "dist")).sort()).toEqual(["tools", "tools.json"]);
    // The next build goes through: the new bundle and its tools.json land together.
    await buildTools(dir, { write: true });
    expect(read(dir, "dist/tools/count-notes.js") === bundle, "the new bundle is in").toBe(false);
  });

  it("a tool throwing at top level leaves no hh-tool-meta-* temp module behind", async () => {
    const leftovers = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("hh-tool-meta-"));
    const dir = await harness({ boom: `throw new Error("boom at load");\n${COUNT_NOTES}` });
    const spy = vi.spyOn(fs.promises, "writeFile");
    let temp: string | undefined;
    try {
      const message = await failure(buildTools(dir, { write: false }));
      expect(message).toBe("tools/boom.ts: boom at load");
      temp = spy.mock.calls.map(([f]) => String(f)).find((f) => path.basename(f).startsWith("hh-tool-meta-"));
    } finally {
      spy.mockRestore();
    }
    // The temp module was written (the throw happened on import), and it is gone.
    expect(temp).toBeDefined();
    expect(fs.existsSync(temp as string)).toBe(false);
    expect(leftovers()).not.toContain(path.basename(temp as string));
  });

  it("a tool file outside the harness folder is refused", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    replaceIn(dir, "harness.config.ts", '"./tools/count-notes.ts"', '"./../escape.ts"');
    const m = memoryIo(dir);
    expect(await main(["build"], m.io)).toBe(1);
    expect(m.err()).toContain("Path escapes the harness folder");
  });

  it("build: a harness without tools says so and writes nothing", async () => {
    const dir = await harness();
    const m = memoryIo(dir);
    expect(await main(["build"], m.io)).toBe(0);
    expect(m.out()).toBe("This harness declares no tools.\n");
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });

  it("check reports a failing tool as tool-build and writes nothing", async () => {
    const dir = await harness({ odd: "export default 42;\n" });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "tool-build")).toEqual([
      { rule: "tool-build", severity: "error", message: "tools/odd.ts: the default export must be defineTool({ ... })", file: "tools/odd.ts" },
    ]);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });

  it("dev builds the tools before opening the app, and a build error stops it", async () => {
    const dir = await harness({ "count-notes": COUNT_NOTES });
    const calls: string[] = [];
    const spawn: DevSpawn = (command) => {
      calls.push(command);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    };
    expect(await devCommand({ harnessDir: dir, out: memoryStream().stream, spawn })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "dist", "tools.json"))).toBe(true);

    const bad = await harness({ odd: "export default 42;\n" });
    const out = memoryStream();
    expect(await devCommand({ harnessDir: bad, out: out.stream, spawn })).toBe(1);
    expect(calls).toHaveLength(1);
    expect(out.text()).toContain("tools/odd.ts: the default export must be defineTool({ ... })");
  });

  it("D0: check and dev write nothing for a harness without tools", async () => {
    const dir = await harness();
    const r = await checkHarness(dir);
    expect(r.findings.some((f) => f.rule === "tool-build")).toBe(false);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
    const calls: string[] = [];
    const spawn: DevSpawn = (command) => {
      calls.push(command);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    };
    expect(await devCommand({ harnessDir: dir, out: memoryStream().stream, spawn })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });
});
