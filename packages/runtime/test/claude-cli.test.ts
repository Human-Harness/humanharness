import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { ClaudeCliTransport, StreamJsonReader, activityExtras, allowedTools, claudeArgs, disallowedTools, editPaths, profileArgs, referenceRulePath, referenceSettingsArgs, ruleUnsafePath } from "../src/claude-cli";
import type { Event } from "../src/events";
import { absoluteSearchPath, type EnginePreset, type Session, type TransportOptions } from "../src/transport";

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

describe("PATH on a preset turn (hatches spec §5.3, E2)", () => {
  it("absoluteSearchPath keeps absolute entries outside the roots; nothing left falls back to /usr/bin:/bin (probe 6)", () => {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(root, "roots-")));
    fs.mkdirSync(path.join(r, "work/bin"), { recursive: true });
    fs.mkdirSync(path.join(r, "Linked"), { recursive: true });
    const roots = [path.join(r, "work"), path.join(r, "Linked")];
    expect(absoluteSearchPath(":.:rel/bin:/usr/bin::/bin:./x")).toBe("/usr/bin:/bin");
    for (const [value, want] of [
      ["", "/usr/bin:/bin"],
      [".", "/usr/bin:/bin"],
      ["~/bin:/usr/bin", "/usr/bin"],
      ["$HOME/bin:/usr/bin", "/usr/bin"],
      ["bin:/usr/bin", "/usr/bin"],
      ["/a::/b:", "/a:/b"],
      ["./x:/usr/bin", "/usr/bin"],
      [`${r}/work/bin:/usr/bin`, "/usr/bin"],
      [`${r}/WORK/bin:/opt/x`, "/opt/x"],
      [`${r}/work/not-yet/bin:/usr/bin`, "/usr/bin"],
      [`${r}/work/../Linked/bin:/usr/bin`, "/usr/bin"],
      [`${r}/work`, "/usr/bin:/bin"],
      [`${r}/other:/usr/bin`, `${r}/other:/usr/bin`],
    ] as const) {
      expect(absoluteSearchPath(value, roots), value).toBe(want);
    }
  });

  it("a preset turn's CLI (and its hooks and servers) gets that PATH without the folder and linked folders; D0 keeps it as given", async () => {
    for (const engine of [{ hash: "a".repeat(64), base: "isolated" as const, servers: [] }, undefined]) {
      const folder = fs.realpathSync(fs.mkdtempSync(path.join(root, "t-")));
      const linked = fs.realpathSync(fs.mkdtempSync(path.join(root, "l-")));
      const dirty = `:.:rel/bin:${folder}/bin:/usr/bin::${linked}/bin:/bin`;
      const pathFile = path.join(folder, "..", `path-${path.basename(folder)}.txt`);
      const transport = new ClaudeCliTransport({
        folder,
        session: { id: "11111111-1111-1111-1111-111111111111", started: false },
        mcp: [uiServer],
        permissions,
        command: fakeClaudeCommand(),
        env: { HH_FAKE_SCRIPT: writeScript(root, { steps: [...claudeTextLines("ok"), claudeResultLine(true)] }), HH_FAKE_PATH: pathFile, PATH: dirty },
        onSessionStarted: () => {},
      });
      const scope = { linked: [{ path: linked, mode: "read" as const, tracked: false }], ...(engine ? { engine } : {}) };
      await transport.turn("hi", () => {}, new AbortController().signal, undefined, scope);
      expect(fs.readFileSync(pathFile, "utf8"), engine ? "preset" : "D0").toBe(engine ? "/usr/bin:/bin" : dirty);
    }
  });
});

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

  it("leaves out a limits window whose reset is missing or invalid, and keeps the turn going", async () => {
    const { transport } = setup({
      steps: [
        {
          line: {
            type: "rate_limit_event",
            rate_limit_info: {
              status: "allowed",
              unifiedWindows: {
                five_hour: { utilization: 0.5 },
                seven_day: { utilization: 0.2, resetsAt: "soon" },
                opus: { utilization: 0.1, resetsAt: 1e20 },
                weekly: { utilization: 0.3, resetsAt: 1792004400 },
              },
            },
          },
        },
        ...claudeTextLines("ok"),
        { line: { type: "result", subtype: "success", is_error: false, result: "ok" } },
      ],
    });
    const events = await run(transport);
    expect(events).toContainEqual({
      type: "limits",
      status: "allowed",
      windows: [{ kind: "weekly", utilization: 0.3, resetsAt: new Date(1792004400 * 1000).toISOString() }],
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
  it("gives reference folders file access through --settings additionalDirectories, never --add-dir, and denies edits there", () => {
    const args = claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions, references: ["/Users/me/code/hh", "/opt/docs"] });
    // --add-dir would also load each folder's .claude/skills, commands and agents (spike S2).
    expect(args).not.toContain("--add-dir");
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    expect(settings).toEqual({ permissions: { additionalDirectories: ["/Users/me/code/hh", "/opt/docs"] } });
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    expect(denied).toEqual(
      expect.arrayContaining(["Edit(//Users/me/code/hh/**)", "Write(//Users/me/code/hh/**)", "MultiEdit(//Users/me/code/hh/**)", "Edit(//opt/docs/**)"]),
    );
    // Reading keeps working as before: the bare Read, Glob and Grep allow rules cover any path.
    expect(args[args.indexOf("--allowedTools") + 1].split(",")).toEqual(expect.arrayContaining(["Read", "Glob", "Grep"]));
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
  });

  it("passes no --settings and no --add-dir without reference folders (D0)", () => {
    const base = { session: { id: "a", started: false }, mcp: [], permissions };
    for (const args of [claudeArgs(base), claudeArgs({ ...base, references: [] })]) {
      expect(args).not.toContain("--add-dir");
      expect(args).not.toContain("--settings");
    }
    expect(referenceSettingsArgs([])).toEqual([]);
  });

  it("keeps Windows paths intact in the settings JSON", () => {
    const [flag, json] = referenceSettingsArgs(["C:\\Users\\me\\code"]);
    expect(flag).toBe("--settings");
    expect(JSON.parse(json).permissions.additionalDirectories).toEqual(["C:\\Users\\me\\code"]);
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

  it("D0: a Bash or Write activity carries nothing new (a Write only the stack's parallel-spec `edits`)", () => {
    // The context-panel extras add nothing to either.
    expect(activityExtras("Write", { file_path: "/w/a.md" })).toEqual({});
    expect(activityExtras("Bash", { command: "ls /w" })).toEqual({});
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/w/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "ls /w" } }] } }));
    // The Write's `edits` (parallel spec §5.2, "edit paths" below) is kept out of the window by the turn controller.
    expect(events.map((e) => Object.keys(e).sort())).toEqual([
      ["detail", "edits", "id", "kind", "state", "type"],
      ["detail", "id", "kind", "state", "type"],
    ]);
    expect(events[0]).toEqual({ type: "activity", id: "w1", kind: "edit", detail: "a.md", edits: ["/w/a.md"], state: "start" });
  });
});

