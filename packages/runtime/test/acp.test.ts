import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type AcpScript, fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import { AcpTransport, type PermissionPolicy, decidePermission, isUiTool } from "../src/acp";
import type { Event } from "../src/events";
import type { Session } from "../src/transport";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const permissions = { edit: "folder" as "folder" | "none", exec: false, web: false };
let transport: AcpTransport | undefined;

afterEach(async () => {
  await transport?.close();
  transport = undefined;
});

function setup(
  scriptOrFn: AcpScript | ((folder: string) => AcpScript),
  session: Session = { id: "local-id", started: false },
  extra: { minAdapterVersion?: string; references?: string[] } = {},
) {
  const folder = fs.mkdtempSync(path.join(root, "t-"));
  const script = typeof scriptOrFn === "function" ? scriptOrFn(folder) : scriptOrFn;
  const logFile = path.join(folder, "..", `log-${path.basename(folder)}.jsonl`);
  const started: Session[] = [];
  transport = new AcpTransport({
    folder,
    session,
    mcp: [{ name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } }],
    permissions,
    sessionMode: "workspace-write",
    ...extra,
    command: fakeAcpCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_LOG: logFile },
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

  it("does not trust a model-written rawInput.server", () => {
    expect(chosen(ask({ toolCallId: "ui-1", kind: "execute", rawInput: { server: "ui" } }))).toBe("cancel");
    expect(chosen(ask({ toolCallId: "t", kind: "execute", rawInput: { server: "ui" } }, { _meta: { is_mcp_tool_approval: true } }))).toBe("cancel");
  });

  it("rejects edits with no locations but allows reads with none", () => {
    expect(chosen(ask({ kind: "edit", locations: [] }))).toBe("cancel");
    expect(chosen(ask({ kind: "delete" }))).toBe("cancel");
    expect(chosen(ask({ kind: "read" }))).toBe("allow");
  });

  it("never picks an 'always' option", () => {
    expect(chosen(ask({ kind: "read", locations: [{ path: "/work/x" }] }))).toBe("allow");
  });

  it("allows reads in the reference folders but never edits there", () => {
    const withRefs: PermissionPolicy = { ...policy(), readRoots: ["/ref"] };
    const decide = (toolCall: Record<string, unknown>) =>
      chosen(decidePermission({ sessionId: "s", toolCall: { toolCallId: "t", ...toolCall }, options } as never, withRefs));
    expect(decide({ kind: "read", locations: [{ path: "/ref/docs/a.md" }] })).toBe("allow");
    expect(decide({ kind: "search", locations: [{ path: "/ref" }] })).toBe("allow");
    expect(decide({ kind: "read", locations: [{ path: "/work/a.md" }, { path: "/ref/b.md" }] })).toBe("allow");
    expect(decide({ kind: "read", locations: [{ path: "/elsewhere/a.md" }] })).toBe("cancel");
    expect(decide({ kind: "read", locations: [{ path: "/reference/a.md" }] })).toBe("cancel");
    expect(decide({ kind: "edit", locations: [{ path: "/ref/a.md" }] })).toBe("cancel");
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

  it("falls back to a new session when session/load fails for another reason", async () => {
    const { transport, log, started } = setup(
      { loadSession: true, failLoad: true, sessionId: "fresh-1", turns: [[chunk("hi")]] },
      { id: "old-1", started: true },
    );
    const events = await run(transport);
    expect(events).toEqual([{ type: "text", delta: "hi" }, { type: "done", ok: true }]);
    expect(log().some((l) => l.method === "session/new")).toBe(true);
    expect(started).toEqual([{ id: "fresh-1", started: true }]);
    expect(log().find((l) => l.method === "session/set_mode")?.params.sessionId).toBe("fresh-1");
  });

  it("shows an execute call titled like a ui tool when it lacks the trusted MCP flag", async () => {
    const { transport } = setup({
      turns: [[
        { update: { sessionUpdate: "tool_call", toolCallId: "x1", title: "mcp.ui.show_note", kind: "execute", status: "pending" } },
        { update: { sessionUpdate: "tool_call_update", toolCallId: "x1", status: "completed" } },
      ]],
    });
    const events = await run(transport);
    expect(events.filter((e) => e.type === "activity")).toHaveLength(2);
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
    const { transport, log } = setup({ turns: [[chunk("go"), { sleep: 500 }, chunk("too late")]] });
    const controller = new AbortController();
    const events: Event[] = [];
    await transport.turn("hi", (e) => {
      events.push(e);
      if (e.type === "text") controller.abort();
    }, controller.signal);
    expect(events).toEqual([{ type: "text", delta: "go" }, { type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(log().some((l) => l.method === "session/cancel")).toBe(true);
  });

  it("does not record a server for tool calls without the MCP meta", async () => {
    const { transport, log } = setup({
      turns: [[
        { update: { sessionUpdate: "tool_call", toolCallId: "f1", title: "Run", kind: "execute", rawInput: { server: "ui" } } },
        { permission: { toolCall: { toolCallId: "f1", kind: "execute" }, _meta: { is_mcp_tool_approval: true } } },
      ]],
    });
    const events = await run(transport);
    expect(events[0]).toMatchObject({ type: "activity", id: "f1" });
    expect(log().find((l) => l.method === "permission-outcome")?.params).toEqual({ outcome: "selected", optionId: "reject" });
  });

  it("kills an agent that ignores session/cancel after a grace period", async () => {
    const { transport } = setup({ turns: [[chunk("go"), { sleep: 20000, ignoreCancel: true }]] });
    const controller = new AbortController();
    const events: Event[] = [];
    let started = 0;
    await transport.turn("hi", (e) => {
      events.push(e);
      if (e.type === "text") {
        started = Date.now();
        controller.abort();
      }
    }, controller.signal);
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "cancelled" } });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(Date.now() - started).toBeGreaterThan(4000);
  }, 15000);

  it("does not send the prompt when aborted before the agent started", async () => {
    const { transport, log } = setup({ turns: [[chunk("never")]] });
    const controller = new AbortController();
    controller.abort();
    const events = await run(transport, "hi", controller.signal);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(log().some((l) => l.method === "session/prompt")).toBe(false);
  });

  it("fails with outdated-version when the adapter is older than required", async () => {
    const { transport, log } = setup({ agentVersion: "2.0.0", turns: [[chunk("x")]] }, undefined, { minAdapterVersion: "2.2.2" });
    const events = await run(transport);
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "outdated-version", detail: expect.any(String) } }]);
    expect(log().some((l) => l.method === "session/new")).toBe(false);
  });

  it("accepts an adapter at or above the required version", async () => {
    const { transport } = setup({ agentVersion: "2.10.0", turns: [[chunk("x")]] }, undefined, { minAdapterVersion: "2.2.2" });
    expect((await run(transport)).at(-1)).toEqual({ type: "done", ok: true });
  });

  it("uses the agent's stderr when it dies mid-turn", async () => {
    const { transport } = setup({ turns: [[{ crash: { stderr: "Error: Not logged in, run codex login\n" } }]] });
    const events = await run(transport);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired", detail: expect.stringContaining("Not logged in") } });
  });

  it("reports a missing binary", async () => {
    const folder = fs.mkdtempSync(path.join(root, "t-"));
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

  it("closes the session on endSession and opens a new one on the next turn, in the same process", async () => {
    const { transport, log, started } = setup({ closeSession: true, sessionId: "s", turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await transport.endSession();
    const events = await run(transport);
    expect(events).toEqual([{ type: "text", delta: "b" }, { type: "done", ok: true }]);
    expect(log().filter((l) => l.method === "session/close").map((l) => l.params.sessionId)).toEqual(["s"]);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(started.map((s) => s.id)).toEqual(["s", "s-2"]);
    expect(log().filter((l) => l.method === "session/set_mode").map((l) => l.params.sessionId)).toEqual(["s", "s-2"]);
  });

  it("closes the process when the agent doesn't offer session/close, so the next turn reconnects", async () => {
    const { transport, log } = setup({ turns: [[chunk("a")], [chunk("b")]] });
    await run(transport);
    await transport.endSession();
    expect(await run(transport)).toEqual([{ type: "text", delta: "a" }, { type: "done", ok: true }]);
    expect(log().some((l) => l.method === "session/close")).toBe(false);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(2);
  });

  it("gives up on a session/close that never answers and reconnects on the next turn", async () => {
    const { transport, log } = setup({ closeSession: true, hangClose: true, turns: [[chunk("a")]] });
    transport.sessionCloseTimeoutMs = 200;
    await run(transport);
    const t0 = Date.now();
    await transport.endSession();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(log().filter((l) => l.method === "session/close")).toHaveLength(1);
    expect((await run(transport)).at(-1)).toEqual({ type: "done", ok: true });
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(2);
  });

  it("does nothing on endSession before the first turn", async () => {
    const { transport, log } = setup({ closeSession: true, turns: [] });
    await transport.endSession();
    expect(log()).toEqual([]);
  });

  it("lets the agent read the reference folders", async () => {
    const { transport, log } = setup(
      { turns: [[{ permission: { toolCall: { toolCallId: "r1", kind: "read", locations: [{ path: "/ref/docs/a.md" }] } } }]] },
      undefined,
      { references: ["/ref"] },
    );
    await run(transport);
    expect(log().find((l) => l.method === "permission-outcome")?.params).toEqual({ outcome: "selected", optionId: "allow" });
  });
});
