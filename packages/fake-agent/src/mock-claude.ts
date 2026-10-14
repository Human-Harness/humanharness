// packages/fake-agent/src/mock-claude.ts
// fake-claude's mock mode (spec 3e): replays <harness>/mock/*.json instead of a test script.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** Atomic: a reader never sees half a file. */
function writeState(file: string, sessions: Record<string, SessionPosition>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ sessions }));
  renameSync(tmp, file);
}

const flag = (argv: string[], name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const print = (line: unknown) => process.stdout.write(JSON.stringify(line) + "\n");

/** The absolute target of a recorded write; throws if it would land outside the work folder or in an app-owned folder. */
function safeTarget(cwd: string, p: string): string {
  const target = path.resolve(cwd, p);
  const rel = path.relative(cwd, target);
  const first = rel.split(path.sep)[0];
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || first === ".claude" || first === ".harness") {
    throw new Error(`refused to write "${p}": outside the work folder or in an app-owned folder`);
  }
  // A symlinked folder must not lead out either: check the nearest existing ancestor.
  let ancestor = path.dirname(target);
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = path.relative(realpathSync(cwd), realpathSync(ancestor));
  if (real.startsWith("..") || path.isAbsolute(real)) throw new Error(`refused to write "${p}": a symlink leads outside the work folder`);
  return target;
}

/** One engine turn in mock mode: prints Claude's stream-json, calls the ui tools and writes the files. Returns the exit code. */
export async function runMockTurn(argv: string[], prompt: string, mcpServers: McpServers, env: { dir: string; state: string }): Promise<number> {
  const resumed = flag(argv, "--resume");
  const sessionId = resumed ?? flag(argv, "--session-id") ?? "mock-session";
  try {
    await playTurn(argv, prompt, mcpServers, env, sessionId, resumed === undefined);
    return 0;
  } catch (err) {
    print({ type: "result", subtype: "error_during_execution", is_error: true, result: `mock: ${(err as Error).message}`, session_id: sessionId });
    return 1;
  }
}

async function playTurn(argv: string[], prompt: string, mcpServers: McpServers, env: { dir: string; state: string }, sessionId: string, newSession: boolean): Promise<void> {
  const { recordings, problems } = loadRecordings(env.dir);
  for (const p of problems) process.stderr.write(`mock: skipped ${p}\n`);
  const sessions = readState(env.state);
  const { play, session } = replay(recordings, sessions[sessionId], prompt, newSession);

  const model = flag(argv, "--model");
  print({ type: "system", subtype: "init", session_id: sessionId, ...(model ? { model } : {}) });
  const cwd = process.cwd();
  const writes = play.writes.map((w) => ({ target: safeTarget(cwd, w.path), content: w.content }));
  for (const w of writes) {
    if (w.content === null) rmSync(w.target, { force: true });
    else {
      mkdirSync(path.dirname(w.target), { recursive: true });
      writeFileSync(w.target, w.content);
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
    if (!ui) throw new Error("the app configured no ui MCP server");
    const res = await callMcpTool({ command: ui.command, args: ui.args ?? [], env: ui.env ?? {} }, tool, args);
    if (res.isError) {
      const content = res.content as { text?: string }[] | undefined;
      const msg = content?.map((c) => c.text ?? "").join(" ").trim();
      throw new Error(`the ui server rejected ${tool}${msg ? `: ${msg}` : ""}`);
    }
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
  // Saved last: a turn that failed or was cancelled does not advance the session.
  sessions[sessionId] = session;
  writeState(env.state, sessions);
}