describe("claudeArgs noTools (sidekick spec §5)", () => {
  it("D0: without noTools the argv is exactly the old one", () => {
    // Literal argv from claudeArgs before noTools existed (eb3ec21~1), with master's reference folders through
    // --settings additionalDirectories instead of --add-dir (f2363fe).
    const mcpConfig = JSON.stringify({ mcpServers: { ui: { type: "stdio", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } } } });
    const head = [
      "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--setting-sources", "project", "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Glob,Grep,TodoWrite,Edit(./**),Write(./**),MultiEdit(./**),mcp__ui",
    ];
    const denied = "AskUserQuestion,Bash,WebSearch,WebFetch,Edit(.claude/**),Write(.claude/**),MultiEdit(.claude/**)";
    expect(claudeArgs({ session: { id: "abc", started: false }, mcp: [uiServer], permissions })).toEqual([
      ...head, "--disallowedTools", denied, "--strict-mcp-config", "--mcp-config", mcpConfig, "--session-id", "abc",
    ]);
    expect(claudeArgs({ session: { id: "abc", started: true }, mcp: [uiServer], permissions, references: ["/r"] })).toEqual([
      ...head, "--disallowedTools", `${denied},Edit(//r/**),Write(//r/**),MultiEdit(//r/**)`,
      "--strict-mcp-config", "--mcp-config", mcpConfig,
      "--settings", JSON.stringify({ permissions: { additionalDirectories: ["/r"] } }), "--resume", "abc",
    ]);
  });

  it("passes no tools, denies every built-in and loads no MCP server", () => {
    const args = claudeArgs({ session: { id: "abc", started: true }, mcp: [], permissions: { edit: "none", exec: false, web: false }, noTools: true });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--allowedTools");
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    for (const t of ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "WebSearch", "WebFetch", "Task", "TodoWrite"]) expect(denied).toContain(t);
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1])).toEqual({ mcpServers: {} });
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
  });

  it("refuses MCP servers or reference folders with noTools", () => {
    expect(() => claudeArgs({ session: { id: "a", started: false }, mcp: [uiServer], permissions, noTools: true })).toThrow(/no-tools/);
    expect(() => claudeArgs({ session: { id: "a", started: false }, mcp: [], permissions, references: ["/x"], noTools: true })).toThrow(/no-tools/);
  });
});

