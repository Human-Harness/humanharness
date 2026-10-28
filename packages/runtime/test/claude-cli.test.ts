import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { ClaudeCliTransport, StreamJsonReader, activityExtras, allowedTools, claudeArgs, disallowedTools, profileArgs, referenceRulePath } from "../src/claude-cli";
import type { Event } from "../src/events";
import type { Session, TransportOptions } from "../src/transport";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

function setup(script: ClaudeScript, session: Session = { id: "11111111-1111-1111-1111-111111111111", started: false }) {
  const folder = fs.mkdtempSync(path.join(root, "t-"));
  const argsFile = path.join(folder, "..", `args-${path.basename(folder)}.json`);
  const stdinFile = path.join(folder, "..", `stdin-${path.basename(folder)}.txt`);
  const started: Session[] = [];
  const opts: TransportOptions = {
    folder,
    session,
    mcp: [uiServer],
    permissions,
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_ARGS: argsFile, HH_FAKE_STDIN: stdinFile },
    onSessionStarted: (s) => started.push(s),
  };
  return { transport: new ClaudeCliTransport(opts), folder, started, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], stdin: () => fs.readFileSync(stdinFile, "utf8") };
}

async function run(t: ClaudeCliTransport, message = "hi", signal = new AbortController().signal) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal);
  return events;
}

describe("allowedTools", () => {
  it("derives the whitelist from permissions and MCP servers", () => {
    expect(allowedTools({ edit: "folder", exec: false, web: true }, [uiServer])).toEqual([
      "Read", "Glob", "Grep", "TodoWrite", "Edit(./**)", "Write(./**)", "MultiEdit(./**)", "WebSearch", "WebFetch", "mcp__ui",
    ]);
    expect(allowedTools({ edit: "none", exec: true, web: false }, [])).toEqual(["Read", "Glob", "Grep", "TodoWrite", "Bash"]);
  });
});

describe("disallowedTools", () => {
  it("denies every tool the manifest excludes and the settings dir", () => {
    const settings = ["Edit(.claude/**)", "Write(.claude/**)", "MultiEdit(.claude/**)"];
    expect(disallowedTools({ edit: "none", exec: false, web: false })).toEqual([
      "AskUserQuestion", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebSearch", "WebFetch", ...settings,
    ]);
    expect(disallowedTools({ edit: "folder", exec: true, web: true })).toEqual(["AskUserQuestion", ...settings]);
  });
});

describe("claudeArgs", () => {
  it("starts a new session with a fixed id and inline MCP config", () => {
    const args = claudeArgs({ session: { id: "abc", started: false }, mcp: [uiServer], permissions });
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("--output-format");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--session-id") + 1]).toBe("abc");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(disallowedTools(permissions).join(","));
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(config).toEqual({ mcpServers: { ui: { type: "stdio", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } } } });
  });

  it("resumes a started session", () => {
    const args = claudeArgs({ session: { id: "abc", started: true }, mcp: [], permissions });
    expect(args[args.indexOf("--resume") + 1]).toBe("abc");
    expect(args).not.toContain("--session-id");
  });

  it("keeps the session on disk unless told not to", () => {
    expect(claudeArgs({ session: { id: "abc", started: false }, mcp: [], permissions })).not.toContain("--no-session-persistence");
    expect(claudeArgs({ session: { id: "abc", started: false }, mcp: [], permissions, persistSession: false })).toContain("--no-session-persistence");
  });

  it("refuses a session id that would read as a flag", () => {
    expect(() => claudeArgs({ session: { id: "--dangerously-skip-permissions", started: true }, mcp: [], permissions })).toThrow(/session id/);
    expect(() => claudeArgs({ session: { id: "-x", started: false }, mcp: [], permissions })).toThrow(/session id/);
  });
});

