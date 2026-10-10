import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AcpScript, fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import { AcpTransport, type PermissionPolicy, decidePermission, isUiTool } from "../src/acp";
import type { Event } from "../src/events";
import type { Session } from "../src/transport";

const permissions = { edit: "folder" as "folder" | "none", exec: false, web: false };
let transport: AcpTransport | undefined;

afterEach(async () => {
  await transport?.close();
  transport = undefined;
});

function setup(scriptOrFn: AcpScript | ((folder: string) => AcpScript), session: Session = { id: "local-id", started: false }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  const script = typeof scriptOrFn === "function" ? scriptOrFn(folder) : scriptOrFn;
  const logFile = path.join(folder, "..", `log-${path.basename(folder)}.jsonl`);
  const started: Session[] = [];
  transport = new AcpTransport({
    folder,
    session,
    mcp: [{ name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } }],
    permissions,
    sessionMode: "workspace-write",
    command: fakeAcpCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_LOG: logFile },
    onSessionStarted: (s) => started.push(s),
  });
  const log = () =>
    fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: any })
      : [];
  return { transport, folder, started, log };
}

async function run(t: AcpTransport, message = "hi", signal = new AbortController().signal) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal);
  return events;
}

const chunk = (text: string) => ({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
const mcpCall = (id: string, server: string, tool: string) => ({
  update: {
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: `mcp.${server}.${tool}`,
    kind: "execute",
    status: "pending",
    rawInput: { server, tool, arguments: {} },
    _meta: { is_mcp_tool_call: true },
  },
});

describe("isUiTool", () => {
  it("recognizes ui MCP calls from Claude and Codex", () => {
    expect(isUiTool("mcp.ui.show_note", { server: "ui" })).toBe(true);
    expect(isUiTool("mcp__ui__update_progress", undefined)).toBe(true);
    expect(isUiTool("anything", { server: "ui", tool: "show_note" })).toBe(true);
    expect(isUiTool("mcp.notes.search", { server: "notes" })).toBe(false);
    expect(isUiTool("Run command", { command: "ls" })).toBe(false);
  });
});

describe("decidePermission", () => {
  const options = [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "always", name: "Always", kind: "allow_always" },
    { optionId: "cancel", name: "Cancel", kind: "reject_once" },
  ];
  const known = new Map<string, { server?: string }>([
    ["ui-1", { server: "ui" }],
    ["other-1", { server: "elsewhere" }],
  ]);
  const policy = (perms = permissions): PermissionPolicy => ({
    folder: "/work",
    permissions: perms,
    mcpServers: ["ui", "demo"],
    lookup: (id) => known.get(id),
  });
  const ask = (toolCall: Record<string, unknown>, extra: Record<string, unknown> = {}, perms = permissions) =>
    decidePermission({ sessionId: "s", toolCall: { toolCallId: "t", ...toolCall }, options, ...extra } as never, policy(perms));
  const chosen = (r: ReturnType<typeof decidePermission>) => (r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled");

  it("allows MCP approvals only for the harness's own servers, matched by toolCallId", () => {
    const meta = { _meta: { is_mcp_tool_approval: true } };
    expect(chosen(ask({ toolCallId: "ui-1", kind: "execute" }, meta))).toBe("allow");
    expect(chosen(ask({ toolCallId: "other-1", kind: "execute" }, meta))).toBe("cancel");
    expect(chosen(ask({ toolCallId: "unknown", kind: "execute" }, meta))).toBe("cancel");
  });

  it("allows edits inside the folder only", () => {
    expect(chosen(ask({ kind: "edit", locations: [{ path: "/work/a.md" }] }))).toBe("allow");
    expect(chosen(ask({ kind: "edit", locations: [{ path: "/etc/passwd" }] }))).toBe("cancel");
    expect(chosen(ask({ kind: "edit", locations: [{ path: "/work/../etc/x" }] }))).toBe("cancel");
    expect(chosen(ask({ kind: "edit", locations: [{ path: "/work/a.md" }] }, {}, { ...permissions, edit: "none" }))).toBe("cancel");
  });

  it("follows the manifest for commands, unknown kinds and web", () => {
    expect(chosen(ask({ kind: "execute", title: "Run command" }))).toBe("cancel");
    expect(chosen(ask({ kind: "execute" }, {}, { ...permissions, exec: true }))).toBe("allow");
    expect(chosen(ask({ kind: "other" }))).toBe("cancel");
    expect(chosen(ask({ kind: "fetch" }))).toBe("cancel");
    expect(chosen(ask({ kind: "fetch" }, {}, { ...permissions, web: true }))).toBe("allow");
  });

  it("never picks an 'always' option", () => {
    expect(chosen(ask({ kind: "read", locations: [{ path: "/work/x" }] }))).toBe("allow");
  });
});

describe("AcpTransport", () => {
  it("creates a session with cwd and MCP servers, sets the mode, then streams text", async () => {
    const { transport, folder, started, log } = setup({ sessionId: "agent-1", turns: [[chunk("Hello"), { stop: "end_turn" }]] });
    const events = await run(transport);
    expect(events).toEqual([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    expect(started).toEqual([{ id: "agent-1", started: true }]);
    const newSession = log().find((l) => l.method === "session/new")!;
    expect(newSession.params.cwd).toBe(folder);
    expect(newSession.params.mcpServers).toEqual([
      { name: "ui", command: "node", args: ["ui.js"], env: [{ name: "HH_BRIDGE", value: "/tmp/x.sock" }] },
    ]);
    expect(log().find((l) => l.method === "session/set_mode")?.params).toEqual({ sessionId: "agent-1", modeId: "workspace-write" });
  });

  it("reuses one agent process across turns", async () => {
    const { transport, log } = setup({ turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await run(transport);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(log().filter((l) => l.method === "session/prompt")).toHaveLength(2);
  });

  it("loads a started session and sets the mode again", async () => {
    const { transport, log } = setup({ loadSession: true, turns: [[chunk("again")]] }, { id: "old-1", started: true });
    await run(transport);
    expect(log().find((l) => l.method === "session/load")?.params.sessionId).toBe("old-1");
    expect(log().some((l) => l.method === "session/new")).toBe(false);
    expect(log().find((l) => l.method === "session/set_mode")?.params.sessionId).toBe("old-1");
  });

  it("approves ui MCP calls and refuses shell commands", async () => {
    const { transport, log } = setup({
      turns: [[
        mcpCall("m1", "ui", "show_note"),
        { permission: { toolCall: { toolCallId: "m1", kind: "execute", status: "pending" }, _meta: { is_mcp_tool_approval: true } } },
        { permission: { toolCall: { toolCallId: "x1", title: "Run command", kind: "execute", rawInput: { command: "rm -rf /" } } } },
      ]],
    });
    await run(transport);
    expect(log().filter((l) => l.method === "permission-outcome").map((l) => l.params)).toEqual([
      { outcome: "selected", optionId: "allow" },
      { outcome: "selected", optionId: "reject" },
    ]);
  });

  it("allows edits inside the real folder", async () => {
    const { transport, log } = setup((folder) => ({
      turns: [[{ permission: { toolCall: { toolCallId: "e1", title: "Write", kind: "edit", locations: [{ path: path.join(folder, "a.md") }] } } }]],
    }));
    await run(transport);
    expect(log().find((l) => l.method === "permission-outcome")?.params).toEqual({ outcome: "selected", optionId: "allow" });
  });

  it("reports activity, hides ui and think calls, and adds a paragraph after tools", async () => {
    const { transport } = setup({
      turns: [[
        chunk("Looking"),
        { update: { sessionUpdate: "tool_call", toolCallId: "g1", title: "Guardian Review", kind: "think", status: "pending" } },
        { update: { sessionUpdate: "tool_call", toolCallId: "r1", title: "Read notes/a.md", kind: "read", status: "pending" } },
        { update: { sessionUpdate: "tool_call_update", toolCallId: "r1", status: "completed" } },
        mcpCall("u1", "ui", "show_note"),
        { update: { sessionUpdate: "tool_call_update", toolCallId: "u1", status: "completed" } },
        chunk("Done"),
      ]],
    });
    const events = await run(transport);
    expect(events).toEqual([
      { type: "text", delta: "Looking" },
      { type: "activity", id: "r1", kind: "read", detail: "Read notes/a.md", state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "Read notes/a.md", state: "end", error: false },
      { type: "paragraph" },
      { type: "text", delta: "Done" },
      { type: "done", ok: true },
    ]);
  });

  it("reports token usage from the prompt response", async () => {
    const { transport } = setup({
      usage: { totalTokens: 62085, inputTokens: 5603, cachedReadTokens: 56320, cachedWriteTokens: 0, outputTokens: 162, thoughtTokens: 0 },
      turns: [[chunk("ok")]],
    });
    const events = await run(transport);
    expect(events.slice(-2)).toEqual([
      { type: "usage", inputTokens: 5603, outputTokens: 162, cacheReadTokens: 56320, cacheWriteTokens: 0 },
      { type: "done", ok: true },
    ]);
  });

  it("maps auth_required to session-expired", async () => {
    const { transport } = setup({ turns: [[{ error: { code: -32000, message: "Authentication required" } }]] });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
  });

  it("maps quota errors to out-of-quota", async () => {
    const { transport } = setup({ turns: [[{ error: { code: -32603, message: "You've hit your usage limit" } }]] });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "out-of-quota" } });
  });

  it("cancels through session/cancel", async () => {
    const { transport, log } = setup({ turns: [[{ sleep: 500 }, chunk("too late")]] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(log().some((l) => l.method === "session/cancel")).toBe(true);
  });

  it("reports a missing binary", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    transport = new AcpTransport({
      folder,
      session: { id: "x", started: false },
      mcp: [],
      permissions,
      command: [path.join(folder, "no-such-agent")],
      onSessionStarted: () => {},
    });
    const events = await run(transport);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed", detail: expect.any(String) } }]);
  });
});
