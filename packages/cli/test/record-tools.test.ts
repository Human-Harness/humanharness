import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, recordingSchema, writeScript } from "@humanharness/fake-agent";
import { parseFixture } from "@humanharness/harness-sdk/plugin-fixtures";
import type { runFile } from "@humanharness/shell/plugins";
import { readToolRecordings, recordedToolTransport } from "@humanharness/shell/tools";
import { Recorder } from "../src/record";
import { runTask } from "../src/run";
import type { ToolRunDeps } from "../src/tool-run";
import { CORE, memoryStream, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-record-tools-");
afterAll(cleanup);
let n = 0;

const KEY = "k-123-typed-in-the-test-0123456789";
const URL_X = "https://api.example.test/x";
const URL_PRE = "https://api.example.test/pre";

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

const TOOLS: Record<string, string> = {
  echo: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns its arguments as they came.",
  params: z.object({ a: z.number() }),
  agent: "call",
  uses: {},
  async run(args) {
    return { a: args.a };
  },
});
`,
  fetcher: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Fetches the example service with the API key.",
  params: z.object({}),
  agent: "call",
  uses: { hosts: ["api.example.test"], secrets: ["api"] },
  async run(_args, ctx) {
    const res = await ctx.fetch("${URL_X}", { headers: { authorization: "Bearer {{secret:api}}" } });
    return { status: res.status, text: res.text() };
  },
});
`,
  lister: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Lists a pull request's checks with gh.",
  params: z.object({ pr: z.string() }),
  agent: "call",
  uses: { exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }] },
  async run(args, ctx) {
    const out = await ctx.exec("gh", ["pr", "checks", args.pr]);
    return { code: out.code, stdout: out.stdout };
  },
});
`,
  prep: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Fetches what a task starts from.",
  params: z.object({}),
  agent: "none",
  uses: { hosts: ["api.example.test"] },
  async run(_args, ctx) {
    const res = await ctx.fetch("${URL_PRE}");
    return { text: res.text() };
  },
});
`,
};

/** A harness in a temp folder (its mock/ is written by the run); `tools: null` declares none (D0). */
function harness(tools: string[] | null): string {
  const dir = path.join(root, `h${++n}`);
  fs.mkdirSync(path.join(dir, "agent", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "@humanharness"), { recursive: true });
  fs.symlinkSync(path.join(CORE, "packages", "cli"), path.join(dir, "node_modules", "@humanharness", "cli"), "dir");
  fs.writeFileSync(path.join(dir, "agent", "AGENTS.md"), "# T\n\nYou try tools.\n");
  fs.writeFileSync(path.join(dir, "agent", "tasks", "look.md"), "# Task: look\n\nLook.\n");
  fs.writeFileSync(path.join(dir, "agent", "tasks", "study.md"), "# Task: study\n\nStudy.\n");
  const withTools = tools
    ? `  tools: { ${tools.map((t) => `${t}: "./tools/${t}.ts"`).join(", ")} },
  secrets: [{ id: "api", label: "API key", help: "Any text: the tests never send it." }],
`
    : "";
  const pre = tools?.includes("prep") ? `, pre: [{ tool: "prep" }]` : "";
  fs.writeFileSync(
    path.join(dir, "harness.config.ts"),
    `import { defineHarness } from "@humanharness/cli/sdk";
export default defineHarness({
  id: "record-tools",
  name: "Record tools",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Record tools" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: true, web: true },
  blocks: {},
  actions: {
    look: { label: "Look", prompt: "./agent/tasks/look.md", cost: "light" },
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light"${pre} },
  },
  path: ["look"],
${withTools}  author: "Human Harness tests",
});
`,
  );
  if (tools) {
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    for (const t of tools) fs.writeFileSync(path.join(dir, "tools", `${t}.ts`), TOOLS[t]!);
  }
  return dir;
}

interface Answer {
  status?: number;
  headers?: Record<string, string>;
  text: string;
}

