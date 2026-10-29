import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type HarnessWorkspace, type SlotRef, type WorkspaceOptions, createWorkspace } from "../src/workspace";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wst-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.resolve(here, "../../fake-agent/fixtures/data-harness/harness.config.ts");

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  await ws?.close();
  ws = undefined;
});

type Servers = Record<string, { command: string; args: string[]; env: Record<string, string> }>;

/** A Claude workspace on fake-claude with the data harness (its data server on) and two of the harness's own servers. */
async function setup(o: { tools?: Record<string, string>; script?: ClaudeScript; extra?: Partial<WorkspaceOptions> } = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const args = path.join(base, "args.json");
  const loaded = await loadHarness(STUDY);
  const harness: LoadedHarness = { ...loaded, mcp: ["mcp/one.js", "mcp/two.js"], ...(o.tools ? { tools: o.tools } : {}) };
  ws = await createWorkspace({
    harness, engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
    language: "en", command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, o.script ?? { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: args },
    data: async () => ({ records: [], total: 0 }),
    ...o.extra,
  });
  // HH_FAKE_ARGS keeps the last run's argv only.
  const run = () => {
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    const servers = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Servers;
    return { servers, allowed: argv[argv.indexOf("--allowedTools") + 1] };
  };
  return { ws, base, run };
}

/** A server list without its per-run sockets, tokens and paths: name, entry file and env keys, in order. */
const shape = (servers: Servers) => Object.entries(servers).map(([name, s]) => [name, path.basename(s.args.at(-1) ?? ""), Object.keys(s.env).sort()]);

/** The data harness's slot servers as this test recorded them before the tools server existed (D0). */
const BEFORE = [
  ["ui", "ui-server-bin.ts", ["HH_BRIDGE", "HH_BRIDGE_TOKEN", "HH_HARNESS"]],
  ["data", "data-server-bin.ts", ["HH_HARNESS", "HH_RPC", "HH_RPC_TOKEN"]],
  ["study", "one.js", []],
  ["study-2", "two.js", []],
];
const BEFORE_ALLOWED = "Read,Glob,Grep,TodoWrite,Edit(./**),Write(./**),MultiEdit(./**),mcp__ui,mcp__data,mcp__study,mcp__study-2";

const base0 = () => fs.mkdtempSync(path.join(root, "c-"));

function catalogue(base: string): string {
  const file = path.join(base, "tools-catalogue.json");
  fs.writeFileSync(file, JSON.stringify([{ name: "count-notes", description: "Counts the notes in the folder by tag.", inputSchema: { type: "object", properties: { tag: { type: "string" } } } }]));
  return file;
}

const COUNT = { "count-notes": "./tools/count-notes.ts" };

describe("the tools server in a slot (tools spec §5, Decision 9)", () => {
  it("D0: no tools, the slot's MCP list is unchanged", async () => {
    const { ws, run } = await setup();
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(shape(run().servers)).toEqual(BEFORE);
    expect(run().allowed).toBe(BEFORE_ALLOWED);
  });

  it("D0: a tools option for a harness without tools adds no server", async () => {
    const { ws, run } = await setup({ extra: { tools: { catalogue: catalogue(base0()), request: async () => null } } });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(shape(run().servers)).toEqual(BEFORE);
    expect(run().allowed).toBe(BEFORE_ALLOWED);
  });

  it("tools without agent: call add no server", async () => {
    // The app passes `tools` only when an agent: "call" tool exists (Task 9): a harness with tools but none the agent
    // may call opens its slots without the option, and they are today's.
    const { ws, run } = await setup({ tools: COUNT });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(shape(run().servers)).toEqual(BEFORE);
    expect(run().allowed).toBe(BEFORE_ALLOWED);
    const job = await ws.openSlot({ key: "job:r1", kind: "job" });
    await job.send("y", () => {}).done;
    expect(shape(run().servers).map(([n]) => n)).toEqual(["ui", "data", "study", "study-2"]);
  });

  it("a task slot and a job slot get the tools server; its rpc carries the slot's ref", async () => {
    const seen: { request: unknown; slot: SlotRef }[] = [];
    const dir = base0();
    const file = catalogue(dir);
    const { ws, run } = await setup({
      tools: COUNT,
      script: { steps: [{ mcp: { server: "tools", tool: "count-notes", args: { tag: "x" } } }, claudeResultLine(true)] },
      extra: { tools: { catalogue: file, request: async (request, slot) => (seen.push({ request, slot }), { count: 2 }) } },
    });

    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    const t = run();
    // Right after the data server; the engine allows its tools like any server's.
    expect(shape(t.servers)).toEqual([BEFORE[0], BEFORE[1], ["tools", "tools-server-bin.ts", ["HH_RPC", "HH_RPC_TOKEN", "HH_TOOLS"]], BEFORE[2], BEFORE[3]]);
    expect(t.servers.tools.env.HH_TOOLS).toBe(file);
    expect(t.allowed).toBe(`${BEFORE_ALLOWED.replace(",mcp__study", ",mcp__tools,mcp__study")}`);

    await (await ws.openSlot({ key: "job:r1", kind: "job" })).send("y", () => {}).done;
    const j = run();
    expect(j.servers.tools.env.HH_TOOLS).toBe(file);
    // Each slot has its own socket.
    expect(j.servers.tools.env.HH_RPC).not.toBe(t.servers.tools.env.HH_RPC);
    expect(seen).toEqual([
      { request: { tool: "count-notes", args: { tag: "x" } }, slot: { key: "t1" } },
      { request: { tool: "count-notes", args: { tag: "x" } }, slot: { key: "job:r1" } },
    ]);
  });

  it("closing the slot closes its tools socket", async () => {
    const dir = base0();
    const { ws, run } = await setup({ tools: COUNT, extra: { tools: { catalogue: catalogue(dir), request: async () => null } } });
    const slot = await ws.openSlot({ key: "t1" });
    await slot.send("x", () => {}).done;
    const sock = run().servers.tools.env.HH_RPC;
    expect(fs.existsSync(sock)).toBe(true);
    await slot.close();
    expect(fs.existsSync(sock)).toBe(false);
  });
});
