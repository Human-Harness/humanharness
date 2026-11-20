import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { SidekickSession } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-sk-rt-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 100_000 };
const result = (text: string) => ({ line: { type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } });

function fakeClaude(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "c-"));
  const argsFile = path.join(dir, "args.json");
  return { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_ARGS: argsFile }, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], folder: dir };
}

describe("SidekickSession", () => {
  it("Claude: no tools, its own folder, the text and usage; the second turn resumes", async () => {
    const json = '{"verdict":"send","issues":[],"confidence":0.9}';
    const fake = fakeClaude({ steps: [...claudeTextLines(json), result(json)] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const a = await s.ask("Sidekick: pre-send review\n…", new AbortController().signal);
    expect(a.ok).toBe(true);
    expect(a.text).toBe(json);
    expect(a.usage?.inputTokens).toBe(300);
    expect(fake.args()).toContain("--tools");
    expect(fake.args()).toContain("--session-id");
    await s.ask("again", new AbortController().signal);
    expect(fake.args()).toContain("--resume");
    await s.close();
  });

  it("the engine's limit windows ride on the answer", async () => {
    const limits = { line: { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1_900_000_000 } } } } };
    const fake = fakeClaude({ steps: [limits, ...claudeTextLines("{}"), result("{}")] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const a = await s.ask("x", new AbortController().signal);
    expect(a.limits).toEqual([{ kind: "five_hour", utilization: 0.4, resetsAt: new Date(1_900_000_000_000).toISOString() }]);
    await s.close();
  });

  it("turns are serial: a second ask waits for the first", async () => {
    const fake = fakeClaude({ steps: [{ sleep: 150 }, ...claudeTextLines("{}"), result("{}")] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const order: number[] = [];
    await Promise.all([s.ask("a", new AbortController().signal).then(() => order.push(1)), s.ask("b", new AbortController().signal).then(() => order.push(2))]);
    expect(order).toEqual([1, 2]);
    await s.close();
  });

  it("an abort is a failed answer, never a throw", async () => {
    const fake = fakeClaude({ steps: [{ sleep: 5000 }] });
    const s = new SidekickSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const c = new AbortController();
    setTimeout(() => c.abort(), 100);
    const a = await s.ask("x", c.signal);
    expect(a.ok).toBe(false);
    expect(a.error?.code).toBe("cancelled");
    await s.close();
  });

  it("ACP: session/new with no MCP servers, in the Sidekick folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "a-"));
    const log = path.join(dir, "log.jsonl");
    const script: AcpScript = { usage: { inputTokens: 10, outputTokens: 5 }, turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "{}" } } }]] };
    const s = new SidekickSession({ engine: getEngine("codex"), command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_LOG: log }, folder: dir, profile: { ...profile, engine: "codex", model: undefined } });
    const a = await s.ask("x", new AbortController().signal);
    expect(a.ok).toBe(true);
    const created = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: { cwd?: string; mcpServers?: unknown[] } }).find((l) => l.method === "session/new");
    expect(created?.params.mcpServers).toEqual([]);
    expect(created?.params.cwd).toBe(dir);
    await s.close();
  });
});