describe("edit paths (parallel spec §5.2)", () => {
  it("Edit, Write, MultiEdit and NotebookEdit name their file; nothing else does", () => {
    expect(editPaths("Edit", { file_path: "/w/a.md" })).toEqual(["/w/a.md"]);
    expect(editPaths("Write", { file_path: "/w/b.md" })).toEqual(["/w/b.md"]);
    expect(editPaths("MultiEdit", { file_path: "/w/c.md" })).toEqual(["/w/c.md"]);
    expect(editPaths("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual(["/w/n.ipynb"]);
    expect(editPaths("Read", { file_path: "/w/a.md" })).toEqual([]);
    expect(editPaths("Bash", { command: "rm x" })).toEqual([]);
    expect(editPaths("Edit", { file_path: 3 })).toEqual([]);
    expect(editPaths("Edit", { file_path: "" })).toEqual([]);
    expect(editPaths("toString", { file_path: "/w/a.md" })).toEqual([]);
    expect(editPaths("Edit", { file_path: `/w/${"x".repeat(5000)}` })).toEqual([]);
  });
  it("a tool named like an Object.prototype key is an 'other' activity, not an object", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "p1", name: "__proto__", input: {} }] } }));
    expect(events.find((e) => e.type === "activity")).toMatchObject({ kind: "other" });
  });
  it("puts them on the start event only", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/w/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1" }] } }));
    expect(events).toEqual([
      { type: "activity", id: "w1", kind: "edit", detail: "a.md", edits: ["/w/a.md"], state: "start" },
      { type: "activity", id: "w1", kind: "edit", detail: "a.md", state: "end", error: false },
    ]);
  });
  it("D0: a Read activity carries no edits (only master's context-panel `paths`)", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/w/a.md" } }] } }));
    expect(events).toEqual([{ type: "activity", id: "r1", kind: "read", detail: "a.md", paths: ["/w/a.md"], state: "start" }]);
  });
});