describe("profileArgs", () => {
  const profile = { engine: "claude", tier: "deep" as const, model: "opus", effort: "high" as const, cap: 400_000 };

  it("passes model, effort and context cap", () => {
    expect(profileArgs(profile)).toEqual(["--model", "opus", "--effort", "high", "--autocompact", "400000"]);
    const { model: _m, ...engineDefault } = profile;
    expect(profileArgs(engineDefault)).toEqual(["--effort", "high", "--autocompact", "400000"]);
    expect(profileArgs(undefined)).toEqual([]);
  });

  it("refuses a model that reads as a flag, an unknown effort or a cap out of range", () => {
    expect(() => profileArgs({ ...profile, model: "--dangerously-skip-permissions" })).toThrow(/flag/);
    expect(() => profileArgs({ ...profile, effort: "turbo" as never })).toThrow();
    expect(() => profileArgs({ ...profile, cap: 50 })).toThrow();
  });

  it("goes after the session flags in claudeArgs", () => {
    const args = claudeArgs({ session: { id: "abc", started: true }, mcp: [uiServer], permissions, profile });
    expect(args.slice(-8)).toEqual(["--resume", "abc", "--model", "opus", "--effort", "high", "--autocompact", "400000"]);
  });
});

describe("ClaudeCliTransport", () => {
  it("runs every turn on the profile it is given, first turn and resume alike", async () => {
    const { transport, args } = setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] });
    const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 100_000 };
    await transport.turn("one", () => {}, new AbortController().signal, profile);
    expect(args()).toEqual(expect.arrayContaining(["--session-id", "--model", "haiku", "--effort", "low", "--autocompact", "100000"]));
    await transport.turn("two", () => {}, new AbortController().signal, profile);
    expect(args()).toEqual(expect.arrayContaining(["--resume", "--model", "haiku"]));
  });

  it("fails the turn without starting the CLI when the profile is invalid", async () => {
    const { transport, args } = setup({ steps: [claudeResultLine(true)] });
    const events: Event[] = [];
    await transport.turn("x", (e) => events.push(e), new AbortController().signal, { engine: "claude", tier: "custom", model: "-x", effort: "low", cap: 100_000 });
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: 'Refusing a model id that reads as a flag: "-x"' } }]);
    expect(() => args()).toThrow();
  });

  it("maps a model the plan doesn't include to model-unavailable", async () => {
    const { transport } = setup({
      steps: [
        { line: { type: "assistant", parent_tool_use_id: null, error: "model_not_found", message: { content: [{ type: "text", text: "x" }] } } },
        { line: { type: "result", subtype: "success", is_error: true, api_error_status: 404, terminal_reason: "api_error", result: "There's an issue with the selected model (opus)." } },
      ],
      exitCode: 1,
    });
    const events = await run(transport);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "model-unavailable", detail: "There's an issue with the selected model (opus)." } });
  });

  it("maps a 404 API error to model-unavailable only when it is about the model", async () => {
    const result404 = (result: string) => ({ line: { type: "result", subtype: "success", is_error: true, api_error_status: 404, terminal_reason: "api_error", result } });
    const { transport: aboutModel } = setup({ steps: [result404("There's an issue with the selected model (opus).")], exitCode: 1 });
    expect((await run(aboutModel)).at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    const { transport: other } = setup({ steps: [result404("API Error: 404 Not Found")], exitCode: 1 });
    expect((await run(other)).at(-1)).toEqual({ type: "done", ok: false, error: { code: "agent-crashed", detail: "API Error: 404 Not Found" } });
  });

  it("the fake CLI refuses the models its script lists, like the real one", async () => {
    const { transport } = setup({ steps: [claudeResultLine(true)], failModels: ["opus"] });
    const events: Event[] = [];
    await transport.turn("x", (e) => events.push(e), new AbortController().signal, { engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 });
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
  });

  it("reports the context in use from the last API call, else from the result, and the model it ran", async () => {
    const call = (input: number, read: number) => ({
      line: { type: "assistant", parent_tool_use_id: null, message: { content: [], usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 10, output_tokens: 5 } } },
    });
    const result = {
      line: { type: "result", subtype: "success", is_error: false, result: "", usage: { input_tokens: 9000, output_tokens: 50, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 100 } },
    };
    const { transport } = setup({ steps: [{ line: { type: "system", subtype: "init", session_id: "s", model: "claude-sonnet-4-5" } }, call(100, 40_000), call(200, 50_000), result] });
    const events = await run(transport);
    expect(events).toContainEqual({ type: "context", used: 50_210 });
    expect(events).toContainEqual(expect.objectContaining({ type: "usage", model: "claude-sonnet-4-5" }));
    const { transport: other } = setup({ steps: [result] });
    expect(await run(other)).toContainEqual({ type: "context", used: 99_100 });
  });

  it("streams text and reports success", async () => {
    const { transport, started, args, stdin } = setup({ steps: [...claudeTextLines("Hello there"), claudeResultLine(true, "Hello there")] });
    const events = await run(transport, "say hi");
    expect(events).toEqual([{ type: "text", delta: "Hello there" }, { type: "done", ok: true }]);
    expect(started).toEqual([{ id: "11111111-1111-1111-1111-111111111111", started: true }]);
    expect(stdin()).toBe("say hi");
    expect(args()).not.toContain("say hi");
  });

  it("retries once with a fresh session when the resumed session is gone", async () => {
    const { transport, started, args } = setup(
      { steps: [...claudeTextLines("fresh"), claudeResultLine(true)], failOnResume: "No conversation found with session ID: 1111" },
      { id: "11111111-1111-1111-1111-111111111111", started: true },
    );
    const events = await run(transport, "again");
    expect(events).toEqual([{ type: "text", delta: "fresh" }, { type: "done", ok: true }]);
    expect(args()).not.toContain("--resume");
    const fresh = args()[args().indexOf("--session-id") + 1];
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh).not.toBe("11111111-1111-1111-1111-111111111111");
    expect(started).toEqual([{ id: fresh, started: true }]);
  });

  it("does not retry other resume failures", async () => {
    const { transport, started } = setup(
      { steps: [], failOnResume: "something else broke" },
      { id: "11111111-1111-1111-1111-111111111111", started: true },
    );
    const events = await run(transport);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "something else broke" } }]);
    expect(started).toEqual([]);
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
      { type: "activity", id: "t1", kind: "read", detail: "a.md", paths: ["/x/notes/a.md"], state: "start" },
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
    const folder = fs.mkdtempSync(path.join(root, "t-"));
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

  it("starts a new session after endSession", async () => {
    const { transport, args, started } = setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, { id: "old-1", started: true });
    await run(transport);
    expect(args()[args().indexOf("--resume") + 1]).toBe("old-1");
    await transport.endSession();
    await run(transport);
    const id = args()[args().indexOf("--session-id") + 1];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe("old-1");
    expect(args()).not.toContain("--resume");
    expect(started).toEqual([{ id, started: true }]);
  });
});

