import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CliError, UsageError } from "../src/cli";
import { toolCommand } from "../src/tool-command";
import { TOOL_P12_NOTE } from "../src/tool-host-node";
import { formatToolReports, testTools } from "../src/tool-test";
import { CORE, memoryIo, memoryStream, tempRoot } from "./helpers";

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tools-mini");
const { root, cleanup } = tempRoot("hh-tool-test-");
afterAll(cleanup);
let n = 0;

const TOOLS: Record<string, string> = {
  echo: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns its arguments.",
  params: z.object({ a: z.number() }),
  returns: z.object({ a: z.number() }),
  async run(args) {
    return { a: args.a };
  },
});
`,
  fetcher: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Fetches api.example.test with the API key.",
  params: z.object({ url: z.string().optional() }),
  returns: z.object({ status: z.number(), text: z.string() }),
  uses: { hosts: ["api.example.test"], secrets: ["api"] },
  async run(args, ctx) {
    const res = await ctx.fetch(args.url ?? "https://api.example.test/x", { headers: { authorization: "Bearer {{secret:api}}" } });
    return { status: res.status, text: res.text() };
  },
});
`,
  runner: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Runs gh pr checks on a pull request.",
  params: z.object({ pr: z.string() }),
  uses: { exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }] },
  async run(args, ctx) {
    const r = await ctx.exec("gh", ["pr", "checks", args.pr]);
    return { code: r.code, out: r.stdout };
  },
});
`,
  writer: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Copies note a into note b with a mark.",
  params: z.object({}),
  uses: { data: { write: ["notes"] } },
  async run(_args, ctx) {
    const a = await ctx.data.get("notes", "a");
    await ctx.data.put("notes", { id: "b", text: String(a?.text) + "!" });
    const all = await ctx.data.query("notes");
    return { seen: a?.text ?? null, total: all.total };
  },
});
`,
  reader: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Reads one file of the folder.",
  params: z.object({ path: z.string() }),
  uses: { files: "read" },
  async run(args, ctx) {
    return { text: await ctx.files.read(args.path) };
  },
});
`,
  inputs: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns what it got as inputs.",
  params: z.object({}),
  agent: "none",
  async run(_args, ctx) {
    return { inputs: ctx.inputs };
  },
});
`,
  big: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns a BigInt, which JSON can't carry.",
  params: z.object({}),
  agent: "none",
  async run() {
    return { n: 1n };
  },
});
`,
  thrower: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Throws a message that holds terminal control characters.",
  params: z.object({}),
  agent: "none",
  async run() {
    throw new Error("\\u001b[2J\\rX");
  },
});
`,
  bare: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Has no fixtures at all.",
  params: z.object({}),
  agent: "none",
  async run() {
    return null;
  },
});
`,
};

/** A harness in a temp folder with `tools` (names from TOOLS) and fixture files at `tools/<id>/fixtures/<file>`. */
function harness(tools: string[], fixtures: Record<string, unknown>): string {
  const dir = path.join(root, `h${++n}`);
  fs.mkdirSync(path.join(dir, "agent", "tasks"), { recursive: true });
  // As `init` links it: node_modules/@humanharness/cli → this package.
  fs.mkdirSync(path.join(dir, "node_modules", "@humanharness"), { recursive: true });
  fs.symlinkSync(path.join(CORE, "packages", "cli"), path.join(dir, "node_modules", "@humanharness", "cli"), "dir");
  fs.writeFileSync(path.join(dir, "agent", "AGENTS.md"), "# T\n\nYou try tools.\n");
  fs.writeFileSync(path.join(dir, "agent", "tasks", "look.md"), "# Task: look\n\nLook.\n");
  fs.writeFileSync(
    path.join(dir, "harness.config.ts"),
    `import { defineHarness, z } from "@humanharness/cli/sdk";
