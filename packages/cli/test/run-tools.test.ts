import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { CliError } from "../src/cli";
import { initHarness } from "../src/init";
import { runTask } from "../src/run";
import { TOOL_P12_NOTE } from "../src/tool-host-node";
import { recordedArgs } from "../src/run-tools";
import type { ToolRunDeps } from "../src/tool-run";
import { CORE, dropExampleTool, memoryStream, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-run-tools-");
afterAll(cleanup);
let n = 0;

const MINI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/tools-mini");
const KEY = "key-typed-in-the-test-0123456789";

const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
};
const saveNote = { match: "save_note", steps: [{ mcp: { server: "ui", tool: "save_note", args: { title: "x", summary: ["x"], decisions: [], files: [], open: [] } } }, result] };

/** Tools deps that reach nothing: every fetch and command fails, and what was asked is kept. */
function fakeDeps(o: { isTTY?: boolean } = {}) {
  const asked: string[] = [];
  let reached = 0;
  const deps: ToolRunDeps = {
    transport: {
      fetch: (async () => {
        reached++;
        throw new Error("no network in tests");
      }) as unknown as typeof fetch,
      run: (async () => {
        reached++;
        throw new Error("no commands in tests");
      }) as unknown as ToolRunDeps["transport"]["run"],
    },
    readSecret: async (label) => {
      asked.push(label);
      return KEY;
    },
    allowHost: async () => true,
    resolve: async () => null,
    isTTY: o.isTTY ?? true,
  };
  return { deps, asked, reached: () => reached };
}

/** Runs `action` of `harnessDir` to its close with `script`; returns what it printed, the prompts and the engine's argv. */
async function run(harnessDir: string, action: string, script: ClaudeScript, deps = fakeDeps()) {
  const out = memoryStream();
  const id = ++n;
  const prompts = path.join(root, `prompts-${id}.jsonl`);
  const folder = path.join(root, `work-${id}`);
  const input = new PassThrough();
  input.end("q\n");
  await runTask({
    harnessDir,
    action,
    engine: "claude",
    folder,
    input,
    output: out.stream,
    engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_PROMPTS: prompts } },
    toolDeps: deps.deps,
  });
  const sent = fs
    .readFileSync(prompts, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { prompt: string; argv: string[] });
  return { text: out.text(), first: sent[0]!.prompt, argv: sent[0]!.argv, folder };
}

/** The MCP servers the engine was given, by name. */
const serversOf = (argv: string[]) => Object.keys((JSON.parse(argv[argv.indexOf("--mcp-config") + 1]!) as { mcpServers: Record<string, unknown> }).mcpServers);

const studyScript: ClaudeScript = {
  steps: [...claudeTextLines("Done."), result],
  turns: [saveNote, { match: "# Task: study", steps: [...claudeTextLines("Studied."), result] }],
};

