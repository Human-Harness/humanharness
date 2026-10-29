import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runMockTurn } from "../src/mock-claude";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-claude-tools-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const callsServer = fileURLToPath(new URL("./fixtures/calls-server.ts", import.meta.url));
const PROMPT = "# Topic: the checks\n\nWhat is failing?";

/** A mock folder with one recording whose first turn is `turn`, the state file's place and the calls' record file. */
function folder(turn: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(root, "m-"));
  const mock = path.join(dir, "mock");
  fs.mkdirSync(mock);
  fs.writeFileSync(path.join(mock, "checks.json"), JSON.stringify({ version: 1, action: "checks", match: "# Topic: the checks", turns: [{ id: "t1", ...turn }] }));
  return { mock, state: path.join(dir, "state", "mock.json"), record: path.join(dir, "calls.jsonl") };
}

/** A stub MCP server named `name` that records its calls in `record` (and refuses `refuse`). */
const server = (name: string, record: string, env: Record<string, string> = {}) => ({
  command: process.execPath,
  args: ["--import", import.meta.resolve("tsx"), callsServer],
  env: { HH_NAME: name, HH_RECORD: record, ...env },
});

const calls = (record: string): { server: string; tool: string; args: unknown }[] =>
  fs.existsSync(record)
    ? fs
        .readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { server: string; tool: string; args: unknown })
    : [];

/** Runs one mock turn; returns the exit code and the printed stream-json lines. */
async function turn(servers: Record<string, ReturnType<typeof server>>, env: { mock: string; state: string }, prompt = PROMPT) {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  let code: number;
  try {
    code = await runMockTurn(["--session-id", "s-1"], prompt, servers, { dir: env.mock, state: env.state });
  } finally {
    spy.mockRestore();
  }
  return { code, lines: out.join("").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) };
}

const BLOCK = { tool: "show_choices", input: { question: "Next?", options: [{ label: "Fix it" }] } };

describe("a recorded turn's tool calls in mock mode (tools spec §12, Decision 9)", () => {
  it("a turn's tools are called on the tools server in order, before its blocks", async () => {
    const env = folder({ text: "Two checks fail.", tools: [{ tool: "checks", args: { pr: 12 } }, { tool: "due-today", args: {} }], blocks: [BLOCK] });
    const { code, lines } = await turn({ ui: server("ui", env.record), tools: server("tools", env.record) }, env);
    expect(code).toBe(0);
    expect(calls(env.record)).toEqual([
      { server: "tools", tool: "checks", args: { pr: 12 } },
      { server: "tools", tool: "due-today", args: {} },
      { server: "ui", tool: "show_choices", args: BLOCK.input },
    ]);
    expect(lines.at(-1)).toMatchObject({ type: "result", subtype: "success", result: "Two checks fail." });
  }, 30_000);

  it("a tools call the server refuses fails the turn with its message", async () => {
    const env = folder({ text: "Two checks fail.", tools: [{ tool: "checks", args: {} }], blocks: [BLOCK] });
    const { code, lines } = await turn({ ui: server("ui", env.record), tools: server("tools", env.record, { HH_REFUSE: "checks" }) }, env);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatchObject({ type: "result", subtype: "error_during_execution", is_error: true, result: "mock: the tools server rejected checks: No such thing: checks" });
    // The turn stops there: no block, and the session doesn't move on.
    expect(calls(env.record).map((c) => c.server)).toEqual(["tools"]);
    expect(fs.existsSync(env.state)).toBe(false);
  }, 30_000);

  it("a turn with tools calls but no tools server fails the turn", async () => {
    const env = folder({ tools: [{ tool: "checks", args: {} }] });
    const { code, lines } = await turn({ ui: server("ui", env.record) }, env);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatchObject({ is_error: true, result: "mock: the app configured no tools MCP server" });
    expect(calls(env.record)).toEqual([]);
  }, 30_000);

  it("D0: a turn without tools calls nothing on the tools server", async () => {
    const env = folder({ text: "Hola.", blocks: [BLOCK] });
    const { code } = await turn({ ui: server("ui", env.record), tools: server("tools", env.record) }, env);
    expect(code).toBe(0);
    expect(calls(env.record)).toEqual([{ server: "ui", tool: "show_choices", args: BLOCK.input }]);
  }, 30_000);
});

