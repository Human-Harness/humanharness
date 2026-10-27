import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type AcpScript, fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import type { ModelProfile } from "@humanharness/engines";
import { AcpTransport, type PermissionPolicy, activityDetail, codexConfig, decidePermission, isUiTool, offeredModels, usdCost } from "../src/acp";
import type { Event } from "../src/events";
import type { Session, TransportOptions } from "../src/transport";

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
  extra: { minAdapterVersion?: string; references?: string[]; onModels?: TransportOptions["onModels"]; profileMethod?: TransportOptions["profileMethod"] } = {},
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

async function run(t: AcpTransport, message = "hi", signal = new AbortController().signal, profile?: ModelProfile) {
  const events: Event[] = [];
  await t.turn(message, (e) => events.push(e), signal, profile);
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

describe("activityDetail", () => {
  const abs = "/Users/someone/work/repo/docs/architecture/manifest.md";
  it("shows the file name of a file tool from its locations or rawInput, like Claude's lines", () => {
    expect(activityDetail({ kind: "read", title: `Read file '${abs}'`, locations: [{ path: abs }] })).toBe("manifest.md");
    expect(activityDetail({ kind: "edit", title: "Edit", rawInput: { path: abs } })).toBe("manifest.md");
    expect(activityDetail({ kind: "read", title: "Read", rawInput: { parsed_cmd: [{ type: "read", path: abs }] } })).toBe("manifest.md");
  });

  it("falls back to the title without absolute paths or a repeated verb", () => {
    expect(activityDetail({ kind: "read", title: `Read file '${abs}'` })).toBe("manifest.md");
    expect(activityDetail({ kind: "read", title: "Read notes/a.md" })).toBe("a.md");
    expect(activityDetail({ kind: "search", title: `Search "defineHarness" in ${path.dirname(abs)}` })).toBe('Search "defineHarness" in architecture');
    expect(activityDetail({ kind: "search", title: "Search ~/work/repo/src for x" })).toBe("Search src for x");
    expect(activityDetail({ kind: "other", title: "List C:\\Users\\someone\\repo" })).toBe("List repo");
    expect(activityDetail({ kind: "fetch", title: "Fetch https://example.com/a/b" })).toBe("Fetch https://example.com/a/b");
    expect(activityDetail({ kind: "read", title: "Read the manifest" })).toBe("the manifest");
    expect(activityDetail({ kind: "read" })).toBe("");
  });

  it("never shows the home folder", () => {
    const cases = [
      { kind: "read", title: `Read file '${abs}'` },
      { kind: "search", title: `grep -rn x ${abs}` },
      { kind: "execute", title: `cat ${abs}`, locations: [{ path: abs }] },
    ];
    for (const c of cases) expect(activityDetail(c)).not.toContain("/Users/");
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
      { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "end", error: false },
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

const deep: ModelProfile = { engine: "codex", tier: "deep", model: "gpt-5.5", effort: "high", cap: 400_000 };
const light: ModelProfile = { engine: "codex", tier: "light", effort: "low", cap: 100_000 };
const MODEL_OPTIONS = [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "gpt-5.5",
    options: [
      { value: "gpt-5.5", name: "GPT-5.5", description: "Frontier model" },
      { value: "gpt-5.5-mini", name: "GPT-5.5 mini" },
      { value: "--bad", name: "Bad" },
    ],
  },
  { id: "reasoning_effort", name: "Effort", type: "select", currentValue: "medium", options: [{ value: "minimal", name: "Minimal" }, { value: "low", name: "Low" }, { value: "high", name: "High" }] },
];

describe("codexConfig", () => {
  it("writes only model, effort and cap; leaves model out for the engine default", () => {
    expect(JSON.parse(codexConfig(deep))).toEqual({ model: "gpt-5.5", model_reasoning_effort: "high", model_auto_compact_token_limit: 400_000 });
    expect(JSON.parse(codexConfig(light))).toEqual({ model_reasoning_effort: "low", model_auto_compact_token_limit: 100_000 });
    expect(() => codexConfig({ ...deep, model: "-x" })).toThrow(/flag/);
  });
});

describe("offeredModels", () => {
  it("reads the model and effort selects, flat or grouped, dropping unsafe ids and unknown efforts", () => {
    expect(offeredModels(MODEL_OPTIONS)).toEqual({
      models: [{ id: "gpt-5.5", name: "GPT-5.5", description: "Frontier model" }, { id: "gpt-5.5-mini", name: "GPT-5.5 mini" }],
      efforts: ["low", "high"],
    });
    const grouped = [{ id: "model", name: "Model", type: "select", currentValue: "a", options: [{ group: "g", name: "G", options: [{ value: "a", name: "A" }] }] }];
    expect(offeredModels(grouped)).toEqual({ models: [{ id: "a", name: "A" }], efforts: [] });
    expect(offeredModels(undefined)).toBeNull();
    expect(offeredModels([{ id: "mode", type: "select", options: [] }])).toBeNull();
  });
});

describe("AcpTransport profiles", () => {
  it("starts the agent with our CODEX_CONFIG, replacing an inherited one", async () => {
    process.env.CODEX_CONFIG = '{"sandbox_mode":"danger-full-access"}';
    try {
      const { transport, log } = setup({ turns: [[chunk("ok")]] });
      await run(transport, "hi", undefined, deep);
      const env = log().find((l) => l.method === "env")!.params;
      expect(JSON.parse(env.CODEX_CONFIG)).toEqual({ model: "gpt-5.5", model_reasoning_effort: "high", model_auto_compact_token_limit: 400_000 });
    } finally {
      delete process.env.CODEX_CONFIG;
    }
  });

  it("never passes an inherited CODEX_CONFIG to a turn without a profile", async () => {
    process.env.CODEX_CONFIG = '{"sandbox_mode":"danger-full-access"}';
    try {
      const { transport, log } = setup({ turns: [[chunk("ok")]] });
      await run(transport);
      expect(log().find((l) => l.method === "env")!.params.CODEX_CONFIG).toBeNull();
    } finally {
      delete process.env.CODEX_CONFIG;
    }
  });

  it("starts a fresh session, not a loaded one, when the profile changes without endSession", async () => {
    const { transport, log, started } = setup({ loadSession: true, sessionId: "s", turns: [[chunk("a")], [chunk("b")]] });
    await run(transport, "a", undefined, deep);
    const events = await run(transport, "b", undefined, light);
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(2);
    expect(log().some((l) => l.method === "session/load")).toBe(false);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
    expect(started).toHaveLength(2);
  });

  it("checks the model of a loaded session", async () => {
    const { transport, log } = setup({ loadSession: true, currentModelId: "gpt-5.5[high]", turns: [[chunk("never")]] }, { id: "old-1", started: true });
    const events = await run(transport, "hi", undefined, { ...deep, model: "gpt-9" });
    expect(log().filter((l) => l.method === "session/load")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    expect(log().filter((l) => l.method === "session/prompt")).toHaveLength(0);
  });

  it("reports the model of a loaded session with the usage", async () => {
    const { transport, log } = setup(
      { loadSession: true, currentModelId: "gpt-5.5[high]", usage: { inputTokens: 1, outputTokens: 1 }, turns: [[chunk("ok")]] },
      { id: "old-1", started: true },
    );
    const events = await run(transport, "hi", undefined, deep);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "usage", model: "gpt-5.5" }));
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("keeps the process while the profile stays, and starts a new one for another profile", async () => {
    const { transport, log } = setup({ closeSession: true, turns: [[chunk("a")], [chunk("b")], [chunk("c")]] });
    await run(transport, "a", undefined, deep);
    await run(transport, "b", undefined, deep);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    await transport.endSession();
    await run(transport, "c", undefined, light);
    const envs = log().filter((l) => l.method === "env").map((l) => JSON.parse(l.params.CODEX_CONFIG));
    expect(envs).toEqual([
      { model: "gpt-5.5", model_reasoning_effort: "high", model_auto_compact_token_limit: 400_000 },
      { model_reasoning_effort: "low", model_auto_compact_token_limit: 100_000 },
    ]);
  });

  it("reports the models the agent offers after session/new", async () => {
    const offers: unknown[] = [];
    const { transport, log } = setup({ configOptions: MODEL_OPTIONS, turns: [[chunk("ok")]] }, undefined, { onModels: (o) => offers.push(o) });
    await run(transport, "hi", undefined, deep);
    expect(offers).toEqual([offeredModels(MODEL_OPTIONS)]);
    // D0: Codex gets its profile through CODEX_CONFIG only.
    expect(log().filter((l) => l.method === "session/set_config_option")).toEqual([]);
  });

  it("reports the context in use, and one compaction per turn that never shows as activity", async () => {
    const { transport } = setup({
      turns: [
        [
          { update: { sessionUpdate: "tool_call", toolCallId: "c1", title: "Compact conversation", kind: "other", status: "in_progress" } },
          { update: { sessionUpdate: "compaction_update", compactionId: "k1", status: "completed" } },
          { update: { sessionUpdate: "usage_update", used: 42_000, size: 258_000 } },
          chunk("ok"),
        ],
      ],
    });
    const events = await run(transport);
    expect(events).toEqual([{ type: "compaction" }, { type: "context", used: 42_000, size: 258_000 }, { type: "text", delta: "ok" }, { type: "done", ok: true }]);
  });

  it("fails with model-unavailable when the session runs another model than the profile asked for", async () => {
    const { transport, log } = setup({ currentModelId: "gpt-5.5[high]", turns: [[chunk("never")]] });
    const events = await run(transport, "hi", undefined, { ...deep, model: "gpt-9" });
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    expect(log().filter((l) => l.method === "session/prompt")).toHaveLength(0);
  });

  it("accepts the requested model and reports it with the usage", async () => {
    const { transport } = setup({ currentModelId: "gpt-5.5[high]", usage: { inputTokens: 1, outputTokens: 1 }, turns: [[chunk("ok")]] });
    const events = await run(transport, "hi", undefined, deep);
    expect(events).toContainEqual(expect.objectContaining({ type: "usage", model: "gpt-5.5" }));
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });
});

describe("fake agent: session/set_config_option", () => {
  // OpenCode's shape (spike): a `mode` select, a `model` select with provider/model values, and an
  // `effort` select (category thought_level) only for a model with variants.
  const OPENCODE_OPTIONS = [
    { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "build", options: [{ value: "build", name: "build" }, { value: "plan", name: "plan" }] },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "ok/model",
      options: [{ value: "ok/model", name: "OK" }, { value: "bad/model", name: "Bad" }, { value: "local/plain", name: "Plain" }],
    },
  ];
  const variants = { "ok/model": ["low", "high"], "bad/model": ["high"] };

  // The transport keeps its connection open after the turn; reach it to send requests by hand.
  const set = (t: AcpTransport, configId: string, value: string) =>
    (t as unknown as { conn: { agent: { request: (m: string, p: unknown) => Promise<any> } } }).conn.agent.request("session/set_config_option", {
      sessionId: "fake-acp-session",
      configId,
      value,
    });
  const effortOf = (options: any[]) => options.find((o) => o.id === "effort");

  it("logs the request and refuses the values the script lists", async () => {
    const { log } = setup({ turns: [[{ stop: "end_turn" }]], configOptions: OPENCODE_OPTIONS, rejectConfigValues: ["bad/model"] });
    const t = transport!;
    await run(t);
    const res = await set(t, "model", "ok/model");
    expect(res.configOptions.find((o: any) => o.id === "model").currentValue).toBe("ok/model");
    await expect(set(t, "model", "bad/model")).rejects.toMatchObject({ code: -32602 });
    expect(log().filter((l) => l.method === "session/set_config_option").map((l) => l.params.value)).toEqual(["ok/model", "bad/model"]);
  });

  it("refuses an unknown option or value with -32602, like OpenCode", async () => {
    setup({ turns: [[{ stop: "end_turn" }]], configOptions: OPENCODE_OPTIONS });
    const t = transport!;
    await run(t);
    await expect(set(t, "model", "nobody/none")).rejects.toMatchObject({ code: -32602 });
    await expect(set(t, "reasoning_effort", "high")).rejects.toMatchObject({ code: -32602 });
    const res = await set(t, "mode", "plan");
    expect(res.configOptions.find((o: any) => o.id === "mode").currentValue).toBe("plan");
  });

  it("offers `effort` only for a model with variants: the variants plus default", async () => {
    const { log } = setup({ turns: [[{ stop: "end_turn" }]], configOptions: OPENCODE_OPTIONS, variants });
    const t = transport!;
    await run(t);
    const created = log().find((l) => l.method === "session/new");
    expect(created).toBeDefined();
    let res = await set(t, "effort", "low");
    expect(effortOf(res.configOptions)).toMatchObject({
      category: "thought_level",
      type: "select",
      currentValue: "low",
      options: [{ value: "low" }, { value: "high" }, { value: "default" }],
    });
    await expect(set(t, "effort", "max")).rejects.toMatchObject({ code: -32602 });
    // The new model lacks "low": the effort falls back to "default".
    res = await set(t, "model", "bad/model");
    expect(effortOf(res.configOptions)).toMatchObject({ currentValue: "default", options: [{ value: "high" }, { value: "default" }] });
    res = await set(t, "effort", "high");
    res = await set(t, "model", "ok/model");
    expect(effortOf(res.configOptions).currentValue).toBe("high");
    res = await set(t, "model", "local/plain");
    expect(effortOf(res.configOptions)).toBeUndefined();
    await expect(set(t, "effort", "default")).rejects.toMatchObject({ code: -32602 });
  });
});

// OpenCode's shape (spike): a `mode` select, a `model` select with provider/model values, and an
// `effort` select (category thought_level) for a model with variants.
const OPENCODE_MODEL = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "anthropic/claude-sonnet-4-5",
  options: [
    { value: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { value: "ollama/llama3.2:3b", name: "Llama 3.2" },
  ],
};
const OPENCODE_EFFORT = {
  id: "effort",
  name: "Variant",
  category: "thought_level",
  type: "select",
  currentValue: "medium",
  // `name` is required: the ACP SDK drops an option without one from a session/update.
  options: ["low", "medium", "high", "default"].map((v) => ({ value: v, name: v })),
};
const OPENCODE_CONFIG = [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "build", options: [{ value: "build", name: "build" }, { value: "plan", name: "plan" }] },
  OPENCODE_MODEL,
  OPENCODE_EFFORT,
];
const openProfile = (o: Partial<ModelProfile> = {}): ModelProfile => ({ engine: "opencode", tier: "standard", model: "ollama/llama3.2:3b", effort: "high", cap: 200_000, ...o });
const byConfig = { profileMethod: "config-option" as const };
const configSets = (log: () => { method: string; params: any }[]) =>
  log()
    .filter((l) => l.method === "session/set_config_option")
    .map((l) => [l.params.configId, l.params.value]);

describe("offeredModels: OpenCode", () => {
  it("reads provider/model ids and the effort select by id or thought_level category", () => {
    expect(offeredModels(OPENCODE_CONFIG)).toEqual({
      models: [
        { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        { id: "ollama/llama3.2:3b", name: "Llama 3.2" },
      ],
      efforts: ["low", "medium", "high"],
    });
    const byCategory = [OPENCODE_MODEL, { ...OPENCODE_EFFORT, id: "variant" }];
    expect(offeredModels(byCategory)?.efforts).toEqual(["low", "medium", "high"]);
  });

  it("reads Codex's options as before (D0)", () => {
    // codex-acp's session/new configOptions (spike 2026-10-10): mode, collaboration_mode, model, reasoning_effort.
    const codex = [
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "agent", options: [{ value: "read-only" }, { value: "workspace-write" }, { value: "agent" }] },
      { id: "collaboration_mode", name: "Collaboration", type: "select", currentValue: "default", options: [{ value: "default" }, { value: "plan" }] },
      ...MODEL_OPTIONS,
    ];
    expect(offeredModels(codex)).toEqual({
      models: [{ id: "gpt-5.5", name: "GPT-5.5", description: "Frontier model" }, { id: "gpt-5.5-mini", name: "GPT-5.5 mini" }],
      efforts: ["low", "high"],
    });
  });
});

describe("AcpTransport: profile by config option (OpenCode)", () => {
  it("sets the model and the effort after session/new, never CODEX_CONFIG", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(log().find((l) => l.method === "env")?.params.CODEX_CONFIG).toBeNull();
    expect(configSets(log)).toEqual([
      ["model", "ollama/llama3.2:3b"],
      ["effort", "high"],
    ]);
    const order = log().map((l) => l.method);
    expect(order.indexOf("session/set_config_option")).toBeGreaterThan(order.indexOf("session/new"));
    expect(order.indexOf("session/set_config_option")).toBeLessThan(order.indexOf("session/prompt"));
  });

  it("keeps the process and the session when the next turn's profile changes; sets only what changed", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }], [{ stop: "end_turn" }]] }, undefined, byConfig);
    await run(t, "one", undefined, openProfile());
    await run(t, "two", undefined, openProfile({ effort: "low" }));
    await run(t, "three", undefined, openProfile({ effort: "low" }));
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(1);
    expect(configSets(log)).toEqual([
      ["model", "ollama/llama3.2:3b"],
      ["effort", "high"],
      ["effort", "low"],
    ]);
  });

  it("sends no effort OpenCode does not offer, and no model for the default profile", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile({ model: undefined, effort: "max" }));
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(configSets(log)).toEqual([]);
  });

  it("does not send the effort the session already runs", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    await run(t, "hi", undefined, openProfile({ model: undefined, effort: "medium" }));
    expect(configSets(log)).toEqual([]);
  });

  it("fails with model-unavailable when the model is not offered, without sending it", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile({ model: "openai/gpt-9" }));
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    expect(configSets(log)).toEqual([]);
    expect(log().filter((l) => l.method === "session/prompt")).toEqual([]);
  });

  it("fails with model-unavailable when OpenCode refuses the model (-32602)", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, rejectConfigValues: ["ollama/llama3.2:3b"], turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    expect(log().filter((l) => l.method === "session/prompt")).toEqual([]);
  });

  it("fails with model-unavailable when OpenCode refuses the effort (-32602)", async () => {
    const { transport: t } = setup({ configOptions: OPENCODE_CONFIG, rejectConfigValues: ["high"], turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
  });

  it("starts a fresh session when a profile without a model follows one with a model", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] }, undefined, byConfig);
    await run(t, "one", undefined, openProfile());
    const events = await run(t, "two", undefined, openProfile({ model: undefined }));
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
  });

  it("refreshes the offer from config_option_update: a removed model is unavailable on the next turn", async () => {
    const onlySonnet = [{ ...OPENCODE_MODEL, options: [OPENCODE_MODEL.options[0]] }, OPENCODE_EFFORT];
    const offers: unknown[] = [];
    const { transport: t } = setup(
      {
        configOptions: OPENCODE_CONFIG,
        turns: [[{ update: { sessionUpdate: "config_option_update", configOptions: onlySonnet } }, { stop: "end_turn" }], [{ stop: "end_turn" }]],
      },
      undefined,
      { ...byConfig, onModels: (o) => offers.push(o) },
    );
    expect((await run(t, "one", undefined, openProfile())).at(-1)).toEqual({ type: "done", ok: true });
    expect(offers.at(-1)).toEqual({ models: [{ id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" }], efforts: ["low", "medium", "high"] });
    const second = await run(t, "two", undefined, openProfile({ effort: "low" }));
    expect(second.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
  });

  it("sets the effort a model with variants offers, after the model (OpenCode's variants)", async () => {
    const { transport: t, log } = setup(
      { configOptions: [OPENCODE_CONFIG[0], OPENCODE_MODEL], variants: { "ollama/llama3.2:3b": ["high"] }, turns: [[{ stop: "end_turn" }]] },
      undefined,
      byConfig,
    );
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(configSets(log)).toEqual([
      ["model", "ollama/llama3.2:3b"],
      ["effort", "high"],
    ]);
  });

  it("reports the model it set as the turn's model", async () => {
    const { transport: t } = setup({ configOptions: OPENCODE_CONFIG, usage: { inputTokens: 5, outputTokens: 2 }, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.find((e) => e.type === "usage")).toMatchObject({ model: "ollama/llama3.2:3b" });
  });

  it("sets the model and the effort on a loaded session, then prompts", async () => {
    const { transport: t, log } = setup(
      { loadSession: true, configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }]] },
      { id: "saved", started: true },
      byConfig,
    );
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(0);
    const order = log().map((l) => l.method);
    expect(order.indexOf("session/load")).toBeLessThan(order.indexOf("session/set_config_option"));
    expect(order.lastIndexOf("session/set_config_option")).toBeLessThan(order.indexOf("session/prompt"));
    expect(configSets(log)).toEqual([
      ["model", "ollama/llama3.2:3b"],
      ["effort", "high"],
    ]);
  });

  it("after endSession, a profile without a model keeps the process", async () => {
    const { transport: t, log } = setup({ closeSession: true, configOptions: OPENCODE_CONFIG, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] }, undefined, byConfig);
    await run(t, "one", undefined, openProfile());
    await t.endSession();
    expect((await run(t, "two", undefined, openProfile({ model: undefined }))).at(-1)).toEqual({ type: "done", ok: true });
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
  });

  it("reports OpenCode's default model when the profile names none", async () => {
    const { transport: t } = setup({ configOptions: OPENCODE_CONFIG, usage: { inputTokens: 5, outputTokens: 2 }, turns: [[{ stop: "end_turn" }]] }, undefined, byConfig);
    const events = await run(t, "hi", undefined, openProfile({ model: undefined }));
    expect(events.find((e) => e.type === "usage")).toMatchObject({ model: "anthropic/claude-sonnet-4-5" });
  });
});