describe("linked folders (hatches spec §3.3, §3.5)", () => {
  const base = { session: { id: "a", started: false }, mcp: [], permissions };
  const scope = { linked: [
    { path: "/Users/me/code/app", mode: "write" as const, tracked: false },
    { path: "/Users/me/manuscript", mode: "read" as const, tracked: false },
  ] };
  const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf("--settings") + 1]);
  const denied = (args: string[]) => args[args.indexOf("--disallowedTools") + 1].split(",");
  const allowed = (args: string[]) => args[args.indexOf("--allowedTools") + 1].split(",");

  it("gives every linked folder file access through one --settings, after the references, never --add-dir", () => {
    const args = claudeArgs({ ...base, references: ["/opt/docs"], scope });
    expect(args).not.toContain("--add-dir");
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(settingsOf(args)).toEqual({ permissions: { additionalDirectories: ["/opt/docs", "/Users/me/code/app", "/Users/me/manuscript"] } });
  });

  it("denies edits in a read folder, as in a reference folder", () => {
    expect(denied(claudeArgs({ ...base, scope }))).toEqual(
      expect.arrayContaining(["Edit(//Users/me/manuscript/**)", "Write(//Users/me/manuscript/**)", "MultiEdit(//Users/me/manuscript/**)"]),
    );
    expect(allowed(claudeArgs({ ...base, scope }))).not.toContain("Edit(//Users/me/manuscript/**)");
  });

  it("allows edits in a write folder but denies its .claude and .git", () => {
    const args = claudeArgs({ ...base, scope });
    expect(allowed(args)).toEqual(expect.arrayContaining(["Edit(//Users/me/code/app/**)", "Write(//Users/me/code/app/**)", "MultiEdit(//Users/me/code/app/**)"]));
    for (const sub of [".claude", ".git"]) {
      for (const tool of ["Edit", "Write", "MultiEdit"]) expect(denied(args)).toContain(`${tool}(//Users/me/code/app/${sub}/**)`);
    }
    expect(denied(args)).not.toContain("Edit(//Users/me/code/app/**)");
  });

  it("a write folder under edit: none gets no allow rule (the manifest wins)", () => {
    const args = claudeArgs({ ...base, permissions: { edit: "none", exec: false, web: false }, scope });
    expect(allowed(args).some((t) => t.includes("/Users/me/code/app"))).toBe(false);
    expect(denied(args)).toContain("Edit");
  });

  const UNSAFE = [",", "(", ")", "*", "?", "[", "]", "{", "}", "\\", "\n", "\t", "\x00", "\x7f"];
  for (const mode of ["read", "write"] as const) {
    it.each(UNSAFE)(`refuses a ${mode} folder whose name has %j: no rule could spell it`, (ch) => {
      const linked = [{ path: `/Users/me/a${ch}b`, mode, tracked: false }];
      expect(() => claudeArgs({ ...base, scope: { linked } })).toThrow(/linked folder/);
    });
  }

  it("refuses a relative linked folder, and takes names with spaces, quotes and non-ASCII letters", () => {
    expect(() => claudeArgs({ ...base, scope: { linked: [{ path: "rel/dir", mode: "read", tracked: false }] } })).toThrow(/linked folder/);
    const fine = ["/Users/me/My Docs", "/Users/me/Ñandú 📚", "/Users/me/a\"b'c", "/Users/me/x/"];
    for (const p of fine) expect(ruleUnsafePath(p, "darwin"), p).toBe(false);
    const args = claudeArgs({ ...base, scope: { linked: [{ path: "/Users/me/My Docs", mode: "read", tracked: false }] } });
    expect(denied(args)).toContain("Edit(//Users/me/My Docs/**)");
  });

  it("ruleUnsafePath: a Windows path's backslashes are separators, not syntax", () => {
    expect(ruleUnsafePath("C:\\Users\\me\\notes", "win32")).toBe(false);
    expect(ruleUnsafePath("C:\\Users\\me\\notes[1]", "win32")).toBe(true);
    expect(ruleUnsafePath("/Users/me/a\\b", "darwin")).toBe(true);
  });

  it("a no-tools or MCP-only session refuses linked folders", () => {
    expect(() => claudeArgs({ ...base, noTools: true, scope })).toThrow(/linked/);
    expect(() => claudeArgs({ ...base, mcpOnly: true, scope })).toThrow(/linked/);
  });

  it("the transport reads the scope per turn: a link reaches the next turn, an unlink drops it", async () => {
    const { transport, args } = setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] });
    await transport.turn("one", () => {}, new AbortController().signal, undefined, scope);
    expect(settingsOf(args()).permissions.additionalDirectories).toEqual(["/Users/me/code/app", "/Users/me/manuscript"]);
    await transport.turn("two", () => {}, new AbortController().signal, undefined, { linked: [] });
    expect(args()).not.toContain("--settings");
  });
});

