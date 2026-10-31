import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeResultLine, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { AcpTransport } from "@humanharness/engines/registry";
import type { Event } from "../src/events";
import type { Session } from "../src/transport";
import { TurnLedger } from "../src/turn-ledger";
import { type HarnessWorkspace, createWorkspace } from "../src/workspace";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wss-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const readLog = (f: string) =>
  fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await ws?.close();
  ws = undefined;
});

/** A Codex workspace on fake-acp; returns the folder and the agent's request log. */
async function acpWorkspace(script: AcpScript | ((folder: string) => AcpScript), engine = "codex") {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(base, "Work");
  const log = path.join(base, "acp.jsonl");
  const written = writeScript(base, typeof script === "function" ? script(folder) : script);
  ws = await createWorkspace({
    harness: await loadHarness(FIXTURE), engine: getEngine(engine), folder, gitdir: path.join(base, "h.git"),
    language: "en", command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: written, HH_FAKE_LOG: log },
  });
  return { ws, folder, log: () => readLog(log) };
}

/** An ACP edit tool_call naming `file` (Codex puts the path in content[].diff.path, spike PT-S3). */
const editCall = (id: string, file: string) => ({
  sessionUpdate: "tool_call", toolCallId: id, title: "Edit", kind: "edit", status: "completed",
  content: [{ type: "diff", path: file, oldText: null, newText: "x" }],
});

describe("idle ACP slot (parallel spec §4, Decision 10)", () => {
  it("sleep() closes the adapter; the next turn starts a new process and loads the same session", async () => {
    const { ws, log } = await acpWorkspace({ loadSession: true, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] });
    const sessions: Session[] = [];
    const slot = await ws.openSlot({ key: "t1", onSession: (s) => sessions.push(s) });
    const first: Event[] = [];
    await slot.send("one", (e) => first.push(e)).done;
    await slot.sleep();
    expect(slot.isBusy()).toBe(false);
    const second: Event[] = [];
    await slot.send("two", (e) => second.push(e)).done;
    expect(first.at(-1)).toEqual({ type: "done", ok: true });
    expect(second.at(-1)).toEqual({ type: "done", ok: true });
    const methods = log().map((r) => r.method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(2);
    expect(methods.filter((m) => m === "session/new")).toHaveLength(1);
    const load = log().find((r) => r.method === "session/load");
    expect(load?.params?.sessionId).toBe("fake-acp-session");
    // The session started once; loading it reports no new one.
    expect(sessions).toEqual([{ id: "fake-acp-session", started: true }]);
  });

  it("the mode is set again on the loaded session after a sleep", async () => {
    const { ws, log } = await acpWorkspace({ loadSession: true, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] });
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("one", () => {}).done;
    await slot.sleep();
    await slot.send("two", () => {}).done;
    const methods = log().map((r) => r.method);
    const modes = log().filter((r) => r.method === "session/set_mode").map((r) => r.params);
    expect(modes).toEqual([
      { sessionId: "fake-acp-session", modeId: "workspace-write" },
      { sessionId: "fake-acp-session", modeId: "workspace-write" },
    ]);
    // The second set_mode comes after the load and before the prompt.
    const second = methods.lastIndexOf("session/set_mode");
    expect(methods.indexOf("session/load")).toBeLessThan(second);
    expect(second).toBeLessThan(methods.lastIndexOf("session/prompt"));
  });

  it("a failed load falls back to a fresh session, reported through onSession, with its mode set", async () => {
    const { ws, log } = await acpWorkspace({ loadSession: true, failLoad: true, sessionId: "fresh-1", turns: [[{ stop: "end_turn" }]] });
    const sessions: Session[] = [];
    const slot = await ws.openSlot({ key: "t1", session: { id: "old-1", started: true }, onSession: (s) => sessions.push(s) });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e)).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    const methods = log().map((r) => r.method);
    expect(log().find((r) => r.method === "session/load")?.params?.sessionId).toBe("old-1");
    expect(methods.indexOf("session/new")).toBeGreaterThan(methods.indexOf("session/load"));
    // The caller learns the session it saved is gone: onSession names the new one.
    expect(sessions).toEqual([{ id: "fresh-1", started: true }]);
    expect(log().filter((r) => r.method === "session/set_mode").map((r) => r.params)).toEqual([{ sessionId: "fresh-1", modeId: "workspace-write" }]);
  });

  it("an edit replayed while a session loads never reaches the window or the ledger; one in the turn does", async () => {
    const noteEdits = vi.spyOn(TurnLedger.prototype, "noteEdits");
    // onUpdate is private: spied through the prototype to prove the replay did reach the transport.
    const onUpdate = vi.spyOn(AcpTransport.prototype as unknown as { onUpdate: (u: Record<string, unknown>) => void }, "onUpdate");
    const { ws, log } = await acpWorkspace((folder) => ({
      loadSession: true,
      loadReplay: [editCall("old-edit", path.join(folder, "replayed.md"))],
      turns: [[{ update: editCall("new-edit", path.join(folder, "fresh.md")) }, { stop: "end_turn" }]],
    }));
    const slot = await ws.openSlot({ key: "t1", session: { id: "old-1", started: true } });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e)).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    // The session was loaded, and its replay delivered, before the turn's own update.
    expect(log().find((r) => r.method === "session/load")?.params?.sessionId).toBe("old-1");
    const updates = onUpdate.mock.calls.map(([u]) => u.toolCallId);
    expect(updates).toContain("old-edit");
    expect(updates.indexOf("old-edit")).toBeLessThan(updates.indexOf("new-edit"));
    const edits = events.flatMap((e) => (e.type === "activity" && e.edits ? e.edits : []));
    expect(edits.map((p) => path.basename(p))).toEqual(["fresh.md"]);
    const noted = noteEdits.mock.calls.flatMap(([, paths]) => [...paths]).map((p) => path.basename(p));
    expect(noted).toEqual(["fresh.md"]);
  });

  it("a closed slot runs no turn, ends no session and never reconnects the adapter", async () => {
    const { ws, log } = await acpWorkspace({ loadSession: true, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] });
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("one", () => {}).done;
    await slot.close();
    expect(() => slot.send("two", () => {})).toThrow("The slot is closed");
    await expect(slot.endSession()).rejects.toThrow("The slot is closed");
    await expect(slot.sleep()).resolves.toBeUndefined();
    const methods = log().map((r) => r.method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    expect(methods.filter((m) => m === "session/prompt")).toHaveLength(1);
  });

  it("Claude: sleep() does nothing", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    ws = await createWorkspace({
      harness: await loadHarness(FIXTURE), engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript) },
    });
    const slot = await ws.openSlot({ key: "t1" });
    await expect(slot.sleep()).resolves.toBeUndefined();
    expect(slot.isBusy()).toBe(false);
  });
});

