import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callRpc } from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { AgentTool, MainCtx } from "@humanharness/mod-sdk";
import { type HarnessWorkspace, createWorkspace, reviewAgent } from "@humanharness/runtime";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type HostDeps, ModHost } from "../../src/main/mods/host";
import { withModAgent } from "../../src/main/mods/wiring";

// The mods' agent side (mods-4 T2): `ctx.on.instructions` and `ctx.on.agentTools`, collected by the host from the mods
// that are on and merged after the core's own, as runtime-wiring hands them to each runtime.

const here = path.dirname(fileURLToPath(import.meta.url));
/** An agent that may edit the folder (the core adds the review tools). */
const REVIEWER = path.resolve(here, "../../../fake-agent/fixtures/review-harness/harness.config.ts");
const DEMO = path.resolve(here, "../../../../harnesses/demo/harness.config.ts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mod-agent-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const open: HarnessWorkspace[] = [];
afterEach(async () => {
  for (const ws of open.splice(0)) await ws.close();
  vi.restoreAllMocks();
});

async function host(over: Partial<HostDeps> = {}) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const saveFailed = vi.fn(async () => {});
  const h = new ModHost({ config: { load: async () => undefined, saveFailed }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), hookMs: 100, ...over });
  await h.start([]);
  return { h, saveFailed };
}

/** A runtime as the shell wires it: the core's agent side with the mods' after it. */
async function runtime(config: string, mods: () => ModHost | null | undefined) {
  const harness = await loadHarness(config);
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(dir, "Work");
  const argsFile = path.join(dir, "args.json");
  const core = reviewAgent(harness, async () => ({ id: "c1" }));
  const ws = await createWorkspace({
    harness,
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(dir, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: argsFile },
    ...(mods() === undefined ? core : withModAgent(core, harness, () => mods() ?? null)),
  });
  open.push(ws);
  /** A new slot's `ui` server env, as the engine was told to start it: the tools it lists and the channel it calls. */
  const ui = async (kind: "task" | "job", key: string = kind) => {
    const slot = await ws.openSlot({ key, kind });
    await slot.send("hi", () => {}).done;
    const argv = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    const env = (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: { ui: { env: Record<string, string> } } }).mcpServers.ui.env;
    const definitions = JSON.parse(env.HH_TOOLS_RPC_DEFS ?? "[]") as Record<string, unknown>[];
    return {
      definitions,
      names: definitions.map((d) => d.name),
      call: (tool: string, args: Record<string, unknown> = {}) => callRpc({ path: env.HH_TOOLS_RPC, token: env.HH_TOOLS_RPC_TOKEN }, { tool, args }),
    };
  };
  return { ws, ui, agents: () => fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8") };
}

const OBJECT = { type: "object", properties: { word: { type: "string" } }, required: ["word"] };
const tool = (name: string, over: Partial<AgentTool> = {}): AgentTool => ({ name, description: `Does ${name}.`, inputSchema: OBJECT, handle: (args) => ({ name, args }), ...over });

const guide = (id: string) => (ctx: MainCtx<unknown>) => {
  ctx.on.instructions!(() => ["", `### ${id} guide`, `Follow ${id}.`]);
  ctx.on.agentTools!(() => [tool(`${id}_ask`, { tasksOnly: true, timeoutError: "Late" }), tool(`${id}_note`)]);
};

