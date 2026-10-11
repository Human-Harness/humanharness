import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeResultLine, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { getEngine } from "@humanharness/engines";
import { TEST_PROMPT, testPrompt } from "../src/main/engine-check";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("testPrompt", () => {
  it("passes when Claude answers, sending the tiny prompt on stdin", async () => {
    const stdin = path.join(root, "stdin.txt");
    const r = await testPrompt(getEngine("claude"), {
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [...claudeTextLines("OK"), claudeResultLine(true, "OK")] }), HH_FAKE_STDIN: stdin },
    });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(stdin, "utf8")).toBe(TEST_PROMPT);
  });

  it("returns the engine's error when it fails", async () => {
    const r = await testPrompt(getEngine("claude"), {
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [claudeResultLine(false, "Not logged in · Please run /login")], exitCode: 1 }) },
    });
    expect(r).toMatchObject({ ok: false, error: { code: "session-expired" } });
  });

  it("passes when an ACP engine answers, in its read-only mode and without MCP servers", async () => {
    const log = path.join(root, "acp-log.jsonl");
    const r = await testPrompt(getEngine("codex"), {
      command: fakeAcpCommand(),
      env: {
        HH_FAKE_SCRIPT: writeScript(root, { turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK" } } }, { stop: "end_turn" }]] }),
        HH_FAKE_LOG: log,
      },
    });
    expect(r.ok).toBe(true);
    const requests = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: any });
    expect(requests.find((q) => q.method === "session/set_mode")?.params.modeId).toBe("read-only");
    expect(requests.find((q) => q.method === "session/new")?.params.mcpServers).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    const r = await testPrompt(
      getEngine("claude"),
      { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [{ sleep: 5000 }] }) } },
      { timeoutMs: 200 },
    );
    expect(r).toMatchObject({ ok: false, error: { code: "agent-crashed", detail: "timed out" } });
  });

  it("gives up when the engine never finishes starting", async () => {
    const started = Date.now();
    const r = await testPrompt(getEngine("codex"), { command: [process.execPath, "-e", "setInterval(()=>{},1000)"], env: {} }, { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, error: { code: "agent-crashed", detail: "timed out" } });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("asks Claude not to keep the test conversation", async () => {
    const args = path.join(root, "args.json");
    await testPrompt(getEngine("claude"), {
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [claudeResultLine(true, "OK")] }), HH_FAKE_ARGS: args },
    });
    expect(JSON.parse(fs.readFileSync(args, "utf8"))).toContain("--no-session-persistence");
  });
});