const toolUse = (id: string, name: string, input: unknown) => ({
  line: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name, input }] } },
});
const blockEvent = (e: unknown) => ({ line: { type: "stream_event", parent_tool_use_id: null, event: e } });

describe("ClaudeCliTransport hardening", () => {
  it("cancels even when a grandchild ignores SIGTERM", async () => {
    const { transport } = setup({ steps: [{ spawnStubborn: true }, { sleep: 30_000 }] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const started = Date.now();
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10_000);

  it("never reports ToolSearch or TodoWrite", async () => {
    const { transport } = setup({
      steps: [toolUse("t1", "ToolSearch", { query: "select:mcp__ui__show_note" }), toolUse("t2", "TodoWrite", { todos: [] }), claudeResultLine(true)],
    });
    expect(await run(transport)).toEqual([{ type: "done", ok: true }]);
  });

  it("emits a paragraph only before the first delta of a later text block", async () => {
    const empty = [
      blockEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      blockEvent({ type: "content_block_stop", index: 0 }),
    ];
    const a = setup({ steps: [...empty, ...claudeTextLines("One"), claudeResultLine(true)] });
    expect((await run(a.transport)).map((e) => e.type)).toEqual(["text", "done"]);
    const b = setup({ steps: [...claudeTextLines("One"), ...empty, ...claudeTextLines("Two"), claudeResultLine(true)] });
    expect((await run(b.transport)).map((e) => e.type)).toEqual(["text", "paragraph", "text", "done"]);
  });

  it("does not start the same tool twice", async () => {
    const { transport } = setup({
      steps: [toolUse("t1", "Read", { file_path: "/a/b.md" }), toolUse("t1", "Read", { file_path: "/a/b.md" }), claudeResultLine(true)],
    });
    const events = await run(transport);
    expect(events.filter((e) => e.type === "activity")).toHaveLength(1);
  });

  it("derives the detail per tool", async () => {
    const long = "x".repeat(120);
    const { transport } = setup({
      steps: [
        toolUse("1", "Edit", { file_path: "/a/b/c.ts" }),
        toolUse("2", "Grep", { pattern: "foo", path: "/a/b" }),
        toolUse("3", "Glob", { pattern: "**/*.md", path: "/a" }),
        toolUse("4", "WebFetch", { url: "https://x.dev", prompt: "p" }),
        toolUse("5", "WebSearch", { query: "q" }),
        toolUse("6", "Bash", { command: `ls -la\necho hi` }),
        toolUse("7", "Bash", { command: long }),
        toolUse("8", "Whatever", { file_path: "/a/b" }),
        claudeResultLine(true),
      ],
    });
    const details = (await run(transport)).flatMap((e) => (e.type === "activity" ? [e.detail] : []));
    expect(details).toEqual(["c.ts", "foo", "**/*.md", "https://x.dev", "q", "ls -la", "x".repeat(80), ""]);
  });

  it("feeds a final stdout line without a newline", async () => {
    const { transport } = setup({
      steps: [{ raw: JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom" }) }],
    });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { detail: "boom" } });
  });

  it("reports a signal-killed child", async () => {
    const { transport } = setup({ steps: [{ signal: "SIGKILL" }] });
    const events = await run(transport);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "exit signal SIGKILL" } }]);
  });

  it("treats exit 0 without a result as a crash", async () => {
    const { transport } = setup({ steps: [...claudeTextLines("hi")] });
    const events = await run(transport);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "agent-crashed", detail: "no result" } });
  });

  it("reports cancelled when aborted before the process ends with any outcome", async () => {
    const { transport } = setup({ steps: [{ sleep: 200 }, claudeResultLine(true)] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const events = await run(transport, "hi", controller.signal);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "cancelled" } });
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });
});