describe("the mods' instructions()", () => {
  it("each mod's section reaches AGENTS.md after the core's own, in mod order", async () => {
    const { h } = await host();
    h.registerForTest("first", "First", guide("first"));
    h.registerForTest("second", "Second", (ctx) => {
      // Not led by a blank line, and asked for after a wait: both are the host's to handle.
      ctx.on.instructions!(async () => ["### second guide"]);
    });
    const { agents } = await runtime(REVIEWER, () => h);
    const text = agents();
    expect(text).toContain("\n\n### first guide\nFollow first.\n\n### second guide\n");
    expect(text.indexOf("### Writing for the reader")).toBeGreaterThan(-1);
    expect(text.indexOf("### first guide")).toBeGreaterThan(text.indexOf("### Writing for the reader"));
    expect(h.view().map((m) => m.registers.hooks)).toEqual([["instructions", "agentTools"], ["instructions"]]);
  });

  it("is told whether the agent may edit the folder, and so is agentTools()", async () => {
    for (const [config, canEdit] of [[REVIEWER, true], [DEMO, false]] as const) {
      const { h } = await host();
      const seen: unknown[] = [];
      h.registerForTest("m", "M", (ctx) => {
        ctx.on.instructions!((o) => (seen.push(["instructions", o]), []));
        ctx.on.agentTools!((o) => (seen.push(["agentTools", o]), []));
      });
      const { ui } = await runtime(config, () => h);
      await ui("task");
      expect(seen).toEqual([["instructions", { canEdit }], ["agentTools", { canEdit }]]);
    }
  });

  it("a mod turned off disappears on the next refresh, and its tools from the next slot", async () => {
    const { h } = await host();
    h.registerForTest("first", "First", guide("first"));
    const { ws, ui, agents } = await runtime(REVIEWER, () => h);
    const before = await ui("task", "a");
    expect(before.names).toContain("first_note");
    expect(await ws.refreshInstructions()).toBe(false);
    await h.set("first", false);
    // An open slot still lists the tool: the call is refused.
    await expect(before.call("first_note", { word: "x" })).rejects.toThrow('Mod "first" is off');
    expect(await ws.refreshInstructions()).toBe(true);
    expect(agents()).not.toContain("first guide");
    expect((await ui("task", "b")).names).not.toContain("first_note");
  });

  it.each([
    ["the demo", DEMO],
    ["an agent that may edit", REVIEWER],
  ])("with no mod, %s gets AGENTS.md and the tools byte for byte as without the hooks", async (_name, config) => {
    const plain = await runtime(config, () => undefined);
    const { h } = await host();
    h.registerForTest("other", "Other", (ctx) => void ctx.on.taskOpen(() => undefined));
    for (const mods of [() => null, () => h]) {
      const wired = await runtime(config, mods);
      expect(wired.agents()).toBe(plain.agents());
      expect((await wired.ui("task")).definitions).toEqual((await plain.ui("task", `p${open.length}`)).definitions);
      expect(await wired.ws.refreshInstructions()).toBe(false);
    }
  });

  it("a hook that throws, times out or answers something else is a strike and adds nothing; three turn the mod off", async () => {
    const { h, saveFailed } = await host();
    h.registerForTest("throws", "Throws", (ctx) => {
      ctx.on.instructions!(() => {
        throw new Error("boom");
      });
    });
    h.registerForTest("slow", "Slow", (ctx) => void ctx.on.instructions!(() => new Promise<string[]>(() => {})));
    h.registerForTest("shape", "Shape", (ctx) => void ctx.on.instructions!(() => ["fine", 1] as unknown as string[]));
    h.registerForTest("good", "Good", (ctx) => void ctx.on.instructions!(() => ["", "### Good"]));
    for (let i = 0; i < 3; i++) expect(await h.instructions({ canEdit: true })).toEqual([["", "### Good"]]);
    expect(saveFailed.mock.calls).toEqual([
      ["throws", "boom"],
      ["slow", "timed out after 100 ms"],
      ["shape", "instructions() must return a list of lines"],
    ]);
    expect(h.view().map((m) => m.on)).toEqual([false, false, false, true]);
  });
});

