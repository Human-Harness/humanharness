import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCommand, checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { TOOL_P12_NOTE } from "../src/tool-host-node";
import { CORE, dropExampleTool, memoryIo, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-tool-fixtures-");
afterAll(cleanup);
let n = 0;

const ECHO = `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns its arguments.",
  params: z.object({ a: z.number() }),
  returns: z.object({ a: z.number() }),
  async run(args) {
    return { a: args.a };
  },
});
`;

const BIG = `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns a value JSON can't carry.",
  params: z.object({}),
  agent: "none",
  async run() {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    return cycle;
  },
});
`;

/**
 * A harness in a temp folder with the tool `echo` (and `big` when asked) and fixture files at `tools/<rel>` (an object is written as JSON, a
 * string as is). The harness has no HARNESS.md on purpose: its findings are the same before and after this task.
 */
function harness(fixtures: Record<string, unknown> = {}, o: { big?: boolean } = {}): string {
  const dir = path.join(root, `h${++n}`);
  fs.mkdirSync(path.join(dir, "agent", "tasks"), { recursive: true });
  // As `init` links it: node_modules/@humanharness/cli → this package.
  fs.mkdirSync(path.join(dir, "node_modules", "@humanharness"), { recursive: true });
  fs.symlinkSync(path.join(CORE, "packages", "cli"), path.join(dir, "node_modules", "@humanharness", "cli"), "dir");
  fs.writeFileSync(path.join(dir, "agent", "AGENTS.md"), "# T\n\nYou try tools.\n");
  fs.writeFileSync(path.join(dir, "agent", "tasks", "look.md"), "# Task: look\n\nLook.\n");
  fs.writeFileSync(
    path.join(dir, "harness.config.ts"),
    `import { defineHarness } from "@humanharness/cli/sdk";
export default defineHarness({
  id: "check-fixtures",
  name: "Check fixtures",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Check fixtures" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { look: { label: "Look", prompt: "./agent/tasks/look.md", cost: "light" } },
  path: ["look"],
  tools: { echo: "./tools/echo.ts"${o.big ? ', big: "./tools/big.ts"' : ""} },
  author: "Human Harness tests",
});
`,
  );
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tools", "echo.ts"), ECHO);
  if (o.big) fs.writeFileSync(path.join(dir, "tools", "big.ts"), BIG);
  for (const [rel, value] of Object.entries(fixtures)) {
    const file = path.join(dir, "tools", ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  return dir;
}

const check = async (dir: string, args: string[] = []) => {
  const m = memoryIo(dir);
  const code = await checkCommand(args, m.io);
  return { code, out: m.out(), err: m.err() };
};
const fixtureFindings = async (dir: string) => {
  const notes: string[] = [];
  const r = await checkHarness(dir, { fixtures: { note: (line) => notes.push(line) } });
  return { findings: r.findings.filter((f) => f.rule === "tool-fixture"), all: r.findings, notes };
};

/** `check`'s output for the echo harness without fixtures, recorded before this task (no HARNESS.md). */
const ECHO_BEFORE = `error   harness-md-missing   HARNESS.md            HARNESS.md is missing: create it with \`humanharness init\` or the /new-harness guide.
warning pillar-decisions     harness.config.ts     No brief or instruction asks for show_choices and the harness has no custom block: the person has nothing to decide with.

1 error, 1 warning
`;

describe("check runs tool fixtures (tools spec §11, Decision 4)", () => {
  it("D0: no tools, no fixture findings", { timeout: 60_000 }, async () => {
    const dir = path.join(root, `t${++n}`);
    await initHarness({ dir, core: CORE, install: false });
    // The template without its example tool (Task 12): a harness that declares no tools.
    dropExampleTool(dir);
    const { code, out, err } = await check(dir);
    // The template's check output, recorded before this task: byte for byte.
    expect(out).toBe("No problems found.\n");
    expect(err).toBe("");
    expect(code).toBe(0);
    const json = await check(dir, ["--json"]);
    expect(json.out).toBe("[]\n");
    expect(json.err).toBe("");
  });

  it("D0: tools without fixtures give the same output as before, and no note", { timeout: 60_000 }, async () => {
    const dir = harness();
    const { code, out, err } = await check(dir);
    expect(out).toBe(ECHO_BEFORE);
    expect(err).toBe("");
    expect(code).toBe(1);
    const { findings, notes } = await fixtureFindings(dir);
    expect(findings).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("a passing fixture adds nothing", { timeout: 60_000 }, async () => {
    const dir = harness({ "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } } });
    const { findings, all } = await fixtureFindings(dir);
    expect(findings).toEqual([]);
    expect(all.map((f) => f.rule)).toEqual(["harness-md-missing", "pillar-decisions"]);
    const { out } = await check(dir);
    expect(out).toBe(`${TOOL_P12_NOTE}\n${ECHO_BEFORE}`);
  });

  it("a failing fixture is a tool-fixture error naming the tool and the file", { timeout: 60_000 }, async () => {
    const dir = harness({
      "echo/fixtures/bad.json": { args: { a: 2 }, expect: { result: { a: 1 } } },
      "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } },
    });
    const { findings } = await fixtureFindings(dir);
    expect(findings).toEqual([
      { rule: "tool-fixture", severity: "error", message: 'Tool "echo": fixtures/bad.json: expected {"a":1} got {"a":2}', file: "tools/echo/fixtures/bad.json" },
    ]);
    const { code, out } = await check(dir);
    expect(code).toBe(1);
    const line = out.split("\n").find((l) => l.startsWith("error   tool-fixture"));
    expect(line).toContain("tools/echo/fixtures/bad.json");
    expect(line).toMatch(/Tool "echo": fixtures\/bad\.json: expected \{"a":1\} got \{"a":2\}$/);
  });

  it("a result JSON can't carry is a tool-fixture error, not a crashed check", { timeout: 60_000 }, async () => {
    const dir = harness({ "big/fixtures/cycle.json": { expect: { result: {} } } }, { big: true });
    const { findings } = await fixtureFindings(dir);
    expect(findings.map((f) => [f.rule, f.file])).toEqual([["tool-fixture", "tools/big/fixtures/cycle.json"]]);
    expect(findings[0]!.message).toMatch(/^Tool "big": fixtures\/cycle\.json: got a result that isn't JSON: /);
  });

  it("a fixture file that doesn't parse is a tool-fixture error", { timeout: 60_000 }, async () => {
    const dir = harness({ "echo/fixtures/broken.json": "{ not json", "echo/fixtures/shape.json": { args: { a: 1 } } });
    const { findings } = await fixtureFindings(dir);
    expect(findings.map((f) => [f.rule, f.severity, f.file])).toEqual([
      ["tool-fixture", "error", "tools/echo/fixtures/broken.json"],
      ["tool-fixture", "error", "tools/echo/fixtures/shape.json"],
    ]);
    expect(findings[0]!.message).toMatch(/^Tool "echo": fixtures\/broken\.json: \S/);
    // A schema refusal names what is wrong, not the first line of zod's JSON ("[").
    expect(findings[1]!.message).toMatch(/^Tool "echo": fixtures\/shape\.json: expect: /);
  });

  it("a harness whose tools don't build reports only the build problem", { timeout: 60_000 }, async () => {
    const dir = harness({ "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 2 } } } });
    fs.writeFileSync(path.join(dir, "tools", "echo.ts"), 'import fs from "node:fs";\nexport default fs;\n');
    const { findings, all, notes } = await fixtureFindings(dir);
    expect(findings).toEqual([]);
    expect(all.some((f) => f.rule === "tool-build")).toBe(true);
    expect(notes).toEqual([]);
  });

  it("check prints the P12 note for tools only when it runs a fixture", { timeout: 60_000 }, async () => {
    const dir = harness({ "echo/fixtures/ok.json": { args: { a: 1 }, expect: { result: { a: 1 } } } });
    const plain = await check(dir);
    expect(plain.out.split(TOOL_P12_NOTE)).toHaveLength(2);
    expect(plain.out.startsWith(`${TOOL_P12_NOTE}\n`)).toBe(true);
    expect(plain.err).toBe("");
    // With --json the note goes to stderr, so stdout stays one JSON document.
    const json = await check(dir, ["--json"]);
    expect(json.err).toBe(`${TOOL_P12_NOTE}\n`);
    expect(JSON.parse(json.out).map((f: { rule: string }) => f.rule)).toEqual(["harness-md-missing", "pillar-decisions"]);
    // Only invalid fixture files: nothing runs, no note.
    const invalid = harness({ "echo/fixtures/shape.json": { args: { a: 1 } } });
    const none = await check(invalid);
    expect(none.out).not.toContain(TOOL_P12_NOTE);
    expect(none.err).toBe("");
  });

  it("only check runs fixtures: checkHarness without `fixtures` (dev's call) runs none", { timeout: 60_000 }, async () => {
    const dir = harness({ "echo/fixtures/bad.json": { args: { a: 2 }, expect: { result: { a: 1 } } } });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "tool-fixture")).toEqual([]);
  });
});