export default defineHarness({
  id: "tool-test",
  name: "Tool test",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tool test" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: true, web: true },
  blocks: {},
  actions: { look: { label: "Look", prompt: "./agent/tasks/look.md", cost: "light" } },
  path: ["look"],
  data: { notes: { scoped: false, key: "id", schema: z.object({ id: z.string(), text: z.string() }), agent: "read" } },
  tools: { ${tools.map((t) => `${t}: "./tools/${t}.ts"`).join(", ")} },
  secrets: [{ id: "api", label: "API key", help: "Any text: the tests never send it." }],
  author: "Human Harness tests",
});
`,
  );
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  for (const t of tools) fs.writeFileSync(path.join(dir, "tools", `${t}.ts`), TOOLS[t]!);
  for (const [rel, value] of Object.entries(fixtures)) {
    const file = path.join(dir, "tools", ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  return dir;
}

const run = (dir: string, o: { tool?: string; temp?: string } = {}) => {
  const out = memoryStream();
  return testTools(dir, { ...o, out: out.stream }).then((reports) => ({ reports, out: out.text() }));
};

describe("humanharness tool test (tools spec §11)", () => {
  it("runs each fixture of a tool and passes on an equal result", { timeout: 60_000 }, async () => {
    const { reports } = await run(MINI, { tool: "echo" });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.tool).toBe("echo");
    expect(reports[0]!.cases.map((c) => [c.file, c.ok])).toEqual([["basic.json", true]]);
    expect(formatToolReports(reports)).toContain("1 fixture passed.");
  });

  it("fails a fixture whose result differs, showing both", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"], { "echo/fixtures/off.json": { args: { a: 2 }, expect: { result: { a: 3 } } } });
    const { reports } = await run(dir);
    const c = reports[0]!.cases[0]!;
    expect(c.ok).toBe(false);
    expect(c.why).toBe('expected {"a":3} got {"a":2}');
    const text = formatToolReports(reports);
    expect(text).toContain("echo: 1 fixture, 1 failed");
    expect(text).toContain('  off.json: expected {"a":3} got {"a":2}');
    expect(text).toContain("1 of 1 fixtures failed.");
  });

  it("expect.error passes when the call fails with that text", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"], {
      "echo/fixtures/bad.json": { args: { a: "x" }, expect: { error: "a" } },
      "echo/fixtures/wrong.json": { args: { a: "x" }, expect: { error: "something else" } },
      "echo/fixtures/fine.json": { args: { a: 1 }, expect: { error: "a" } },
    });
    const { reports } = await run(dir);
    const byFile = Object.fromEntries(reports[0]!.cases.map((c) => [c.file, c]));
    expect(byFile["bad.json"]!.ok).toBe(true);
    expect(byFile["wrong.json"]!.ok).toBe(false);
    expect(byFile["wrong.json"]!.why).toMatch(/^expected an error with "something else" got ".+"$/);
    expect(byFile["fine.json"]!.ok).toBe(false);
    expect(byFile["fine.json"]!.why).toBe('expected an error with "a" got the result {"a":1}');
  });

  it("fetch and exec answer only from the fixture's exchanges; an unmatched one fails", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher", "runner"], {
      "fetcher/fixtures/none.json": { expect: { result: { status: 200, text: "x" } } },
      "runner/fixtures/ok.json": {
        args: { pr: "12" },
        exchanges: [{ kind: "exec", request: { cmd: "gh", args: ["pr", "checks", "12"] }, response: { code: 0, stdout: "green", stderr: "" } }],
        expect: { result: { code: 0, out: "green" } },
      },
      "runner/fixtures/other.json": {
        args: { pr: "13" },
        exchanges: [{ kind: "exec", request: { cmd: "gh", args: ["pr", "checks", "12"] }, response: { code: 0, stdout: "green", stderr: "" } }],
        expect: { result: { code: 0, out: "green" } },
      },
    });
    const { reports } = await run(dir);
    const fetcher = reports.find((r) => r.tool === "fetcher")!;
    expect(fetcher.cases[0]!.ok).toBe(false);
    expect(fetcher.cases[0]!.why).toContain("No fixture for GET https://api.example.test/x");
    const runner = Object.fromEntries(reports.find((r) => r.tool === "runner")!.cases.map((c) => [c.file, c]));
    expect(runner["ok.json"]!.ok).toBe(true);
    expect(runner["other.json"]!.ok).toBe(false);
    expect(runner["other.json"]!.why).toContain("No fixture for gh pr checks 13");
  });

  it("keys are fixture-<id>: the exchange matched with the key substituted, nothing real asked", { timeout: 60_000 }, async () => {
    // As `run --record` writes an exchange: the key in the header replaced by {{secret:api}}. Headers aren't compared.
    const dir = harness(["fetcher"], {
      "fetcher/fixtures/key.json": {
        exchanges: [
          {
            kind: "fetch",
            request: { method: "GET", url: "https://api.example.test/x", headers: { authorization: "Bearer {{secret:api}}" } },
            response: { status: 200, headers: {}, text: "keyed" },
          },
        ],
        expect: { result: { status: 200, text: "keyed" } },
      },
    });
    // No stdin, no key store: testTools takes neither, and the key handed out is fixture-api.
    const { reports, out } = await run(dir);
    const c = reports[0]!.cases[0]!;
    expect(c.ok).toBe(true);
    expect(c.trace[0]!.accesses).toEqual([{ kind: "fetch", target: "https://api.example.test/x", allowed: true }]);
    expect(JSON.stringify(reports) + out + formatToolReports(reports)).not.toContain("fixture-api");
  });

  it("data is seeded from the fixture and writes are reported, not saved", { timeout: 60_000 }, async () => {
    const dir = harness(["writer"], {
      "writer/fixtures/copy.json": { data: { notes: [{ id: "a", text: "hi" }] }, expect: { result: { seen: "hi", total: 2 } } },
    });
    const { reports } = await run(dir);
    const c = reports[0]!.cases[0]!;
    expect(c.ok).toBe(true);
    expect(c.writes).toEqual([{ collection: "notes", op: "put", key: "b" }]);
    expect(formatToolReports(reports)).toContain("  copy.json: ok, 1 write: put notes b");
    expect(fs.existsSync(path.join(dir, ".harness"))).toBe(false);
  });

  it("files are written to a temp folder that is removed after", { timeout: 60_000 }, async () => {
    const dir = harness(["reader"], {
      "reader/fixtures/read.json": { args: { path: "notes/a.md" }, files: { "notes/a.md": "# A\n" }, expect: { result: { text: "# A\n" } } },
    });
    const temp = path.join(root, `temp-${++n}`);
    fs.mkdirSync(temp);
    const { reports } = await run(dir, { temp });
    expect(reports[0]!.cases[0]!.ok).toBe(true);
    expect(fs.readdirSync(temp)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "notes"))).toBe(false);
  });

  it("inputs reach ctx.inputs", { timeout: 60_000 }, async () => {
    const dir = harness(["inputs"], {
      "inputs/fixtures/with.json": { inputs: { today: ["card"] }, expect: { result: { inputs: { today: ["card"] } } } },
      "inputs/fixtures/without.json": { expect: { result: { inputs: {} } } },
    });
    const { reports } = await run(dir);
    expect(reports[0]!.cases.map((c) => [c.file, c.ok])).toEqual([
      ["with.json", true],
      ["without.json", true],
    ]);
  });

  it("with no id, every tool with fixtures runs; a tool without fixtures is listed as such", { timeout: 60_000 }, async () => {
    const dir = harness(["bare", "echo"], { "echo/fixtures/basic.json": { args: { a: 1 }, expect: { result: { a: 1 } } } });
    const { reports } = await run(dir);
    expect(reports.map((r) => [r.tool, r.cases.length])).toEqual([
      ["bare", 0],
      ["echo", 1],
    ]);
    const text = formatToolReports(reports);
    expect(text).toContain("bare: no fixtures");
    expect(text).toContain("echo: 1 fixture, 0 failed");
    expect(text).toContain("1 fixture passed.");
  });

  it("an unknown id is a usage error naming the tools", async () => {
    const err = await run(MINI, { tool: "nope" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toBe('"nope" is not a tool of tools-mini: ai, echo, escape, fetcher, wait.');
  });

  it("prints the P12 note for tools once, before any tool runs", { timeout: 60_000 }, async () => {
    const m = memoryIo(MINI);
    expect(await toolCommand(["test", "echo"], m.io)).toBe(0);
    const out = m.out();
    expect(out.startsWith(`${TOOL_P12_NOTE}\n`)).toBe(true);
    expect(out.split(TOOL_P12_NOTE)).toHaveLength(2);
  });

  it("exit code 1 when any fixture fails", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"], {
      "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } },
      "echo/fixtures/off.json": { args: { a: 1 }, expect: { result: { a: 2 } } },
    });
    const m = memoryIo(dir);
    expect(await toolCommand(["test"], m.io)).toBe(1);
    expect(m.out()).toContain("1 of 2 fixtures failed.");
    const ok = memoryIo(MINI);
    expect(await toolCommand(["test"], ok.io)).toBe(0);
  });

  it("a fixture file that isn't a valid case is a warning line, and a build problem is a CliError", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"], { "echo/fixtures/junk.json": { nope: true } });
    const { reports } = await run(dir);
    expect(reports[0]!.cases).toEqual([]);
    expect(reports[0]!.skipped[0]).toMatch(/^tools\/echo\/fixtures\/junk\.json skipped/);
    expect(formatToolReports(reports)).toContain("  warn: tools/echo/fixtures/junk.json skipped");
    fs.writeFileSync(path.join(dir, "tools", "echo.ts"), 'import fs from "node:fs";\nexport default fs;\n');
    await expect(run(dir)).rejects.toBeInstanceOf(CliError);
  });

  it("no control characters reach the report: a tool's error, its trace line and a skipped file's warning", { timeout: 60_000 }, async () => {
    const dir = harness(["thrower"], { "thrower/fixtures/t.json": { expect: { result: {} } } });
    fs.writeFileSync(path.join(dir, "tools", "thrower", "fixtures", "junk.json"), "\u001b[2J\rnot json");
    const { reports } = await run(dir);
    expect(reports[0]!.cases.map((c) => c.ok)).toEqual([false]);
    expect(reports[0]!.skipped).toHaveLength(1);
    const text = formatToolReports(reports);
    expect(text).toContain("  call: thrower");
    expect(text).toContain("  warn: tools/thrower/fixtures/junk.json skipped");
    // Line breaks between lines are the report's own; nothing else under U+0020 or in U+007F–U+009F.
    expect(text.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    const m = memoryIo(dir);
    expect(await toolCommand(["test"], m.io)).toBe(1);
    expect(m.out().replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("says 'no valid fixtures' when every fixture file was skipped", { timeout: 60_000 }, async () => {
    const dir = harness(["echo", "bare"], { "echo/fixtures/junk.json": { nope: true } });
    const text = formatToolReports((await run(dir)).reports);
    expect(text).toContain("echo: no valid fixtures\n");
    expect(text).toContain("bare: no fixtures\n");
  });

  it("a result JSON can't carry fails its case, and the command goes on", { timeout: 60_000 }, async () => {
    const dir = harness(["big", "echo"], {
      "big/fixtures/n.json": { expect: { result: { n: 1 } } },
      "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } },
    });
    const { reports } = await run(dir);
    expect(reports.map((r) => r.cases.map((c) => c.ok))).toEqual([[false], [true]]);
    expect(reports[0]!.cases[0]!.why).toMatch(/^expected \{"n":1\} got a result that isn't JSON: \S/);
  });

  it("seeded data is checked against the collection's schema", { timeout: 60_000 }, async () => {
    const dir = harness(["writer"], {
      "writer/fixtures/bad.json": { data: { notes: [{ id: "a", text: 5 }] }, expect: { result: { seen: 5, total: 2 } } },
    });
    const { reports } = await run(dir);
    expect(reports[0]!.cases).toMatchObject([{ file: "bad.json", ok: false, trace: [] }]);
    expect(reports[0]!.cases[0]!.why).toMatch(/^Not a record of "notes": /);
  });

  it("the harness's own dist/ is never read: a stale one changes nothing and stays as it was", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"], { "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } } });
    const stale = "export default { run: async () => ({ a: 999 }) };\n";
    fs.mkdirSync(path.join(dir, "dist", "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "tools", "echo.js"), stale);
    fs.writeFileSync(path.join(dir, "dist", "tools.json"), "{ not json");
    const { reports } = await run(dir);
    expect(reports[0]!.cases).toMatchObject([{ file: "ok.json", ok: true }]);
    expect(fs.readFileSync(path.join(dir, "dist", "tools", "echo.js"), "utf8")).toBe(stale);
    expect(fs.readFileSync(path.join(dir, "dist", "tools.json"), "utf8")).toBe("{ not json");
    expect(fs.readdirSync(path.join(dir, "dist")).sort()).toEqual(["tools", "tools.json"]);
  });
});