const costUpdate = (amount: unknown, currency = "USD") => ({ update: { sessionUpdate: "usage_update", used: 1000, size: 200_000, cost: { amount, currency } } });
const usageOf = (events: Event[]) => events.find((e): e is Extract<Event, { type: "usage" }> => e.type === "usage");

describe("usdCost", () => {
  it("takes a finite, non-negative USD amount only", () => {
    expect(usdCost({ amount: 0.25, currency: "USD" })).toBe(0.25);
    expect(usdCost({ amount: 0, currency: "USD" })).toBe(0);
    expect(usdCost({ amount: 1, currency: "EUR" })).toBeUndefined();
    expect(usdCost({ amount: -1, currency: "USD" })).toBeUndefined();
    expect(usdCost({ amount: Number.NaN, currency: "USD" })).toBeUndefined();
    expect(usdCost({ amount: Number.POSITIVE_INFINITY, currency: "USD" })).toBeUndefined();
    expect(usdCost({ amount: "1", currency: "USD" })).toBeUndefined();
    expect(usdCost(null)).toBeUndefined();
    expect(usdCost(undefined)).toBeUndefined();
  });
});

describe("AcpTransport: cost per turn", () => {
  const usage = { inputTokens: 10, outputTokens: 5 };

  it("records the first turn's total and each later turn's increase", async () => {
    // Like OpenCode: the session's running total, sent once at the end of each prompt.
    const { transport: t } = setup({ usage, costs: [0.02, 0.05], turns: [[chunk("a")], [chunk("b")]] }, undefined, byConfig);
    expect(usageOf(await run(t, "one"))?.costUsd).toBeCloseTo(0.02);
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.03);
  });

  it("keeps the last total when a prompt sends several", async () => {
    const { transport: t } = setup({ usage, turns: [[costUpdate(0.01), costUpdate(0.02)]] }, undefined, byConfig);
    expect(usageOf(await run(t))?.costUsd).toBeCloseTo(0.02);
  });

  it("records 0 when the provider charges nothing", async () => {
    const { transport: t } = setup({ usage, costs: [0], turns: [[chunk("a")]] }, undefined, byConfig);
    expect(usageOf(await run(t))?.costUsd).toBe(0);
  });

  it("records no cost when the agent sends none, an invalid one or another currency", async () => {
    const { transport: t } = setup(
      {
        usage,
        turns: [[chunk("a")], [{ update: { sessionUpdate: "usage_update", used: 10, size: 100 } }], [costUpdate(1, "EUR")], [costUpdate(-1)]],
      },
      undefined,
      byConfig,
    );
    for (const m of ["one", "two", "three", "four"]) expect(usageOf(await run(t, m))).not.toHaveProperty("costUsd");
  });

  it("never reads a cost from Codex (D0)", async () => {
    const { transport: t } = setup({ usage, costs: [0.02, 0.05], turns: [[chunk("a")], [chunk("b")]] });
    for (const m of ["one", "two"]) expect(usageOf(await run(t, m))).not.toHaveProperty("costUsd");
  });

  it("a turn without a cost records none and keeps the baseline for the next one", async () => {
    const { transport: t } = setup({ usage, turns: [[costUpdate(0.02)], [chunk("b")], [costUpdate(0.05)]] }, undefined, byConfig);
    expect(usageOf(await run(t, "one"))?.costUsd).toBeCloseTo(0.02);
    expect(usageOf(await run(t, "two"))).not.toHaveProperty("costUsd");
    expect(usageOf(await run(t, "three"))?.costUsd).toBeCloseTo(0.03);
  });

  it("records no cost for a model whose context limit OpenCode does not know (no usage_update at all)", async () => {
    const { transport: t } = setup({ usage, turns: [[chunk("a")], [chunk("b")]] }, undefined, byConfig);
    expect(usageOf(await run(t, "one"))).not.toHaveProperty("costUsd");
    expect(usageOf(await run(t, "two"))).not.toHaveProperty("costUsd");
  });

  it("after loading a session, the first turn only sets the baseline", async () => {
    // OpenCode sends no usage_update on session/load: the total before this run is unknown.
    const { transport: t } = setup({ loadSession: true, usage, costs: [0.5, 0.8], turns: [[chunk("a")], [chunk("b")]] }, { id: "saved", started: true }, byConfig);
    expect(usageOf(await run(t, "one"))).not.toHaveProperty("costUsd");
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.3);
  });

  it("a new session starts from zero again", async () => {
    const { transport: t } = setup({ usage, closeSession: true, costs: [0.4, 0.1], turns: [[chunk("a")], [chunk("b")]] }, undefined, byConfig);
    await run(t, "one");
    await t.endSession();
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.1);
  });

  it("a total that went down records 0, not a negative cost", async () => {
    const { transport: t } = setup({ usage, costs: [0.4, 0.1], turns: [[chunk("a")], [chunk("b")]] }, undefined, byConfig);
    await run(t, "one");
    expect(usageOf(await run(t, "two"))?.costUsd).toBe(0);
  });
});

describe("AcpTransport: auth_required (OpenCode)", () => {
  it("maps -32000 on a prompt to session-expired and closes the process", async () => {
    const { transport: t, log } = setup(
      { turns: [[{ error: { code: -32000, message: "Authentication required" } }], [{ stop: "end_turn" }]] },
      undefined,
      byConfig,
    );
    const events = await run(t);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
    await run(t);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(2);
  });
});