describe("the mods' agentTools()", () => {
  it("the ui server lists a mod's tools after the core's and its handler answers; a job never gets a tasksOnly one", async () => {
    const { h } = await host();
    h.registerForTest("first", "First", guide("first"));
    const { ui } = await runtime(REVIEWER, () => h);
    const task = await ui("task");
    expect(task.names).toEqual(["ask_in_document", "reply_to_comment", "read_review", "first_ask", "first_note"]);
    expect(task.definitions[3]).toEqual({ name: "first_ask", description: "Does first_ask.", inputSchema: OBJECT, tasksOnly: true, timeoutError: "Late" });
    await expect(task.call("first_ask", { word: "hi" })).resolves.toEqual({ name: "first_ask", args: { word: "hi" } });
    // The core's tools still reach the core's handler.
    await expect(task.call("read_review", { path: "a.md" })).resolves.toEqual({ id: "c1" });
    const job = await ui("job");
    expect(job.names).toEqual(["first_note"]);
    await expect(job.call("first_ask", { word: "hi" })).rejects.toThrow("Unknown tool");
  });

  it("a harness whose agent can't edit gets the mod's tools alone", async () => {
    const { h } = await host();
    h.registerForTest("first", "First", guide("first"));
    const { ui } = await runtime(DEMO, () => h);
    const task = await ui("task");
    expect(task.names).toEqual(["first_ask", "first_note"]);
    await expect(task.call("first_note", { word: "x" })).resolves.toEqual({ name: "first_note", args: { word: "x" } });
  });

  it("a hook that throws or times out is a strike and adds no tool", async () => {
    const { h, saveFailed } = await host();
    h.registerForTest("throws", "Throws", (ctx) => {
      ctx.on.agentTools!(() => {
        throw new Error("boom");
      });
    });
    h.registerForTest("slow", "Slow", (ctx) => void ctx.on.agentTools!(() => new Promise<AgentTool[]>(() => {})));
    h.registerForTest("good", "Good", (ctx) => void ctx.on.agentTools!(() => [tool("good")]));
    for (let i = 0; i < 3; i++) expect((await h.agentTools({ canEdit: true }, [])).map((t) => t.name)).toEqual(["good"]);
    expect(saveFailed.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["throws", "slow"]);
  });

  it("a tool the ui server can't take, or under a taken name, is left out and is a strike", async () => {
    const { h, saveFailed } = await host();
    h.registerForTest("first", "First", (ctx) => void ctx.on.agentTools!(() => [tool("mine")]));
    const bad: [string, unknown, string][] = [
      ["a", null, "agentTools(): a tool must be an object"],
      ["b", { ...tool("b"), name: "no spaces" }, 'agentTools(): "no spaces" is not a tool name'],
      ["c", { ...tool("c"), description: "" }, 'agentTools(): "c" needs a description'],
      ["d", { ...tool("d"), handle: undefined }, 'agentTools(): "d" needs a handle function'],
      ["e", { ...tool("e"), inputSchema: { type: "string" } }, 'agentTools(): "e" needs an inputSchema of type "object"'],
      ["f", { ...tool("f"), inputSchema: { type: "object", properties: { x: { type: "nothing" } } } }, 'agentTools(): "f"'],
      ["g", tool("mine"), 'agentTools(): the name "mine" is taken'],
      ["i", tool("read_review"), 'agentTools(): the name "read_review" is taken'],
    ];
    for (const [id, definition] of bad) h.registerForTest(id, id, (ctx) => void ctx.on.agentTools!(() => [definition as AgentTool, tool(`${id}_ok`)]));
    const names = async () => (await h.agentTools({ canEdit: true }, ["read_review"])).map((t) => t.name);
    // Each one's good tool is kept, until the third strike turns its mod off.
    for (let i = 0; i < 2; i++) expect(await names()).toEqual(["mine", ...bad.map(([id]) => `${id}_ok`)]);
    expect(await names()).toEqual(["mine"]);
    const reasons = new Map(saveFailed.mock.calls.map((c) => c as unknown as [string, string]));
    for (const [id, , reason] of bad) expect(reasons.get(id), id).toContain(reason);
    expect(h.view().filter((m) => m.on).map((m) => m.id)).toEqual(["first"]);
  });

  it("a mod's tool can't take a block's or job_result's name", async () => {
    const { h } = await host();
    h.registerForTest("m", "M", (ctx) => void ctx.on.agentTools!(() => [tool("show_choices"), tool("job_result"), tool("step_output"), tool("fine")]));
    const { ui } = await runtime(DEMO, () => h);
    expect((await ui("task")).names).toEqual(["fine"]);
  });

  it("a handler's throw reaches the agent; a user mod's throw or timeout counts, a core mod's does not", async () => {
    const { h } = await host();
    const failing = (id: string) => [tool(`${id}_throws`, { handle: () => Promise.reject(new Error(`${id} says no`)) }), tool(`${id}_hangs`, { handle: () => new Promise(() => {}) })];
    h.registerForTest("user", "User", (ctx) => void ctx.on.agentTools!(() => failing("user")));
    h.registerForTest("ours", "Ours", (ctx) => void ctx.on.agentTools!(() => failing("ours")), { core: true });
    const tools = await h.agentTools({ canEdit: true }, []);
    const call = (name: string) => tools.find((t) => t.name === name)!.handle({}) as Promise<unknown>;
    for (let i = 0; i < 3; i++) await expect(call("ours_throws")).rejects.toThrow("ours says no");
    await expect(call("user_throws")).rejects.toThrow("user says no");
    await expect(call("user_hangs")).rejects.toThrow("timed out after 100 ms");
    await expect(call("user_throws")).rejects.toThrow("user says no");
    expect(h.view().map((m) => m.on)).toEqual([false, true]);
    await expect(call("user_throws")).rejects.toThrow('Mod "user" is off');
  });
});
