import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as blocks from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { type AgentToolSet, type HarnessWorkspace, type WorkspaceOptions, createWorkspace, reviewAgent } from "../src";

/** Each channel's handler, in the order the slots opened them. */
const opened = vi.hoisted(() => [] as ((request: unknown) => Promise<unknown>)[]);
vi.mock("@humanharness/blocks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@humanharness/blocks")>();
  return {
    ...real,
    openRpc: vi.fn(async (handler: (request: unknown) => Promise<unknown>) => {
      opened.push(handler);
      return real.openRpc(handler);
    }),
  };
});

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-agent-tools-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  await ws?.close();
  ws = undefined;
  opened.length = 0;
  vi.mocked(blocks.openRpc).mockClear();
});

async function setup(extra: Partial<WorkspaceOptions>) {
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(dir, "Work");
  const args = path.join(dir, "args.json");
  const w = await createWorkspace({
    harness: await loadHarness(FIXTURE),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(dir, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: args },
    ...extra,
  });
  ws = w;
  const uiEnv = async (kind: "task" | "job") => {
    await (await w.openSlot({ key: kind, kind })).send("hi", () => {}).done;
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    return (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: { ui: { env: Record<string, string> } } }).mcpServers.ui.env;
  };
  return { ws: w, uiEnv, agents: () => fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8") };
}

const tool = (name: string, tasksOnly?: boolean) => ({ name, description: name, inputSchema: { type: "object", properties: {} }, ...(tasksOnly ? { tasksOnly } : {}) });
const toolSet = (calls: unknown[]): AgentToolSet => ({
  definitions: [tool("ask", true), tool("note")],
  handle: async (name, args) => {
    calls.push([name, args]);
    return "ok";
  },
});

describe("the caller's instructions", () => {
  it("are asked at the start and on every refresh, in order, after the core's parts", async () => {
    let sections = [["", "### One"], ["", "### Two"]];
    const { ws, agents } = await setup({ instructions: () => sections });
    expect(agents()).toContain("\n\n### One\n\n### Two\n");
    expect(await ws.refreshInstructions()).toBe(false);
    sections = [["", "### Two"]];
    expect(await ws.refreshInstructions()).toBe(true);
    expect(agents()).not.toContain("### One");
  });

  it("D0: without them AGENTS.md has no writing guide", async () => {
    const { agents } = await setup({});
    expect(agents()).not.toContain("### Writing for the reader");
  });
});

describe("the caller's tools", () => {
  it("each slot is offered its own and its channel answers no other, whatever the request says", async () => {
    const calls: unknown[] = [];
    const { uiEnv } = await setup({ agentTools: toolSet(calls) });
    const names = (env: Record<string, string>) => (JSON.parse(env.HH_TOOLS_RPC_DEFS) as { name: string }[]).map((d) => d.name);
    expect(names(await uiEnv("task"))).toEqual(["ask", "note"]);
    expect(names(await uiEnv("job"))).toEqual(["note"]);
    const [task, job] = opened;
    await expect(task({ tool: "ask", args: { a: 1 } })).resolves.toBe("ok");
    await expect(job({ tool: "note" })).resolves.toBe("ok");
    for (const request of [{ tool: "ask", args: {} }, { tool: "other", args: {} }, {}, null]) {
      await expect(job(request)).rejects.toThrow("Unknown tool");
    }
    expect(calls).toEqual([["ask", { a: 1 }], ["note", {}]]);
  });

  it("a slot offered none opens no channel", async () => {
    const { uiEnv } = await setup({ agentTools: { definitions: [tool("ask", true)], handle: async () => null } });
    const env = await uiEnv("job");
    expect(Object.keys(env).filter((k) => k.startsWith("HH_TOOLS_RPC"))).toEqual([]);
    expect(blocks.openRpc).not.toHaveBeenCalled();
  });
});

describe("reviewAgent", () => {
  it("an `op` among a call's arguments never picks another request", async () => {
    const seen: unknown[] = [];
    const { agentTools } = reviewAgent(await loadHarness(FIXTURE), async (r) => void seen.push(r));
    await agentTools?.handle("read_review", { path: "a.md", op: "ask" });
    expect(seen).toEqual([{ op: "read", path: "a.md" }]);
  });
});
