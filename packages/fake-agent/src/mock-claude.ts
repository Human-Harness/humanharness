// packages/fake-agent/src/mock-claude.ts
// fake-claude's mock mode (spec 3e): replays <harness>/mock/*.json instead of a test script.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import { loadRecordings } from "./mock";
import { type SessionPosition, replay } from "./mock-replay";

type McpServers = Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;

function readState(file: string): Record<string, SessionPosition> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { sessions?: Record<string, SessionPosition> };
    return parsed.sessions ?? {};
  } catch {
    return {};
  }
}

const flag = (argv: string[], name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const print = (line: unknown) => process.stdout.write(JSON.stringify(line) + "\n");

/** One engine turn in mock mode: prints Claude's stream-json, calls the ui tools and writes the files. */
export async function runMockTurn(argv: string[], prompt: string, mcpServers: McpServers, env: { dir: string; state: string }): Promise<void> {
  const resumed = flag(argv, "--resume");
  const sessionId = resumed ?? flag(argv, "--session-id") ?? "mock-session";
  const { recordings, problems } = loadRecordings(env.dir);
  for (const p of problems) process.stderr.write(`mock: skipped ${p}\n`);
  const sessions = readState(env.state);
  const { play, session } = replay(recordings, sessions[sessionId], prompt, resumed === undefined);
  sessions[sessionId] = session;
  mkdirSync(path.dirname(env.state), { recursive: true });
  writeFileSync(env.state, JSON.stringify({ sessions }));

  const model = flag(argv, "--model");
  print({ type: "system", subtype: "init", session_id: sessionId, ...(model ? { model } : {}) });
  for (const w of play.writes) {
    const target = path.resolve(w.path);
    if (w.content === null) rmSync(target, { force: true });
    else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, w.content);
    }
  }
  if (play.text) {
    const event = (e: unknown) => print({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: e });
    // Streamed in about eight chunks over delayMs, so the window shows it arriving.
    const words = play.text.split(/(?<=\s)/);
    const size = Math.max(1, Math.ceil(words.length / 8));
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    for (let i = 0; i < words.length; i += size) {
      event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: words.slice(i, i + size).join("") } });
      await sleep(play.delayMs / Math.ceil(words.length / size));
    }
    event({ type: "content_block_stop", index: 0 });
  }
  const ui = mcpServers.ui;
  const call = async (tool: string, args: Record<string, unknown>) => {
    if (!ui) throw new Error("fake-claude mock: the app configured no ui MCP server");
    await callMcpTool({ command: ui.command, args: ui.args ?? [], env: ui.env ?? {} }, tool, args);
  };
  for (const b of play.blocks) await call(b.tool, b.input);
  if (play.note) await call("save_note", play.note);
  const u = play.usage;
  print({
    type: "result",
    subtype: "success",
    is_error: false,
    result: play.text,
    session_id: sessionId,
    usage: { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite },
  });
}
