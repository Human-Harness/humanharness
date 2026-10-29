import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as blocks from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeResultLine, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness, z } from "@humanharness/harness-sdk";
import { TurnLedger } from "../src/turn-ledger";
import { type HarnessWorkspace, createWorkspace } from "../src/workspace";

// Counts the sockets a slot opens: a step slot opens none besides its bridge.
vi.mock("@humanharness/blocks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@humanharness/blocks")>();
  return { ...real, openRpc: vi.fn(real.openRpc), openBridge: vi.fn(real.openBridge) };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wsstep-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.resolve(here, "../../fake-agent/fixtures/data-harness/harness.config.ts");

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await ws?.close();
  ws = undefined;
});

type Servers = Record<string, { command: string; args: string[]; env: Record<string, string> }>;
type Jobs = NonNullable<LoadedHarness["jobs"]>;

const RECIPE = {
  label: "Triage",
  on: { manual: true },
  steps: [
    { tool: "count-notes", as: "counts" },
    { ai: "./jobs/triage.md", input: ["counts"], output: z.object({ ids: z.array(z.string()), again: z.boolean() }), tier: "light", as: "triage" },
  ],
};
const PROMPT_JOB = { label: "Sync", prompt: "./brief.md", tier: "light", on: { manual: true }, scope: "none" };

/**
 * A Claude workspace on fake-claude with everything a slot can reach: the data harness's data server, the tools server,
 * material, the review tools, two of the harness's own MCP servers, a reference folder and every permission.
 */
async function setup(jobs: Record<string, unknown>) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const args = path.join(base, "args.json");
  const catalogue = path.join(base, "tools-catalogue.json");
  fs.writeFileSync(catalogue, "[]");
  const loaded = await loadHarness(STUDY);
  const harness: LoadedHarness = {
    ...loaded,
    permissions: { edit: "folder", exec: true, web: true },
    mcp: ["mcp/one.js", "mcp/two.js"],
    tools: { "count-notes": "./tools/count-notes.ts" },
    material: {} as LoadedHarness["material"],
    jobs: jobs as Jobs,
  };
  ws = await createWorkspace({
    harness, engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
    language: "en", command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: args },
    data: async () => ({ records: [], total: 0 }),
    tools: { catalogue, request: async () => null },
    material: { request: async () => null },
    review: async () => null,
    references: [{ label: "Docs", path: "/opt/docs" }],
  });
  // HH_FAKE_ARGS keeps the last run's argv only.
  const run = () => {
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    const servers = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Servers;
    return { argv, servers, disallowed: argv[argv.indexOf("--disallowedTools") + 1].split(",") };
  };
  return { ws, run };
}