/** Deps that reach nothing: fetch and commands answer from `table` (by URL, by `<cmd> <args>`), the key is KEY. */
function tableDeps(table: Record<string, Answer | { code: number; stdout: string; stderr: string }>) {
  const reached: string[] = [];
  const deps: ToolRunDeps = {
    transport: {
      fetch: (async (input: string) => {
        reached.push(String(input));
        const a = Object.hasOwn(table, String(input)) ? (table[String(input)] as Answer) : undefined;
        if (!a) throw new Error(`no answer for ${String(input)}`);
        return new Response(a.text, { status: a.status ?? 200, headers: a.headers ?? {} });
      }) as unknown as typeof fetch,
      run: (async (file: string, args: string[]) => {
        const k = `${path.basename(file)} ${args.join(" ")}`;
        reached.push(k);
        if (!Object.hasOwn(table, k)) throw new Error(`no answer for ${k}`);
        return table[k];
      }) as unknown as typeof runFile,
    },
    readSecret: async () => KEY,
    allowHost: async () => true,
    resolve: async (cmd) => `/usr/bin/${cmd}`,
    isTTY: true,
  };
  return { deps, reached };
}

/** Records `action` of `dir` to its close with `script`; returns what it printed. */
async function record(dir: string, action: string, script: ClaudeScript, deps: ToolRunDeps = tableDeps({}).deps) {
  const out = memoryStream();
  const id = ++n;
  const input = new PassThrough();
  input.end("q\n");
  await runTask({
    harnessDir: dir,
    action,
    engine: "claude",
    folder: path.join(root, `work-${id}`),
    input,
    output: out.stream,
    record: true,
    engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    toolDeps: deps,
  });
  return out.text();
}

const turnScript = (action: string, steps: ClaudeScript["steps"]): ClaudeScript => ({
  steps: [...claudeTextLines("Done."), result],
  turns: [saveNote, { match: `# Task: ${action}`, steps: [...steps, ...claudeTextLines("Looked."), result] }],
});

const recordingOf = (dir: string, action: string) => recordingSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "mock", `${action}.json`), "utf8")));
const toolFile = (dir: string, tool: string, name: string) => path.join(dir, "mock", "tools", tool, name);
const filesOf = (dir: string, tool: string) => {
  const d = path.join(dir, "mock", "tools", tool);
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
};

const okX = { [URL_X]: { status: 200, headers: { "content-type": "text/plain", "set-cookie": "s=1" }, text: "hello" } };
const callFetcher = turnScript("look", [{ mcp: { server: "tools", tool: "fetcher", args: {} } }]);

/** The recording of `look` in the no-tools harness below, as `--record` wrote it before tools reached it (c7e2183). */
const D0_RECORDING = `${JSON.stringify(
  {
    version: 1,
    action: "look",
    match: "# Task: look",
    recordedWith: "claude",
    turns: [
      { id: "t1", text: "Looked.", blocks: [], writes: [], usage: { input: 1200, output: 80, cacheRead: 0, cacheWrite: 0 } },
      { id: "close", text: "", blocks: [], writes: [], note: { title: "x", summary: ["x"], decisions: [], files: [], open: [] } },
    ],
  },
  null,
  2,
)}\n`;