describe("claudeArgs with an engine preset (hatches spec §5.2)", () => {
  const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions };
  const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const preset: EnginePreset = {
    hash: "a".repeat(64),
    base: "isolated",
    settings: {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node ./t.js" }] }] },
      permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"] },
    },
    servers: [{ name: "scope-lint", command: "node", args: ["./lint.js"], env: {} }],
    pluginDir: "/u/engine-config/aaa/plugin",
    agentsFile: "/u/engine-config/aaa/agents.json",
  };

  it("one --settings: additionalDirectories plus the cleaned preset", () => {
    const args = claudeArgs({ ...o, references: ["/r"], scope: { linked: [{ path: "/l", mode: "read", tracked: false }], engine: preset } });
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(JSON.parse(argAfter(args, "--settings"))).toEqual({
      hooks: preset.settings!.hooks,
      permissions: { additionalDirectories: ["/r", "/l"], allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"] },
    });
  });

  it("a preset alone brings its settings without additionalDirectories; ask rules pass", () => {
    const engine = { ...preset, settings: { permissions: { ask: ["Bash(git push:*)"] } } };
    expect(JSON.parse(argAfter(claudeArgs({ ...o, scope: { linked: [], engine } }), "--settings"))).toEqual({ permissions: { ask: ["Bash(git push:*)"] } });
  });

  it("a preset without settings adds no --settings", () => {
    const { settings: _, ...engine } = preset;
    expect(claudeArgs({ ...o, scope: { linked: [], engine } })).not.toContain("--settings");
    expect(claudeArgs({ ...o, scope: { linked: [], engine: { ...engine, settings: { permissions: {} } } } })).not.toContain("--settings");
  });

  it("keeps preset mcp__ allow rules only for the preset's own servers (a global base would approve the person's)", () => {
    const allow = ["mcp__scope-lint", "mcp__scope-lint__run", "mcp__github", "mcp__github__push", "mcp__ui__show", "mcp__scope-other__x", "mcp__scope-lintx", "Read"];
    const engine = { ...preset, base: "global" as const, settings: { permissions: { allow, deny: ["mcp__github__push"] } } };
    expect(JSON.parse(argAfter(claudeArgs({ ...o, scope: { linked: [], engine } }), "--settings")).permissions).toEqual({
      allow: ["mcp__scope-lint", "mcp__scope-lint__run", "Read"],
      deny: ["mcp__github__push"],
    });
  });

  it("servers join --mcp-config after the core's", () => {
    const cfg = JSON.parse(argAfter(claudeArgs({ ...o, scope: { linked: [], engine: preset } }), "--mcp-config"));
    expect(Object.keys(cfg.mcpServers)).toEqual(["ui", "scope-lint"]);
    expect(cfg.mcpServers["scope-lint"]).toEqual({ type: "stdio", command: "node", args: ["./lint.js"], env: {} });
  });

  it("refuses a preset server that is not scope-<name> or takes a core server's name", () => {
    const bad = (name: string) => ({ ...preset, servers: [{ name, command: "node", args: [], env: {} }] });
    expect(() => claudeArgs({ ...o, scope: { linked: [], engine: bad("ui") } })).toThrow(/server/);
    expect(() => claudeArgs({ ...o, scope: { linked: [], engine: bad("lint") } })).toThrow(/server/);
    expect(() => claudeArgs({ ...o, mcp: [uiServer, { ...uiServer, name: "scope-lint" }], scope: { linked: [], engine: preset } })).toThrow(/server/);
  });

  it("refuses a preset that names one server twice", () => {
    const twice = { ...preset, servers: [...preset.servers, { name: "scope-lint", command: "sh", args: [], env: {} }] };
    expect(() => claudeArgs({ ...o, scope: { linked: [], engine: twice } })).toThrow(/scope-lint/);
  });

  it("skills and agents from the snapshot, after --settings and before the session flags", () => {
    const args = claudeArgs({ ...o, references: ["/r"], scope: { linked: [], engine: preset } });
    expect(argAfter(args, "--plugin-dir")).toBe(preset.pluginDir);
    expect(argAfter(args, "--agents")).toBe(preset.agentsFile);
    expect(args.indexOf("--settings")).toBeLessThan(args.indexOf("--plugin-dir"));
    expect(args.indexOf("--plugin-dir")).toBeLessThan(args.indexOf("--agents"));
    expect(args.indexOf("--agents")).toBeLessThan(args.indexOf("--session-id"));
    const { pluginDir: _p, agentsFile: _a, ...bare } = preset;
    const without = claudeArgs({ ...o, scope: { linked: [], engine: bare } });
    expect(without).not.toContain("--plugin-dir");
    expect(without).not.toContain("--agents");
  });

  it("isolated keeps --setting-sources project and --strict-mcp-config", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: preset } });
    expect(argAfter(args, "--setting-sources")).toBe("project");
    expect(args).toContain("--strict-mcp-config");
  });

  it("global flags on Claude: --setting-sources user,project and no --strict-mcp-config", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: { ...preset, base: "global" } } });
    expect(argAfter(args, "--setting-sources")).toBe("user,project");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
  });

  it("global keeps the folder's .mcp.json servers off: settings outrank user and project, and the agent can't write it", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: { ...preset, base: "global" } } });
    const settings = JSON.parse(argAfter(args, "--settings"));
    expect(settings.enableAllProjectMcpServers).toBe(false);
    expect(settings.enabledMcpjsonServers).toEqual([]);
    const denied = argAfter(args, "--disallowedTools").split(",");
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(denied).toContain(`${tool}(.mcp.json)`);
    // Even a preset with no settings at all gets them.
    const { settings: _, ...bare } = preset;
    const plain = JSON.parse(argAfter(claudeArgs({ ...o, scope: { linked: [], engine: { ...bare, base: "global" } } }), "--settings"));
    expect(plain).toEqual({ enableAllProjectMcpServers: false, enabledMcpjsonServers: [] });
  });

  it("isolated adds neither the .mcp.json settings nor its deny rules", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: preset } });
    expect(JSON.parse(argAfter(args, "--settings"))).not.toHaveProperty("enableAllProjectMcpServers");
    expect(argAfter(args, "--disallowedTools")).toBe(argAfter(claudeArgs(o), "--disallowedTools"));
  });

  it("refuses an unknown base", () => {
    const engine = { ...preset, base: "user" as unknown as "global" };
    expect(() => claudeArgs({ ...o, scope: { linked: [], engine } })).toThrow(/base/);
  });

  it("manifest denies over a preset allow: --disallowedTools is the harness's, unchanged", () => {
    const none = { ...permissions, edit: "none" as const };
    const engine = { ...preset, settings: { permissions: { allow: ["Edit", "Bash"] } } };
    const withPreset = claudeArgs({ ...o, permissions: none, scope: { linked: [], engine } });
    const without = claudeArgs({ ...o, permissions: none });
    expect(argAfter(withPreset, "--disallowedTools")).toBe(argAfter(without, "--disallowedTools"));
    expect(argAfter(withPreset, "--allowedTools")).toBe(argAfter(without, "--allowedTools"));
    expect(argAfter(withPreset, "--permission-mode")).toBe("default");
  });

  it("refuses a preset with noTools or mcpOnly", () => {
    expect(() => claudeArgs({ ...o, mcp: [], noTools: true, scope: { linked: [], engine: preset } })).toThrow(/engine preset/);
    expect(() => claudeArgs({ ...o, mcpOnly: true, scope: { linked: [], engine: preset } })).toThrow(/engine preset/);
  });

  it("refuses a preset path that reads as a flag or is relative", () => {
    for (const p of ["--dangerously-skip-permissions", "-x", "rel/plugin", ""]) {
      expect(() => claudeArgs({ ...o, scope: { linked: [], engine: { ...preset, pluginDir: p } } }), p).toThrow(/path/);
      expect(() => claudeArgs({ ...o, scope: { linked: [], engine: { ...preset, agentsFile: p } } }), p).toThrow(/path/);
    }
  });

  it("the transport passes the turn's preset; a turn without one runs without it", async () => {
    const { transport, args } = setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] });
    await transport.turn("one", () => {}, new AbortController().signal, undefined, { linked: [], engine: preset });
    expect(argAfter(args(), "--plugin-dir")).toBe(preset.pluginDir);
    await transport.turn("two", () => {}, new AbortController().signal, undefined, { linked: [] });
    expect(args()).not.toContain("--plugin-dir");
    expect(args()).not.toContain("--settings");
  });
});