describe("a step slot (tools spec §7.1, R1)", () => {
  it("its MCP list is the ui server alone, with HH_STEP=<job> and HH_JOB empty", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    const { servers } = run();
    expect(Object.keys(servers)).toEqual(["ui"]);
    expect(servers.ui.env.HH_STEP).toBe("triage");
    expect(servers.ui.env.HH_JOB).toBe("");
  });

  it("no data, material, review or tools server and no harness MCP server, even when the harness has them", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    // The task slot shows the harness has them all.
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    const t = run();
    expect(Object.keys(t.servers)).toEqual(["ui", "data", "tools", "material", "study", "study-2"]);
    expect(Object.hasOwn(t.servers.ui.env, "HH_REVIEW_RPC")).toBe(true);

    const openRpc = vi.mocked(blocks.openRpc);
    openRpc.mockClear();
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    // Not even opened: no socket for a server the slot doesn't list.
    expect(openRpc).not.toHaveBeenCalled();
    const s = run();
    expect(Object.keys(s.servers)).toEqual(["ui"]);
    expect(Object.keys(s.servers.ui.env).filter((k) => k.startsWith("HH_REVIEW"))).toEqual([]);
  });

  it("permissions are edit none, exec false, web false, whatever the harness allows", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    expect(run().disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "MultiEdit", "Bash", "WebFetch", "WebSearch"]));
  });

  it("MCP only: no reading or searching the folder either, its one allowed server is ui", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    const { argv, disallowed } = run();
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("mcp__ui");
    expect(disallowed).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Task", "WebFetch"]));
  });

  it("no built-in tool at all: --tools \"\" on the step slot only, a task slot's argv has no --tools", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(run().argv).not.toContain("--tools");
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    const { argv } = run();
    expect(argv.indexOf("--tools")).toBeGreaterThan(-1);
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    // Its MCP server is still allowed: --tools turns off the built-ins only.
    expect(argv.indexOf("--tools")).toBeLessThan(argv.indexOf("--allowedTools"));
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("mcp__ui");
  });

  it("a step slot ignores permissions it is given: never wider than none", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage", permissions: { edit: "folder", exec: true, web: true } })).send("x", () => {}).done;
    expect(run().disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "Bash", "WebFetch"]));
  });

  it("no reference folders", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    // The task slot reads the reference folder through --settings.
    expect(run().argv.join(" ")).toContain("/opt/docs");
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    expect(run().argv.join(" ")).not.toContain("/opt/docs");
    expect(run().argv).not.toContain("--settings");
  });

  it("no scope: a linked folder sent with a turn never reaches the engine", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    const slot = await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" });
    await slot.send("x", () => {}, { scope: { linked: [{ path: "/Users/me/manuscript", mode: "read", tracked: false }] } }).done;
    expect(run().argv.join(" ")).not.toContain("/Users/me/manuscript");
    expect(run().argv).not.toContain("--settings");
  });

  it("task and job slots of a harness with a recipe clear HH_STEP", async () => {
    const { ws, run } = await setup({ triage: RECIPE, sync: PROMPT_JOB });
    // An outer HH_STEP can't make either one a step slot.
    vi.stubEnv("HH_STEP", "triage");
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(run().servers.ui.env.HH_STEP).toBe("");
    expect(run().servers.ui.env.HH_JOB).toBe("");
    await (await ws.openSlot({ key: "job:r1", kind: "job" })).send("y", () => {}).done;
    expect(run().servers.ui.env.HH_STEP).toBe("");
    expect(run().servers.ui.env.HH_JOB).toBe("1");
  });

  it("D0: without a recipe no slot's ui env has HH_STEP", async () => {
    const { ws, run } = await setup({ sync: PROMPT_JOB });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(Object.hasOwn(run().servers.ui.env, "HH_STEP")).toBe(false);
    expect(run().servers.ui.env.HH_JOB).toBe("");
    await (await ws.openSlot({ key: "job:r1", kind: "job" })).send("y", () => {}).done;
    expect(Object.hasOwn(run().servers.ui.env, "HH_STEP")).toBe(false);
    expect(run().servers.ui.env.HH_JOB).toBe("1");
  });

  it("kind step without job is refused", async () => {
    const { ws } = await setup({ triage: RECIPE });
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step" })).rejects.toThrow("A step slot needs its job");
  });

  it("kind step for a job without an AI step is refused", async () => {
    const { ws } = await setup({ triage: RECIPE, sync: PROMPT_JOB });
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step", job: "sync" })).rejects.toThrow('No AI step for job "sync"');
    await expect(ws.openSlot({ key: "step:r1:2", kind: "step", job: "constructor" })).rejects.toThrow('No AI step for job "constructor"');
    // Refused before anything opened: the key is free.
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).resolves.toBeDefined();
  });
});

