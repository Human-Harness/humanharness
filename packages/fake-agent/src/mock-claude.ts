// fake-claude's mock mode (spec 3e): replays <harness>/mock/*.json instead of a test script.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import { APP_FOLDERS, loadRecordings } from "./mock";
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
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel) || (APP_FOLDERS as readonly string[]).includes(first)) {
    throw new Error(`refused to write "${p}": outside the work folder or in an app-owned folder`);
  }
  // A symlinked folder must not lead out either: check the nearest existing ancestor.
  let ancestor = path.dirname(target);
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = path.relative(realpathSync(cwd), realpathSync(ancestor));
  if (real === ".." || real.startsWith(".." + path.sep) || path.isAbsolute(real)) throw new Error(`refused to write "${p}": a symlink leads outside the work folder`);
  // A symlink as the target itself would be followed by the write or the delete.
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`refused to write "${p}": it is a symlink`);
  return target;
}

/**
 * The first lines of Sidekick's turns (shell `SIDEKICK_PRE_MARK`, `SIDEKICK_AFTER_MARK`, `SIDEKICK_LEARN_MARK`, `SIDEKICK_ROUTE_MARK`, `SIDEKICK_PHASE_MARK`, `SIDEKICK_DAILY_MARK`, `SIDEKICK_APPROVE_MARK`, `SIDEKICK_PLACE_MARK` and `SIDEKICK_IMPORT_MARK`; a
 * copy: fake-agent never imports the shell; shell sidekick-turns.test pins them).
 */
export const MOCK_SIDEKICK_MARKS = { pre: "Sidekick: pre-send review", after: "Sidekick: after the reply", learn: "Sidekick: learn", route: "Sidekick: route", phase: "Sidekick: phase change", daily: "Sidekick: daily summary", approve: "Sidekick: before approve", place: "Sidekick: place", import: "Sidekick: import" } as const;

/** A Sidekick turn: answered by `mockSidekickReply`, never by the recordings (sidekick plan Decision 12). */
export const isMockSidekickTurn = (prompt: string): boolean => Object.values(MOCK_SIDEKICK_MARKS).some((m) => prompt.startsWith(m));

const HINTS: Record<string, string> = {
  vague: "Say exactly what should change and how you'll know it's done.",
  "missing-context": "Name the note or file you mean.",
  "two-asks": "One ask per prompt: the second one is kept for later.",
  "off-phase": "This looks like another phase's work.",
};

const JOINER = /^(?:and also|and then)\b/i;

/** A canned Sidekick answer in mock mode, built from the flags the prompt lists: no model, no recordings. */
export function mockSidekickReply(prompt: string): string {
  // After the reply: nothing to show (a gap, a next step or a repeated ask would need a model).
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.after)) return "{}";
  // Learning (sidekick spec §6.4): no changes.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.learn)) return "{}";
  // A phase change (sidekick spec §2a.2 process-guard): nothing missing.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.phase)) return '{"missing":[]}';
  // Before approve (sidekick spec §2a.2 process-guard): nothing missing.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.approve)) return '{"missing":[]}';
  // The daily summary (sidekick spec §2a.2 daily-summary): plain text.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.daily)) return "Mock: yesterday's notes are saved. Pick one open thing for today.";
  // A harness place (sidekick spec §2a.5): plain text.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.place)) return "Mock: nothing in this output needs your attention.";
  // An import (sidekick spec §2a.6): a fixed draft, nothing learned or skipped.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.import)) return '{"name":"Imported","mark":"🦊","personality":"Direct and brief.","purposes":[{"id":"prompt-coach"}],"learned":[],"skipped":[]}';
  // Routing (sidekick spec §2a.3): the first choice, the person's order.
  if (prompt.startsWith(MOCK_SIDEKICK_MARKS.route)) return /^Who should speak\? Choices:\n- ([^:\n]+):/m.exec(prompt)?.[1] ?? "";
  const typed = /<prompt>\n([\s\S]*)\n<\/prompt>/.exec(prompt)?.[1] ?? "";
  // Only the "Local flags:" section: a note title may look like a flag line. The match is JSON-quoted.
  const section = /^Local flags:[^\n]*\n([\s\S]*?)^UI language:/m.exec(prompt)?.[1] ?? "";
  const kinds = [...section.matchAll(/^- (vague|missing-context|two-asks|off-phase): ("(?:[^"\\]|\\.)*") at \[(\d+), (\d+)\]/gm)].map((m) => ({
    kind: m[1],
    match: JSON.parse(m[2]) as string,
    span: [Number(m[3]), Number(m[4])] as const,
  }));
  if (kinds.length === 0) return JSON.stringify({ verdict: "send", issues: [], confidence: 0.9 });
  const two = kinds.find((k) => k.kind === "two-asks");
  // The span is the joiner ("and also") or, for two lines, the second line's first word.
  const keep = (two ? typed.slice(0, two.span[0]).trim() : typed.trim()) || typed.trim();
  const queued = two ? typed.slice(two.span[0]).replace(JOINER, "").trim() : "";
  return JSON.stringify({
    verdict: "suggest",
    issues: kinds.map((k) => ({ kind: k.kind, text: HINTS[k.kind] })),
    rewrite: kinds.some((k) => k.kind !== "two-asks") ? `${keep} (mock: name the part and the result you want)` : keep,
    ...(queued ? { queued: [queued] } : {}),
    confidence: 0.8,
  });
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
  // Sidekick's own turns never touch the recordings or the session state (sidekick plan Decision 12).
  if (isMockSidekickTurn(prompt)) {
    const text = mockSidekickReply(prompt);
    const event = (e: unknown) => print({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: e });
    print({ type: "system", subtype: "init", session_id: sessionId, tools: [] });
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
    event({ type: "content_block_stop", index: 0 });
    print({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, usage: { input_tokens: 400, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return;
  }
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