describe("a turn's scope (hatches spec §3.3)", () => {
  it("send's scope reaches the transport each turn; a send without one passes none", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const args = path.join(base, "args.json");
    ws = await createWorkspace({
      harness: await loadHarness(FIXTURE), engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    // HH_FAKE_ARGS keeps the last run's argv only.
    const argv = () => JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("one", () => {}, { scope: { linked: [{ path: "/Users/me/manuscript", mode: "read", tracked: false }] } }).done;
    const first = argv();
    expect(JSON.parse(first[first.indexOf("--settings") + 1])).toEqual({ permissions: { additionalDirectories: ["/Users/me/manuscript"] } });
    await slot.send("two", () => {}).done;
    expect(argv()).not.toContain("--settings");
  });
});

describe("an engine preset's codex part (hatches spec §5.2)", () => {
  const engine = { hash: "a".repeat(64), base: "isolated" as const, servers: [], codex: { model_verbosity: "low" } };
  const codexConfigOf = (log: () => { method?: string; params?: Record<string, unknown> }[]) => log().find((r) => r.method === "env")?.params?.CODEX_CONFIG;

  it("reaches CODEX_CONFIG on Codex", async () => {
    const { ws, log } = await acpWorkspace({ turns: [[{ stop: "end_turn" }]] });
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("one", () => {}, { scope: { linked: [], engine } }).done;
    // The fixture harness has no web, so Codex's web search is off too (engines.md).
    expect(JSON.parse(codexConfigOf(log) as string)).toEqual({ model_verbosity: "low", web_search: "disabled" });
  });

  it("never reaches Kimi", async () => {
    const { ws, log } = await acpWorkspace({ turns: [[{ stop: "end_turn" }]] }, "kimi");
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("one", () => {}, { scope: { linked: [], engine } }).done;
    expect(codexConfigOf(log)).toBeNull();
  });
});

describe("job slots (Decision 11, T5)", () => {
  it("a job slot's ui server gets HH_JOB=1 and narrowed permissions; a task slot's specs are today's", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const args = path.join(base, "args.json");
    ws = await createWorkspace({
      // Two of the harness's own MCP servers besides ui: only ui may carry the job mark.
      harness: { ...(await loadHarness(FIXTURE)), permissions: { edit: "folder", exec: true, web: true }, mcp: ["mcp/one.js", "mcp/two.js"] },
      engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    // HH_FAKE_ARGS keeps the last run's argv only.
    const run = () => {
      const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
      const servers = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Record<string, { env: Record<string, string> }>;
      return { servers, argv, disallowed: argv[argv.indexOf("--disallowedTools") + 1].split(",") };
    };

    const task = await ws.openSlot({ key: "t1" });
    await task.send("x", () => {}).done;
    const t = run();
    expect(Object.hasOwn(t.servers.ui.env, "HH_JOB")).toBe(false);
    expect(t.disallowed).not.toContain("Bash");
    expect(t.disallowed).not.toContain("Edit");
    expect(t.disallowed).not.toContain("WebFetch");

    // A job asking for more than the harness allows (web stays true) still gets only what both allow.
    const job = await ws.openSlot({ key: "job:r1", kind: "job", permissions: { edit: "none", exec: false } });
    await job.send("y", () => {}).done;
    const j = run();
    expect(j.servers.ui.env.HH_JOB).toBe("1");
    expect(j.disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "Bash"]));
    expect(j.disallowed).not.toContain("WebFetch");
    // Only the ui server is marked; the other servers' specs are the task slot's.
    const { ui: _jobUi, ...jobRest } = j.servers;
    const { ui: _taskUi, ...taskRest } = t.servers;
    expect(Object.keys(jobRest)).toEqual(Object.keys(taskRest));
    expect(Object.keys(jobRest)).toHaveLength(2);
    for (const [name, spec] of Object.entries(jobRest)) expect(Object.hasOwn(spec.env, "HH_JOB"), name).toBe(false);
  });

  it("with jobs declared, a task slot's ui server gets HH_JOB empty, so an outer HH_JOB=1 can't turn it into a job", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const args = path.join(base, "args.json");
    const harness = await loadHarness(FIXTURE);
    ws = await createWorkspace({
      harness: { ...harness, jobs: { sync: { label: "Sync", prompt: "./brief.md", tier: "light", on: { manual: true }, scope: "none" } } },
      engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    const uiEnv = () => {
      const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
      return (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Record<string, { env: Record<string, string> }>).ui.env;
    };
    vi.stubEnv("HH_JOB", "1");
    const task = await ws.openSlot({ key: "t1" });
    await task.send("x", () => {}).done;
    expect(uiEnv().HH_JOB).toBe("");
    const job = await ws.openSlot({ key: "job:r1", kind: "job" });
    await job.send("y", () => {}).done;
    expect(uiEnv().HH_JOB).toBe("1");
  });

  it("a job slot can never widen the harness's permissions", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const args = path.join(base, "args.json");
    ws = await createWorkspace({
      harness: await loadHarness(FIXTURE), // edit folder, exec false, web false
      engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    const job = await ws.openSlot({ key: "job:r1", kind: "job", permissions: { exec: true, web: true } });
    await job.send("y", () => {}).done;
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    const disallowed = argv[argv.indexOf("--disallowedTools") + 1].split(",");
    expect(disallowed).toEqual(expect.arrayContaining(["Bash", "WebFetch"]));
    expect(disallowed).not.toContain("Edit");
  });
});

describe("a slot's seed for compactions (replaceable parts §7.2)", () => {
  it("lastContextUsed reaches the transport: a loaded session's first turn compares with it", async () => {
    const usage = (used: number) => ({ update: { sessionUpdate: "usage_update", used, size: 200_000 } });
    const { ws } = await acpWorkspace({ loadSession: true, turns: [[usage(40_000), { stop: "end_turn" }]] });
    const slot = await ws.openSlot({ key: "t1", session: { id: "old-1", started: true }, lastContextUsed: 100_000 });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e)).done;
    expect(events.filter((e) => e.type === "compaction" || e.type === "context")).toEqual([{ type: "compaction" }, { type: "context", used: 40_000, size: 200_000 }]);
  });
});