describe("reference folders", () => {
  it("adds each reference folder with --add-dir and denies edits there", () => {
    const args = claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions, references: ["/Users/me/code/hh", "/opt/docs"] });
    const at = args.indexOf("--add-dir");
    expect(args.slice(at, at + 4)).toEqual(["--add-dir", "/Users/me/code/hh", "--add-dir", "/opt/docs"]);
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    expect(denied).toEqual(
      expect.arrayContaining(["Edit(//Users/me/code/hh/**)", "Write(//Users/me/code/hh/**)", "MultiEdit(//Users/me/code/hh/**)", "Edit(//opt/docs/**)"]),
    );
    expect(claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions })).not.toContain("--add-dir");
  });

  it("normalizes reference paths before building the deny rules", () => {
    const denied = disallowedTools({ edit: "folder", exec: false, web: false }, ["/opt/docs/", "/opt/a/../b//"]);
    expect(denied).toEqual(expect.arrayContaining(["Edit(//opt/docs/**)", "Write(//opt/b/**)"]));
    expect(denied.some((d) => d.includes("docs//"))).toBe(false);
    expect(referenceRulePath("C:\\Users\\me\\code\\", "win32")).toBe("/c/Users/me/code");
    expect(referenceRulePath("/opt/docs/", "darwin")).toBe("/opt/docs");
  });

  it("keeps the read tools allowed", () => {
    expect(allowedTools({ edit: "none", exec: false, web: false }, [])).toEqual(["Read", "Glob", "Grep", "TodoWrite"]);
    expect(disallowedTools({ edit: "none", exec: false, web: false }, ["/r"])).toContain("Write(//r/**)");
  });

  it("an MCP-only session gets only its servers and denies the read tools; it is opt-in (D0)", () => {
    const none = { edit: "none", exec: false, web: false } as const;
    const server = { name: "translate", command: "node", args: [], env: {} };
    expect(allowedTools(none, [server], true)).toEqual(["mcp__translate"]);
    expect(disallowedTools(none, [], true)).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "TodoWrite"]));
    const session = { id: "s", started: false };
    const off = claudeArgs({ session, mcp: [server], permissions: none });
    expect(off[off.indexOf("--allowedTools") + 1]).toBe("Read,Glob,Grep,TodoWrite,mcp__translate");
    expect(off[off.indexOf("--disallowedTools") + 1]).toBe(disallowedTools(none).join(","));
    const on = claudeArgs({ session, mcp: [server], permissions: none, mcpOnly: true });
    expect(on[on.indexOf("--allowedTools") + 1]).toBe("mcp__translate");
    expect(on[on.indexOf("--disallowedTools") + 1].split(",")).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "TodoWrite"]));
  });

  it("an MCP-only session also denies subagents, listing, notebooks, skills, slash commands and the web; each once", () => {
    const extra = ["Task", "Agent", "LS", "NotebookRead", "NotebookEdit", "Skill", "SlashCommand", "WebFetch", "WebSearch"];
    // Even with permissions that would allow edits and the web, an MCP-only session gets none of them.
    for (const permissions of [{ edit: "none", exec: false, web: false }, { edit: "folder", exec: false, web: true }] as const) {
      const denied = disallowedTools(permissions, [], true);
      expect(denied).toEqual(expect.arrayContaining(extra));
      expect(new Set(denied).size).toBe(denied.length);
    }
    // D0: material and task turns (no mcpOnly) deny exactly what they did.
    const none = { edit: "none", exec: false, web: false } as const;
    expect(disallowedTools(none)).toEqual(["AskUserQuestion", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebSearch", "WebFetch", "Edit(.claude/**)", "Write(.claude/**)", "MultiEdit(.claude/**)"]);
    expect(disallowedTools({ edit: "folder", exec: true, web: true })).not.toEqual(expect.arrayContaining(["Task", "Agent", "LS", "Skill"]));
  });
});

describe("activity extras (context-panel spec §3.2)", () => {
  it("reads: Read's file_path, Grep's and Glob's path; MCP tools by server and name", () => {
    expect(activityExtras("Read", { file_path: "/w/a.md" })).toEqual({ paths: ["/w/a.md"] });
    expect(activityExtras("Grep", { pattern: "x", path: "/w/src" })).toEqual({ paths: ["/w/src"] });
    expect(activityExtras("Glob", { pattern: "*.md" })).toEqual({});
    expect(activityExtras("mcp__atlassian__getJiraIssue", {})).toEqual({ tool: { server: "atlassian", name: "getJiraIssue" } });
    expect(activityExtras("mcp__data__data_query", {})).toEqual({ tool: { server: "data", name: "data_query" } });
    expect(activityExtras("mcp__broken", {})).toEqual({});
    expect(activityExtras("Edit", { file_path: "/w/a.md" })).toEqual({});
    // Bounds: a path over 4,096 characters is dropped, an MCP name is cut at 100.
    expect(activityExtras("Read", { file_path: `/w/${"a".repeat(5000)}` })).toEqual({});
    expect(activityExtras("Grep", { pattern: "x", path: `/w/${"a".repeat(5000)}` })).toEqual({});
    expect(activityExtras(`mcp__${"s".repeat(150)}__${"t".repeat(150)}`, {})).toEqual({ tool: { server: "s".repeat(100), name: "t".repeat(100) } });
  });

  it("puts them on the start event only; the end event is as before", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/w/notes/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1" }] } }));
    expect(events).toEqual([
      { type: "activity", id: "r1", kind: "read", detail: "a.md", paths: ["/w/notes/a.md"], state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "end", error: false },
    ]);
  });

  it("D0: a Bash or Write activity carries nothing new", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/w/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "ls /w" } }] } }));
    expect(events.map((e) => Object.keys(e).sort())).toEqual([
      ["detail", "id", "kind", "state", "type"],
      ["detail", "id", "kind", "state", "type"],
    ]);
    expect(events[0]).toEqual({ type: "activity", id: "w1", kind: "edit", detail: "a.md", state: "start" });
  });
});