describe("tools in a terminal run (tools spec §6, §12)", () => {
  it("D0: a harness without tools starts no tool host", { timeout: 60_000 }, async () => {
    const dir = path.join(root, "notes");
    await initHarness({ dir, core: CORE, install: false });
    // The template without its example tool (Task 12): a harness that declares no tools.
    dropExampleTool(dir);
    const fake = fakeDeps();
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [saveNote, { match: "# Task: example", steps: [...claudeTextLines("First turn here."), result] }],
    };
    const { text, argv, folder } = await run(dir, "example", script, fake);
    expect(text).not.toContain(TOOL_P12_NOTE);
    expect(serversOf(argv)).not.toContain("tools");
    expect(fake.asked).toEqual([]);
    expect(fs.existsSync(path.join(folder, ".harness", "trace"))).toBe(false);
    // Output as before (recorded at 5a2748c, before tools reached `run`): the folder and the report's time vary.
    const shown = text.replaceAll(folder, "<folder>").replace(/\d+(\.\d+)? s\b/g, "<s>");
    expect(shown).toBe(D0_OUTPUT);
  });

  it("runs the pre-steps and puts ## Prepared data in the first message", { timeout: 60_000 }, async () => {
    const { first } = await run(MINI, "study", studyScript);
    expect(first).toContain("## Prepared data");
    expect(first).toContain("### one · echo");
    expect(first).toContain('```json\n{"a":1}\n```');
  });

  it("a required pre-step that fails stops the run with its message", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const prompts = path.join(root, `prompts-stuck-${++n}.jsonl`);
    const input = new PassThrough();
    input.end("q\n");
    const err = await runTask({
      harnessDir: MINI,
      action: "stuck",
      engine: "claude",
      folder: path.join(root, `work-stuck-${n}`),
      input,
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, studyScript), HH_FAKE_PROMPTS: prompts } },
      toolDeps: fakeDeps().deps,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toMatch(/^Couldn't prepare this task: wait failed: .+/);
    // The task never started: the engine got no message.
    expect(fs.existsSync(prompts)).toBe(false);
  });

  it("serves the tools MCP server: the agent's call runs and prints one line", { timeout: 60_000 }, async () => {
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [saveNote, { match: "# Task: look", steps: [{ mcp: { server: "tools", tool: "echo", args: { a: 2 } } }, ...claudeTextLines("Echoed."), result] }],
    };
    const { text, argv, folder } = await run(MINI, "look", script);
    expect(serversOf(argv)).toContain("tools");
    expect(text).toMatch(/^tool echo · \d+ ms · ok$/m);
    expect(text.match(/^tool echo/gm)).toHaveLength(1);
    // Traced as the app does: the agent's call under the task.
    const trace = fs.readdirSync(path.join(folder, ".harness", "trace")).filter((f) => f.endsWith(".jsonl"));
    expect(trace).toHaveLength(1);
    const entry = JSON.parse(fs.readFileSync(path.join(folder, ".harness", "trace", trace[0]!), "utf8").trim()) as Record<string, unknown>;
    expect(entry).toMatchObject({ tool: "echo", caller: "agent", ok: true, result: { a: 2 } });
  });

  it("writes the pre usage row and the trace as the app does", { timeout: 60_000 }, async () => {
    const { text, folder } = await run(MINI, "study", studyScript);
    const rows = fs
      .readFileSync(path.join(folder, ".harness", "usage.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const pre = rows.filter((r) => r.kind === "pre");
    expect(pre).toHaveLength(1);
    expect(pre[0]).toMatchObject({ engine: "claude", action: "study", steps: 1, ok: true });
    expect(pre[0]!.preparedTokens).toBeGreaterThan(0);
    const task = pre[0]!.task as string;
    const lines = fs.readFileSync(path.join(folder, ".harness", "trace", `${task}.jsonl`), "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]!)).toMatchObject({ tool: "echo", caller: "pre", task, ok: true, result: { a: 1 } });
    expect(text).toMatch(/^tool echo · \d+ ms · ok$/m);
  });

  it("prints the P12 note for tools once", { timeout: 60_000 }, async () => {
    const fake = fakeDeps();
    const { text } = await run(MINI, "study", studyScript, fake);
    expect(text.split(TOOL_P12_NOTE)).toHaveLength(2);
    expect(text.indexOf(TOOL_P12_NOTE)).toBeLessThan(text.indexOf("Folder:"));
    // fetcher (agent: call) declares the API key: asked once, hidden, never printed.
    expect(fake.asked).toEqual(["API key (Any text: the tests never send it anywhere.): "]);
    expect(text).not.toContain(KEY);
    expect(fake.reached()).toBe(0);
  });

  it("keys are asked only in a terminal", { timeout: 60_000 }, async () => {
    const err = await run(MINI, "study", studyScript, fakeDeps({ isTTY: false })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toBe("run asks for the tools' keys in a terminal");
  });

  it("a refused start's message is one plain line with the keys hidden", { timeout: 60_000 }, async () => {
    const dir = path.join(root, `loud-${++n}`);
    await initHarness({ dir, core: CORE, install: false });
    // The template's example tool out first: the test's own `tools:` is then the manifest's only one (end follow-up M26).
    dropExampleTool(dir);
    replaceIn(dir, "harness.config.ts", "web: false", "web: true");
    replaceIn(
      dir,
      "harness.config.ts",
      "  actions: {\n",
      '  tools: { loud: "./tools/loud.ts", keyed: "./tools/keyed.ts" },\n  secrets: [{ id: "api", label: "API key", help: "Any text." }],\n  actions: {\n',
    );
    replaceIn(dir, "harness.config.ts", '      tier: "standard",\n', '      tier: "standard",\n      pre: [{ tool: "loud", required: true }],\n');
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    // loud declares no key, so the registry hides none: only the run's own hiding keeps the typed key out.
    fs.writeFileSync(
      path.join(dir, "tools", "loud.ts"),
      `import { defineTool, z } from "@humanharness/cli/tool";\n\nexport default defineTool({\n  description: "Fails loudly with terminal escapes in its error.",\n  params: z.object({}),\n  agent: "none",\n  uses: {},\n  async run() {\n    throw new Error("\\u001b[2Jbad \\r\\nfake · 1 ms · ok \\u009b ${KEY}");\n  },\n});\n`,
    );
    fs.writeFileSync(
      path.join(dir, "tools", "keyed.ts"),
      `import { defineTool, z } from "@humanharness/cli/tool";\n\nexport default defineTool({\n  description: "Reads the example service with the API key.",\n  params: z.object({}),\n  agent: "call",\n  uses: { hosts: ["api.example.test"], secrets: ["api"] },\n  async run() {\n    return null;\n  },\n});\n`,
    );
    const fake = fakeDeps();
    const err = await run(dir, "example", studyScript, fake).catch((e: unknown) => e);
    expect(fake.asked).toHaveLength(1);
    expect(err).toBeInstanceOf(CliError);
    const message = (err as Error).message;
    expect(message).toMatch(/^Couldn't prepare this task: loud failed: /);
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(message).not.toContain(KEY);
  });

  it("a build problem stops the run before the engine starts", { timeout: 60_000 }, async () => {
    const dir = path.join(root, `broken-${++n}`);
    await initHarness({ dir, core: CORE, install: false });
    dropExampleTool(dir);
    replaceIn(dir, "harness.config.ts", "  actions: {\n", '  tools: { broken: "./tools/broken.ts" },\n  actions: {\n');
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "broken.ts"), 'import { nothing } from "./missing";\nexport default nothing;\n');
    const out = memoryStream();
    const prompts = path.join(root, `prompts-broken-${n}.jsonl`);
    const folder = path.join(root, `work-broken-${n}`);
    const input = new PassThrough();
    input.end("q\n");
    const err = await runTask({
      harnessDir: dir,
      action: "example",
      engine: "claude",
      folder,
      input,
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, studyScript), HH_FAKE_PROMPTS: prompts } },
      toolDeps: fakeDeps().deps,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain("broken");
    expect(fs.existsSync(prompts)).toBe(false);
    expect(fs.existsSync(folder)).toBe(false);
    expect(out.text()).not.toContain("Folder:");
  });
});

const D0_OUTPUT =
  "Folder: <folder>\nFirst turn here.\n\nType a follow-up, or q to close the task: \nNote: <folder>/.harness/notes/example.md\n\nReport\n  tier          standard\n  model         sonnet\n  effort        medium\n  cap           200,000 tokens\n\n  phase        turns     input    output  cache read  cache write\n  run              1     1,200        80           0            0\n  close            1     1,200        80           0            0\n\n  peak context  1,200 of 200,000 (1%)\n  verdict       used about 2,560 tokens (input+output, uncached), plus 0 cache read and 0 cache write; cost hint says light\n  usage log     <folder>/.harness/usage.jsonl\n  note          <folder>/.harness/notes/example.md\n";

describe("run --record keeps an agent call's args only when replay can send the same (end follow-up M23)", () => {
  it("an object as is, none as {}", () => {
    expect(recordedArgs({ a: 1 })).toEqual({ a: 1 });
    expect(recordedArgs(undefined)).toEqual({});
  });

  it("anything else is left out", () => {
    for (const bad of [null, 5, "x", [1], true]) expect(recordedArgs(bad), JSON.stringify(bad)).toBeNull();
  });
});
