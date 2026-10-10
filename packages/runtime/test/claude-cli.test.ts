import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { ClaudeCliTransport, allowedTools, claudeArgs } from "../src/claude-cli";
import type { Event } from "../src/events";
import type { Session, TransportOptions } from "../src/transport";

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

function setup(script: ClaudeScript, session: Session = { id: "11111111-1111-1111-1111-111111111111", started: false }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  const argsFile = path.join(folder, "..", `args-${path.basename(folder)}.json`);
  const started: Session[] = [];
  const opts: TransportOptions = {
    folder,
    session,
    mcp: [uiServer],
    permissions,
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_ARGS: argsFile },
    onSessionStarted: (s) => started.push(s),
  };
  return { transport: new ClaudeCliTransport(opts), folder, started, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[] };
}

async function run(t: ClaudeCliTransport, message = "hi", signal = new AbortController().signal) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal);
  return events;
}

describe("allowedTools", () => {
  it("derives the whitelist from permissions and MCP servers", () => {
    expect(allowedTools({ edit: "folder", exec: false, web: true }, [uiServer])).toEqual([
      "Read", "Glob", "Grep", "TodoWrite", "Edit", "Write", "MultiEdit", "WebSearch", "WebFetch", "mcp__ui",
    ]);
    expect(allowedTools({ edit: "none", exec: true, web: false }, [])).toEqual(["Read", "Glob", "Grep", "TodoWrite", "Bash"]);
  });
});

describe("claudeArgs", () => {
  it("starts a new session with a fixed id and inline MCP config", () => {
    const args = claudeArgs("hello", { session: { id: "abc", started: false }, mcp: [uiServer], permissions });
    expect(args.slice(0, 2)).toEqual(["-p", "hello"]);
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--session-id") + 1]).toBe("abc");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("AskUserQuestion");
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(config).toEqual({ mcpServers: { ui: { type: "stdio", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } } } });
  });

  it("resumes a started session", () => {
    const args = claudeArgs("hello", { session: { id: "abc", started: true }, mcp: [], permissions });
    expect(args[args.indexOf("--resume") + 1]).toBe("abc");
    expect(args).not.toContain("--session-id");
  });
});

describe("ClaudeCliTransport", () => {
  it("streams text and reports success", async () => {
    const { transport, started, args } = setup({ steps: [...claudeTextLines("Hello there"), claudeResultLine(true, "Hello there")] });
    const events = await run(transport, "say hi");
    expect(events).toEqual([{ type: "text", delta: "Hello there" }, { type: "done", ok: true }]);
    expect(started).toEqual([{ id: "11111111-1111-1111-1111-111111111111", started: true }]);
    expect(args()[1]).toBe("say hi");
  });

  it("reports tool activity and hides ui tools", async () => {
    const toolUse = (id: string, name: string, input: unknown) => ({
      line: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name, input }] } },
    });
    const toolResult = (id: string) => ({
      line: { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false }] } },
    });
    const { transport } = setup({
      steps: [
        toolUse("t1", "Read", { file_path: "/x/notes/a.md" }),
        toolResult("t1"),
        toolUse("t2", "mcp__ui__show_note", { title: "x" }),
        toolResult("t2"),
        ...claudeTextLines("Done"),
        claudeResultLine(true),
      ],
    });
    const events = await run(transport);
    expect(events).toEqual([
      { type: "activity", id: "t1", kind: "read", detail: "a.md", state: "start" },
      { type: "activity", id: "t1", kind: "read", detail: "a.md", state: "end", error: false },
      { type: "text", delta: "Done" },
      { type: "done", ok: true },
    ]);
  });

  it("reports plan limits and token usage", async () => {
    const { transport } = setup({
      steps: [
        {
          line: {
            type: "rate_limit_event",
            rate_limit_info: {
              status: "allowed",
              unifiedWindows: {
                five_hour: { utilization: 0.16, resetsAt: 1791648000 },
                seven_day: { utilization: 0.09, resetsAt: 1792004400 },
              },
            },
          },
        },
        ...claudeTextLines("ok"),
        {
          line: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "ok",
            total_cost_usd: 0.07,
            usage: { input_tokens: 6, output_tokens: 142, cache_read_input_tokens: 44968, cache_creation_input_tokens: 6812 },
          },
        },
      ],
    });
    const events = await run(transport);
    expect(events).toContainEqual({
      type: "limits",
      status: "allowed",
      windows: [
        { kind: "five_hour", utilization: 0.16, resetsAt: new Date(1791648000 * 1000).toISOString() },
        { kind: "seven_day", utilization: 0.09, resetsAt: new Date(1792004400 * 1000).toISOString() },
      ],
    });
    expect(events).toContainEqual({
      type: "usage",
      inputTokens: 6,
      outputTokens: 142,
      cacheReadTokens: 44968,
      cacheWriteTokens: 6812,
      costEquivalentUsd: 0.07,
    });
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("separates text blocks with a paragraph event", async () => {
    const { transport } = setup({ steps: [...claudeTextLines("One"), ...claudeTextLines("Two"), claudeResultLine(true)] });
    const events = await run(transport);
    expect(events.map((e) => e.type)).toEqual(["text", "paragraph", "text", "done"]);
  });

  it("classifies an error result", async () => {
    const { transport } = setup({ steps: [claudeResultLine(false, "Claude AI usage limit reached")], exitCode: 1 });
    const events = await run(transport);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "out-of-quota", detail: "Claude AI usage limit reached" } });
  });

  it("classifies stderr when the process fails without a result", async () => {
    const { transport } = setup({ steps: [], stderr: "Invalid API key · Please run /login", exitCode: 1 });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
  });

  it("reports a missing binary", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const t = new ClaudeCliTransport({
      folder,
      session: { id: "x", started: false },
      mcp: [],
      permissions,
      command: [path.join(folder, "no-such-claude")],
      onSessionStarted: () => {},
    });
    const events = await run(t);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed", detail: expect.any(String) } }]);
  });

  it("cancels a running turn", async () => {
    const { transport } = setup({ steps: [{ sleep: 10_000 }] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
  });
});