describe("a recipe's AI step in mock mode (tools Decision 11)", () => {
  const STEP_UI = (record: string) => server("ui", record, { HH_STEP: "triage", HH_JOB: "" });
  const stepFile = (mock: string, body: unknown) => {
    fs.mkdirSync(path.join(mock, "steps"), { recursive: true });
    fs.writeFileSync(path.join(mock, "steps", "triage.json"), typeof body === "string" ? body : JSON.stringify(body));
  };
  const FIRST = "Sort these.\n\n## Data\n\n### open\n\n```json\n[]\n```\n\nEnd by calling step_output once with the whole result.";
  const AGAIN = "Sort these.\n\n## Data\n\n### open\n\n```json\n[]\n```\n\n### request\n\n```json\n{\"more\":true}\n```\n\nEnd by calling step_output once.";

  it("a step turn answers step_output with output from mock/steps/<job>.json", async () => {
    const env = folder({ text: "never played" });
    stepFile(env.mock, { version: 1, job: "triage", output: { picks: [1] }, request: { picks: [2] } });
    const { code, lines } = await turn({ ui: STEP_UI(env.record) }, env, FIRST);
    expect(code).toBe(0);
    expect(calls(env.record)).toEqual([{ server: "ui", tool: "step_output", args: { picks: [1] } }]);
    expect(lines.map((l) => l.type)).toEqual(["system", "result"]);
    expect(lines[1]).toMatchObject({ subtype: "success", is_error: false, session_id: "s-1" });
    // A step's turn never touches the session state.
    expect(fs.existsSync(env.state)).toBe(false);
  }, 30_000);

  it("a round whose prompt has ### request answers request", async () => {
    const env = folder({});
    stepFile(env.mock, { version: 1, job: "triage", output: { picks: [1] }, request: { picks: [2] } });
    await turn({ ui: STEP_UI(env.record) }, env, AGAIN);
    expect(calls(env.record)).toEqual([{ server: "ui", tool: "step_output", args: { picks: [2] } }]);
  }, 30_000);

  it("a request round without a recorded request answers output", async () => {
    const env = folder({});
    stepFile(env.mock, { version: 1, job: "triage", output: { picks: [1] } });
    await turn({ ui: STEP_UI(env.record) }, env, AGAIN);
    expect(calls(env.record)).toEqual([{ server: "ui", tool: "step_output", args: { picks: [1] } }]);
  }, 30_000);

  it("a step_output the ui server refuses fails the turn with its message", async () => {
    const env = folder({});
    stepFile(env.mock, { version: 1, job: "triage", output: { picks: [1] } });
    const { code, lines } = await turn({ ui: server("ui", env.record, { HH_STEP: "triage", HH_JOB: "", HH_REFUSE: "step_output" }) }, env, FIRST);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatchObject({ is_error: true, result: "mock: the ui server rejected step_output: No such thing: step_output" });
  }, 30_000);

  it("a bad step recording fails the turn with its problem, naming only steps/<job>.json", async () => {
    const env = folder({});
    stepFile(env.mock, "{ not json");
    const { code, lines } = await turn({ ui: STEP_UI(env.record) }, env, FIRST);
    expect(code).toBe(1);
    const last = lines.at(-1)!;
    expect(last).toMatchObject({ type: "result", is_error: true });
    expect(String(last.result)).toMatch(/^mock: steps\/triage\.json: /);
    expect(String(last.result)).not.toContain(root);
    expect(calls(env.record)).toEqual([]);
  }, 30_000);

  it("a step turn without a step recording plays nothing (slice 4)", async () => {
    const env = folder({ text: "never played" });
    const { code, lines } = await turn({ ui: STEP_UI(env.record) }, env, FIRST);
    expect(code).toBe(0);
    expect(calls(env.record)).toEqual([]);
    expect(lines.map((l) => l.type)).toEqual(["system", "result"]);
    expect(lines[1]).toMatchObject({ subtype: "success", result: "", usage: { input_tokens: 0, output_tokens: 0 } });
  }, 30_000);
});