/** A step slot on `engine` with a known parent for its folder; `script` is fake-claude's or fake-acp's. */
async function stepSetup(engine: "claude" | "codex", script: ClaudeScript | AcpScript) {
  const base = fs.mkdtempSync(path.join(root, "s-"));
  const parent = path.join(base, "steps");
  const work = path.join(base, "Work");
  const gitdir = path.join(base, "h.git");
  const log = path.join(base, "acp.jsonl");
  const loaded = await loadHarness(STUDY);
  ws = await createWorkspace({
    harness: { ...loaded, permissions: { edit: "folder", exec: true, web: true }, mcp: ["mcp/one.js"], jobs: { triage: RECIPE } as unknown as Jobs },
    engine: getEngine(engine), folder: work, gitdir, language: "en",
    command: engine === "claude" ? fakeClaudeCommand() : fakeAcpCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_LOG: log },
    data: async () => ({ records: [], total: 0 }),
    stepParent: parent,
  });
  const readLog = () => fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: any });
  const commits = () => Number(execFileSync("git", ["--git-dir", gitdir, "rev-list", "--all", "--count"], { encoding: "utf8" }).trim());
  return { ws, parent, work, readLog, commits };
}

describe("a step slot's own folder (tools spec §7.1, R1)", () => {
  it("Claude: the turn runs in a new empty folder, no AGENTS.md or CLAUDE.md, no window in the work folder; removed on close", async () => {
    const { ws, parent, work, commits } = await stepSetup("claude", { steps: [{ write: { path: "probe.txt", content: "x" } }, { sleep: 1500 }, claudeResultLine(true)] });
    const before = commits();
    const slot = await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" });
    const turn = slot.send("x", () => {}, { trailer: { task: "r1" } });
    // While it runs: the step's folder holds only what the turn wrote, and the work folder's ledger has no window.
    const deadline = Date.now() + 10_000;
    while (!fs.readdirSync(parent).some((d) => fs.existsSync(path.join(parent, d, "probe.txt"))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const dirs = fs.readdirSync(parent);
    expect(dirs).toHaveLength(1);
    expect(fs.readdirSync(path.join(parent, dirs[0]))).toEqual(["probe.txt"]);
    expect(TurnLedger.forFolder(work).running()).toEqual([]);
    expect(fs.existsSync(path.join(work, "probe.txt"))).toBe(false);
    await turn.done;
    // No history commit for a step's turn.
    expect(commits()).toBe(before);
    await slot.close();
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("the folder is removed when the slot closes during a turn (a stop)", async () => {
    const { ws, parent } = await stepSetup("claude", { steps: [{ sleep: 20_000 }, claudeResultLine(true)] });
    const slot = await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" });
    const turn = slot.send("x", () => {});
    expect(fs.readdirSync(parent)).toHaveLength(1);
    await slot.close();
    await turn.done;
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("the folder is removed when the workspace closes", async () => {
    const { ws, parent } = await stepSetup("claude", { steps: [claudeResultLine(true)] });
    await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" });
    expect(fs.readdirSync(parent)).toHaveLength(1);
    await ws.close();
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("D0: a task slot still runs in the work folder and opens its window", async () => {
    const { ws, parent, commits } = await stepSetup("claude", { steps: [{ write: { path: "probe.txt", content: "x" } }, claudeResultLine(true)] });
    const before = commits();
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(fs.existsSync(parent) ? fs.readdirSync(parent) : []).toEqual([]);
    expect(commits()).toBeGreaterThan(before);
  });

  it("ACP: an AI step runs only with Claude for now; refused before any folder or socket", async () => {
    // Codex's read-only sandbox still reads the whole disk and its shell doesn't ask: no step on an ACP engine.
    const { ws, parent } = await stepSetup("codex", { turns: [] });
    const openBridge = vi.mocked(blocks.openBridge);
    const openRpc = vi.mocked(blocks.openRpc);
    openBridge.mockClear();
    openRpc.mockClear();
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).rejects.toThrow("An AI step runs only with Claude for now");
    expect(openBridge).not.toHaveBeenCalled();
    expect(openRpc).not.toHaveBeenCalled();
    expect(fs.existsSync(parent)).toBe(false);
    // Task and job slots on the same engine open as before.
    await expect(ws.openSlot({ key: "t1" })).resolves.toBeDefined();
  });
});