describe("run --record with tools (tools spec §12, A3)", () => {
  it("D0: a recording of a harness without tools has no tools key and no mock/tools", { timeout: 60_000 }, async () => {
    const dir = harness(null);
    const text = await record(dir, "look", turnScript("look", []));
    expect(fs.existsSync(path.join(dir, "mock", "tools"))).toBe(false);
    const raw = fs.readFileSync(path.join(dir, "mock", "look.json"), "utf8");
    expect(raw).not.toContain('"tools"');
    expect(raw).toBe(D0_RECORDING);
    expect(text).not.toContain("Tool replies");
  });

  it("a turn's agent tool calls are recorded in order under tools", { timeout: 60_000 }, async () => {
    const dir = harness(["echo", "fetcher"]);
    const script = turnScript("look", [
      { mcp: { server: "tools", tool: "echo", args: { a: 2 } } },
      { mcp: { server: "tools", tool: "echo", args: { a: 3 } } },
    ]);
    await record(dir, "look", script);
    const rec = recordingOf(dir, "look");
    expect(rec.turns[0]!.tools).toEqual([
      { tool: "echo", args: { a: 2 } },
      { tool: "echo", args: { a: 3 } },
    ]);
    // The closing turn made no call: no key (as a recording without tools).
    expect(rec.turns.find((t) => t.id === "close")).not.toHaveProperty("tools");
    // echo reached nothing: no replies to record.
    expect(fs.existsSync(path.join(dir, "mock", "tools"))).toBe(false);
  });

  it("pre-step calls are not recorded, their replies are", { timeout: 60_000 }, async () => {
    const dir = harness(["echo", "prep"]);
    const { deps } = tableDeps({ [URL_PRE]: { text: "ready" } });
    await record(dir, "study", turnScript("study", []), deps);
    const rec = recordingOf(dir, "study");
    for (const t of rec.turns) expect(t).not.toHaveProperty("tools");
    // dev --mock runs pre-steps for real: their fetches answer from the recording.
    expect(filesOf(dir, "prep")).toEqual(["001.json"]);
  });

  it("each fetch and exec with its reply is written to mock/tools/<tool>/NNN.json in the plugin fixture format", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher", "lister"]);
    const { deps } = tableDeps({ ...okX, "gh pr checks 12": { code: 0, stdout: "build pass\n", stderr: "" } });
    const script = turnScript("look", [
      { mcp: { server: "tools", tool: "fetcher", args: {} } },
      { mcp: { server: "tools", tool: "lister", args: { pr: "12" } } },
    ]);
    const text = await record(dir, "look", script, deps);
    expect(filesOf(dir, "fetcher")).toEqual(["001.json"]);
    expect(filesOf(dir, "lister")).toEqual(["001.json"]);
    const fetched = parseFixture(JSON.parse(fs.readFileSync(toolFile(dir, "fetcher", "001.json"), "utf8")));
    expect(fetched).toEqual({
      kind: "fetch",
      request: { method: "GET", url: URL_X, headers: { authorization: "Bearer {{secret:api}}" } },
      // A session cookie is a credential: never written.
      response: { status: 200, headers: { "content-type": "text/plain" }, text: "hello" },
    });
    const ran = parseFixture(JSON.parse(fs.readFileSync(toolFile(dir, "lister", "001.json"), "utf8")));
    expect(ran).toEqual({ kind: "exec", request: { cmd: "gh", args: ["pr", "checks", "12"] }, response: { code: 0, stdout: "build pass\n", stderr: "" } });
    expect(text).toContain("Recorded: mock/tools/fetcher/001.json\n");
    expect(text).toContain("Recorded: mock/tools/lister/001.json\n");
    expect(text).toContain("Tool replies were recorded in mock/tools/: review them before committing them.\n");
  });

  it("what --record writes, mock mode reads and plays back", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher", "lister"]);
    const { deps } = tableDeps({ ...okX, "gh pr checks 12": { code: 0, stdout: "build pass\n", stderr: "" } });
    const script = turnScript("look", [
      { mcp: { server: "tools", tool: "fetcher", args: {} } },
      { mcp: { server: "tools", tool: "lister", args: { pr: "12" } } },
    ]);
    await record(dir, "look", script, deps);
    const skipped: string[] = [];
    const log = (m: string) => skipped.push(m);
    const fetches = await readToolRecordings(path.join(dir, "mock", "tools"), "fetcher", log);
    const execs = await readToolRecordings(path.join(dir, "mock", "tools"), "lister", log);
    expect(skipped).toEqual([]);
    expect(fetches).toHaveLength(1);
    expect(execs).toHaveLength(1);
    const res = await recordedToolTransport(fetches).fetch(URL_X, { headers: { authorization: "Bearer fixture-api" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    const out = await recordedToolTransport(execs).run("/fixture/gh", ["pr", "checks", "12"], { cwd: root, env: {}, timeoutMs: 1000, maxBytes: 1000 } as never);
    expect(out).toMatchObject({ code: 0, stdout: "build pass\n" });
  });

  it("keys are replaced by {{secret:<id>}} in every written exchange", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    // The service echoes the key in its reply, raw, URL-encoded and in a header.
    const { deps } = tableDeps({ [URL_X]: { headers: { "x-echo": KEY }, text: `you sent ${KEY} and ${encodeURIComponent(KEY)}` } });
    const text = await record(dir, "look", callFetcher, deps);
    const raw = fs.readFileSync(toolFile(dir, "fetcher", "001.json"), "utf8");
    expect(raw).toContain("Bearer {{secret:api}}");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(KEY.slice(4));
    expect(parseFixture(JSON.parse(raw))).toMatchObject({ response: { headers: { "x-echo": "{{secret:api}}" } } });
    expect(text).not.toContain(KEY);
  });

  it("a key that still shows aborts the write and names the file", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    // base64 at an offset the substring pass can't see: the key still shows when decoded.
    const { deps } = tableDeps({ [URL_X]: { text: Buffer.from(`x${KEY}`).toString("base64") } });
    const text = await record(dir, "look", callFetcher, deps);
    expect(text).toContain("Not recorded: mock/tools/fetcher/001.json holds a key\n");
    expect(filesOf(dir, "fetcher")).toEqual([]);
    expect(text).not.toContain("Tool replies were recorded");
    // The call itself is still recorded on its turn.
    expect(recordingOf(dir, "look").turns[0]!.tools).toEqual([{ tool: "fetcher", args: {} }]);
  });

  it("numbers continue after the highest existing file and never overwrite one", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    const old = `${JSON.stringify({ kind: "fetch", request: { method: "GET", url: URL_X }, response: { status: 200, headers: {}, text: "old" } }, null, 2)}\n`;
    fs.mkdirSync(path.join(dir, "mock", "tools", "fetcher"), { recursive: true });
    fs.writeFileSync(toolFile(dir, "fetcher", "001.json"), old);
    fs.writeFileSync(toolFile(dir, "fetcher", "007.json"), old);
    await record(dir, "look", callFetcher, tableDeps(okX).deps);
    expect(filesOf(dir, "fetcher")).toEqual(["001.json", "007.json", "008.json"]);
    expect(fs.readFileSync(toolFile(dir, "fetcher", "001.json"), "utf8")).toBe(old);
    expect(fs.readFileSync(toolFile(dir, "fetcher", "007.json"), "utf8")).toBe(old);
    expect(parseFixture(JSON.parse(fs.readFileSync(toolFile(dir, "fetcher", "008.json"), "utf8")))).toMatchObject({ response: { text: "hello" } });
  });

  it("a linked tool folder is never written through", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    const elsewhere = path.join(root, `elsewhere-${++n}`);
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(path.join(dir, "mock", "tools"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(dir, "mock", "tools", "fetcher"), "dir");
    const text = await record(dir, "look", callFetcher, tableDeps(okX).deps);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(text).toContain("Not recorded: mock/tools/fetcher/ is not a folder\n");
  });

  it("a linked mock/tools is never written through", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    const elsewhere = path.join(root, `elsewhere-${++n}`);
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.mkdirSync(path.join(dir, "mock"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(dir, "mock", "tools"), "dir");
    const text = await record(dir, "look", callFetcher, tableDeps(okX).deps);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(text).toContain("Not recorded: mock/tools/ is not a folder\n");
  });
});

describe("Recorder.toolCall (tools Decision 9)", () => {
  const recorder = (warnings: string[]) => {
    const folder = path.join(root, `calls-${++n}`);
    fs.mkdirSync(folder, { recursive: true });
    return new Recorder({ folder, toolFor: (b) => `show_${b}`, matchFor: (a) => `# Task: ${a}`, recordedWith: "claude", warn: (m) => warnings.push(m) });
  };

  it("keeps at most 20 calls a turn and warns once", async () => {
    const warnings: string[] = [];
    const r = recorder(warnings);
    await r.begin();
    for (let i = 0; i < 25; i++) r.toolCall("echo", { a: i });
    await r.turnEnded({ action: "look", phase: "run" });
    r.toolCall("echo", { a: 99 });
    await r.turnEnded({ action: "look", phase: "run" });
    const [rec] = r.recordings();
    expect(recordingSchema.parse(rec)).toEqual(rec);
    expect(rec!.turns[0]!.tools).toHaveLength(20);
    expect(rec!.turns[0]!.tools![19]).toEqual({ tool: "echo", args: { a: 19 } });
    expect(rec!.turns[1]!.tools).toEqual([{ tool: "echo", args: { a: 99 } }]);
    expect(warnings).toEqual(["a turn made more than 20 tool calls: only the first 20 are recorded."]);
  });

  it("a failed attempt's calls are dropped with it", async () => {
    const r = recorder([]);
    await r.begin();
    r.toolCall("echo", { a: 1 });
    await r.turnEnded({ action: "look", phase: "run" }, { failed: true });
    await r.turnEnded({ action: "look", phase: "run" });
    expect(r.recordings()[0]!.turns[0]).not.toHaveProperty("tools");
  });

  it("a call the recording format can't hold is left out with a note", async () => {
    const warnings: string[] = [];
    const r = recorder(warnings);
    await r.begin();
    r.toolCall("echo", JSON.parse('{"__proto__":{"x":1},"a":1}') as Record<string, unknown>);
    r.toolCall("../x", {});
    await r.turnEnded({ action: "look", phase: "run" });
    const [rec] = r.recordings();
    expect(rec!.turns[0]).not.toHaveProperty("tools");
    expect(recordingSchema.parse(rec)).toEqual(rec);
    expect(warnings).toHaveLength(2);
  });
});
