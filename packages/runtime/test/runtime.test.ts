import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { OPENCODE_ENV, getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { allBlocks, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { ReviewRefused, managedSection } from "@humanharness/workspace";
import { ClaudeCliTransport } from "../src/claude-cli";
import type { Event } from "../src/events";
import { type HarnessRuntime, REVIEW_FAILED, type RuntimeOptions, createRuntime, reviewHandler } from "../src/runtime";
import { type Session, acpFields } from "../src/transport";

/** Sockets the runtime opened: a test can make the bridge's close fail and see the rpc's close. */
const sockets = vi.hoisted(() => ({ failBridgeClose: false, failRpcClose: false, rpcClosed: 0, rpcOpened: 0 }));
vi.mock("@humanharness/blocks", async (importOriginal) => {
  const blocks = await importOriginal<typeof import("@humanharness/blocks")>();
  return {
    ...blocks,
    openBridge: async (...args: Parameters<typeof blocks.openBridge>) => {
      const bridge = await blocks.openBridge(...args);
      return { ...bridge, close: () => (sockets.failBridgeClose ? bridge.close().then(() => Promise.reject(new Error("bridge"))) : bridge.close()) };
    },
    openRpc: async (...args: Parameters<typeof blocks.openRpc>) => {
      const rpc = await blocks.openRpc(...args);
      sockets.rpcOpened++;
      return {
        ...rpc,
        close: async () => {
          await rpc.close();
          sockets.rpcClosed++;
          if (sockets.failRpcClose) throw new Error("rpc");
        },
      };
    },
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const STUDY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
const READER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/material-harness/harness.config.ts");
const mcpServers = (argv: string[]) => Object.keys((JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: object }).mcpServers);
let runtime: HarnessRuntime | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});

async function setup(script: ClaudeScript, folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work"), extra: Partial<RuntimeOptions> = {}) {
  const argsFile = path.join(root, `args-${Date.now()}-${Math.random()}.json`);
  const prompts = path.join(root, `prompts-${Date.now()}-${Math.random()}.jsonl`);
  runtime = await createRuntime({
    harness: await loadHarness(FIXTURE),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(path.dirname(folder), "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_ARGS: argsFile, HH_FAKE_PROMPTS: prompts },
    ...extra,
  });
  const runs = () => fs.readFileSync(prompts, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
  return { runtime, folder, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], runs };
}

async function send(r: HarnessRuntime, message = "hi") {
  const events: Event[] = [];
  await r.send(message, (e) => events.push(e)).done;
  return events;
}

describe("createRuntime", () => {
  it("puts the settings' sentences in AGENTS.md, and rewrites it only when they change (harness-settings §5)", async () => {
    let sentences = ["Use a patient tone."];
    const { runtime, folder } = await setup({ steps: [] }, undefined, { instructionSettings: async () => sentences });
    const agents = () => fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents()).toContain("### How to work with this person\n\n- Use a patient tone.\n");
    expect(await runtime.refreshInstructions()).toBe(false);
    sentences = ["Use a demanding tone."];
    expect(await runtime.refreshInstructions()).toBe(true);
    expect(agents()).toContain("- Use a demanding tone.");
    expect(agents()).not.toContain("patient");
  });

  it("without settings, AGENTS.md is the base, today's managed section and the writing guide; a refresh writes nothing", async () => {
    const { runtime, folder } = await setup({ steps: [] });
    const harness = await loadHarness(FIXTURE);
    const base = fs.readFileSync(resolveInHarness(harness, harness.instructions), "utf8");
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(
      `${base.trimEnd()}\n\n${managedSection({ language: "en", blocks: allBlocks(harness), writing: { kinds: {} } })}`,
    );
    expect(await runtime.refreshInstructions()).toBe(false);
  });

  it("a harness's declared document kinds reach AGENTS.md (document-reader §4.2)", async () => {
    const harness = await loadHarness(FIXTURE);
    const withKinds = { ...harness, documents: { kinds: { adr: { when: "A decision with real alternatives.", sections: ["Status", "Decision"] } } } };
    const { folder } = await setup({ steps: [] }, undefined, { harness: withKinds });
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("### Document kinds");
    expect(agents).toContain("- `adr`: A decision with real alternatives.");
    expect(agents).toContain("      ## Decision");
  });

  it("a closed runtime never rewrites AGENTS.md, and close waits for a running refresh", async () => {
    let sentences = ["Use a patient tone."];
    let release: () => void = () => {};
    let gate: Promise<void> | null = null;
    const { runtime: rt, folder } = await setup({ steps: [] }, undefined, {
      instructionSettings: async () => {
        await gate;
        return sentences;
      },
    });
    // This test closes the runtime itself.
    runtime = undefined;
    // A refresh rewrites only AGENTS.md: the engine's own instructions file is static.
    const agents = () => fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    sentences = ["Use a demanding tone."];
    gate = new Promise((r) => (release = r));
    const refreshing = rt.refreshInstructions();
    let closed = false;
    const closing = rt.close().then(() => void (closed = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(false);
    release();
    await closing;
    expect(await refreshing).toBe(true);
    expect(agents()).toContain("demanding");
    sentences = ["Use a gentle tone."];
    expect(await rt.refreshInstructions()).toBe(false);
    expect(agents()).not.toContain("gentle");
  });

  it("enforces the engine's minAdapterVersion on ACP engines", async () => {
    const codex = getEngine("codex");
    if (codex.transport.kind !== "acp") throw new Error("codex must use ACP");
    const engine = {
      ...codex,
      transport: { kind: "acp" as const, command: fakeAcpCommand(), modes: codex.transport.modes, minAdapterVersion: "9.0.0" },
    };
    const folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work");
    runtime = await createRuntime({
      harness: await loadHarness(FIXTURE),
      engine,
      folder,
      gitdir: path.join(path.dirname(folder), "history.git"),
      language: "en",
      env: { HH_FAKE_SCRIPT: writeScript(root, { agentVersion: "2.2.2", turns: [[]] }) },
    });
    const events = await send(runtime);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "outdated-version" } });
  });

  it("prepares the folder: seed, AGENTS.md with managed section, CLAUDE.md", async () => {
    const { folder } = await setup({ steps: [] });
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("test harness");
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("You are a test assistant");
    expect(agents).toContain("`show_note`");
    expect(agents).toContain("Think and reason in English.");
    expect(fs.readFileSync(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });

  it("delivers blocks from the ui MCP server and commits the turn", async () => {
    const { runtime, folder } = await setup({
      steps: [
        ...claudeTextLines("Here is your note"),
        { mcp: { server: "ui", tool: "show_note", args: { title: "Groceries", body: "milk" } } },
        { write: { path: "notes/Groceries.md", content: "milk" } },
        claudeResultLine(true),
      ],
    });
    const events = await send(runtime, "make a note");
    expect(events).toContainEqual({ type: "block", name: "note", data: { title: "Groceries", body: "milk" } });
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(fs.readFileSync(path.join(folder, "notes/Groceries.md"), "utf8")).toBe("milk");
    expect((await runtime.history.list())[0].message).toBe("Turn: make a note");
  });

  it("rolls back the folder when the agent crashes mid-turn", async () => {
    const { runtime, folder } = await setup({
      steps: [{ write: { path: "README.md", content: "half-written" } }],
      stderr: "boom",
      exitCode: 1,
    });
    const events = await send(runtime);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("test harness");
  });

  it("keeps changes when the user cancels", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const turn = runtime.send("hi", () => {});
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect(fs.existsSync(path.join(folder, "kept.md"))).toBe(true);
  }, 10_000);

  it("sends a documents event before done for the .md files the turn wrote (document-reader §5.1)", async () => {
    const { runtime } = await setup({
      steps: [
        { write: { path: "docs/plan.md", content: "---\ntitle: The plan\n---\nGo." } },
        { write: { path: "src/a.ts", content: "x" } },
        ...claudeTextLines("ok"),
        claudeResultLine(true),
      ],
    });
    const events = await send(runtime, "plan it");
    expect(events.at(-2)).toEqual({ type: "documents", documents: [{ path: "docs/plan.md", title: "The plan", change: "new", words: 1 }] });
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("a failure listing the turn's documents still ends the turn well, with no documents event", async () => {
    const { runtime } = await setup({ steps: [{ write: { path: "plan.md", content: "x" } }, ...claudeTextLines("ok"), claudeResultLine(true)] });
    const changes = vi.spyOn(runtime.history, "changes").mockRejectedValue(new Error("boom"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await send(runtime);
    expect(changes).toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("Could not list the turn's documents", expect.any(Error));
    expect(events.some((e) => e.type === "documents")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    changes.mockRestore();
    logged.mockRestore();
  });

  it("D0: a turn that changes no .md sends no documents event; neither does a stopped one", async () => {
    const quiet = await setup({ steps: [{ write: { path: "src/a.ts", content: "x" } }, ...claudeTextLines("ok"), claudeResultLine(true)] });
    expect((await send(quiet.runtime)).some((e) => e.type === "documents")).toBe(false);
    await quiet.runtime.close();
    runtime = undefined;
    const stopped = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const events: Event[] = [];
    const turn = stopped.runtime.send("hi", (e) => events.push(e));
    while (!fs.existsSync(path.join(stopped.folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect(events.some((e) => e.type === "documents")).toBe(false);
  }, 10_000);

  it("tags the turn's commits with the task it belongs to", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "plan.md", content: "x" } }, ...claudeTextLines("ok"), claudeResultLine(true)] });
    fs.writeFileSync(path.join(folder, "mine.md"), "user edit");
    await runtime.send("plan the week", () => {}, { trailer: { task: "t1", action: "plan" } }).done;
    const [turn, before, start] = await runtime.history.list();
    expect(turn).toMatchObject({ message: "Turn: plan the week", task: "t1", action: "plan" });
    expect(before).toMatchObject({ message: "Before message", task: "t1", action: "plan" });
    expect(start).toMatchObject({ message: "Start", task: null });
  });

  it("tags a stopped turn's commit", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const turn = runtime.send("hi", () => {}, { trailer: { task: "t1" } });
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect((await runtime.history.list())[0]).toMatchObject({ message: "Stopped: hi", task: "t1", action: null });
  }, 10_000);

  it("tags a crashed turn's undo commit", async () => {
    const { runtime } = await setup({ steps: [{ write: { path: "README.md", content: "half-written" } }], stderr: "boom", exitCode: 1 });
    // The crashed turn's writes were never committed, so the undo usually records no commit: check what it is asked to record.
    const restore = vi.spyOn(runtime.history, "restore");
    await runtime.send("hi", () => {}, { trailer: { task: "t1", action: "plan" } }).done;
    expect(restore).toHaveBeenCalledWith(expect.any(String), "Undo: the turn did not finish", { task: "t1", action: "plan" });
  });

  it("commits user edits between turns and keeps them when the next turn crashes", async () => {
    const { runtime, folder } = await setup({
      steps: [{ write: { path: "README.md", content: "half-written" } }],
      stderr: "boom",
      exitCode: 1,
    });
    fs.writeFileSync(path.join(folder, "mine.md"), "user edit");
    const events = await send(runtime);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(fs.readFileSync(path.join(folder, "mine.md"), "utf8")).toBe("user edit");
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("test harness");
    expect((await runtime.history.list()).map((c) => c.message)).toContain("Before message");
  });

  it("emits exactly one failed done when history fails, and recovers on the next turn", async () => {
    const { runtime, folder } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] });
    const gitdir = path.join(path.dirname(folder), "history.git");
    fs.writeFileSync(path.join(folder, "mine.md"), "edit");
    const locked = [
      [gitdir, 0o500],
      [path.join(gitdir, "index"), 0o400],
      [path.join(gitdir, "refs/heads"), 0o500],
      [path.join(gitdir, "refs/heads/main"), 0o400],
    ] as const;
    const modes = locked.map(([p]) => (fs.existsSync(p) ? fs.statSync(p).mode & 0o777 : undefined));
    for (const [p, m] of locked) if (fs.existsSync(p)) fs.chmodSync(p, m);
    let events: Event[];
    try {
      events = await send(runtime);
    } finally {
      locked.forEach(([p], i) => modes[i] !== undefined && fs.chmodSync(p, modes[i]!));
    }
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    const next = await send(runtime);
    expect(next.filter((e) => e.type === "done")).toEqual([{ type: "done", ok: true }]);
  });

  it("close() during a turn cancels it and resolves", async () => {
    const { folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const events: Event[] = [];
    const turn = runtime!.send("hi", (e) => events.push(e));
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    await runtime!.close();
    await turn.done;
    expect(events.filter((e) => e.type === "done")).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    runtime = undefined;
  }, 10_000);

  it("continues the session it is given, reports new ones, and starts a fresh one after endSession", async () => {
    const reported: Session[] = [];
    const { runtime, folder, runs } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, undefined, {
      session: { id: "given-1", started: true },
      onSession: (s) => reported.push(s),
    });
    await send(runtime, "first");
    await runtime.endSession();
    await send(runtime, "second");
    const [one, two] = runs();
    expect([one.prompt, two.prompt]).toEqual(["first", "second"]);
    expect(one.argv[one.argv.indexOf("--resume") + 1]).toBe("given-1");
    const fresh = two.argv[two.argv.indexOf("--session-id") + 1];
    expect(fresh).not.toBe("given-1");
    expect(reported).toEqual([{ id: fresh, started: true }]);
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
  });

  it("refuses a turn while the session is being ended", async () => {
    const { runtime } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] });
    let release!: () => void;
    const spy = vi.spyOn(ClaudeCliTransport.prototype, "endSession").mockImplementation(() => new Promise<void>((r) => (release = r)));
    try {
      const ending = runtime.endSession();
      expect(() => runtime.send("now", () => {})).toThrow(/already running/);
      release();
      await ending;
    } finally {
      spy.mockRestore();
    }
    expect((await send(runtime)).at(-1)).toEqual({ type: "done", ok: true });
  });

  it("refuses to end the session during a turn", async () => {
    const { runtime } = await setup({ steps: [{ sleep: 2000 }] });
    const turn = runtime.send("one", () => {});
    await expect(runtime.endSession()).rejects.toThrow(/already running/);
    turn.cancel();
    await turn.done;
  });

  it("documents the core blocks and the reference folders, and lets Claude read those folders", async () => {
    const ref = fs.mkdtempSync(path.join(root, "ref-"));
    const { runtime, folder, args } = await setup({ steps: [...claudeTextLines("ok"), claudeResultLine(true)] }, undefined, {
      references: [{ label: "Source", path: ref }],
    });
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("`show_choices`");
    expect(agents).toContain("`save_note`");
    expect(agents).toContain(`- Source: \`${ref}\``);
    await send(runtime);
    expect(args()[args().indexOf("--add-dir") + 1]).toBe(ref);
  });

  it("delivers a save_note call as a block event", async () => {
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    const { runtime } = await setup({ steps: [{ mcp: { server: "ui", tool: "save_note", args: note } }, claudeResultLine(true)] });
    expect(await send(runtime)).toContainEqual({ type: "block", name: "save_note", data: note });
  });

  it("refuses a second turn while one is running", async () => {
    const { runtime } = await setup({ steps: [{ sleep: 2000 }] });
    const turn = runtime.send("one", () => {});
    expect(() => runtime.send("two", () => {})).toThrow(/already running/);
    turn.cancel();
    await turn.done;
  });

  it("starts no data server without data, or without a handler (D2)", async () => {
    const plain = await setup({ steps: [claudeResultLine(true)] }, undefined, { data: async (request) => request });
    await send(plain.runtime);
    expect(mcpServers(plain.args())).toEqual(["ui"]);
    await plain.runtime.close();
    const noHandler = await setup({ steps: [claudeResultLine(true)] }, undefined, { harness: await loadHarness(STUDY) });
    await send(noHandler.runtime);
    expect(mcpServers(noHandler.args())).toEqual(["ui"]);
  });

  it("starts the data server next to ui and sends the agent's data calls to the handler", async () => {
    const seen: unknown[] = [];
    const { runtime, args } = await setup(
      { steps: [{ mcp: { server: "data", tool: "data_put", args: { collection: "concepts", record: { id: "halves", name: "Halves", state: "seen", evidence: [] } } } }, claudeResultLine(true)] },
      undefined,
      {
        harness: await loadHarness(STUDY),
        data: async (request) => {
          seen.push(request);
          return request;
        },
      },
    );
    await send(runtime);
    expect(mcpServers(args())).toEqual(["ui", "data"]);
    expect(seen).toEqual([{ op: "put", collection: "concepts", record: { id: "halves", name: "Halves", state: "seen", evidence: [] } }]);
  });

  it("starts no material server without material in the manifest, and AGENTS.md has no Material part (material D0)", async () => {
    const { runtime, args, folder } = await setup({ steps: [claudeResultLine(true)] }, undefined, { material: { request: async () => "x" } });
    // Files where material would live are not tracked either: the keep list is today's.
    fs.mkdirSync(path.join(folder, ".harness", "material", "fractions"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "material", "fractions", "sources.json"), "[]\n");
    await send(runtime);
    expect(mcpServers(args())).toEqual(["ui"]);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).not.toContain("### Material");
    expect((await runtime.history.trackedFiles()).filter((f) => f.startsWith(".harness/"))).toEqual([]);
  });

  it("starts the material server in person mode with material, sends its calls to the handler, and keeps its registry", async () => {
    const seen: unknown[] = [];
    const folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work");
    const { runtime, args } = await setup(
      { steps: [{ mcp: { server: "material", tool: "material_read", args: { id: "ch2-001" } } }, claudeResultLine(true)] },
      folder,
      {
        harness: await loadHarness(READER),
        data: async () => null,
        material: {
          request: async (request) => {
            seen.push(request);
            fs.mkdirSync(path.join(folder, ".harness", "material", "fractions", "fragments"), { recursive: true });
            fs.writeFileSync(path.join(folder, ".harness", "material", "fractions", "sources.json"), "[]\n");
            fs.writeFileSync(path.join(folder, ".harness", "material", "fractions", "index.md"), "\n");
            return "x";
          },
        },
      },
    );
    await send(runtime);
    const servers = JSON.parse(args()[args().indexOf("--mcp-config") + 1]) as { mcpServers: Record<string, { env: Record<string, string> }> };
    expect(Object.keys(servers.mcpServers)).toEqual(["ui", "data", "material"]);
    expect(servers.mcpServers.material.env.HH_MATERIAL_MODE).toBe("person");
    expect(seen).toEqual([{ op: "read", id: "ch2-001" }]);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("### Material");
    const tracked = await runtime.history.trackedFiles();
    expect(tracked).toContain(".harness/material/fractions/sources.json");
    expect(tracked).not.toContain(".harness/material/fractions/index.md");
  });

  it("closes the data socket even when closing the ui bridge fails", async () => {
    const { runtime: r } = await setup({ steps: [claudeResultLine(true)] }, undefined, { harness: await loadHarness(STUDY), data: async () => null });
    runtime = undefined;
    const closed = sockets.rpcClosed;
    sockets.failBridgeClose = true;
    try {
      await expect(r.close()).rejects.toThrow("bridge");
    } finally {
      sockets.failBridgeClose = false;
    }
    expect(sockets.rpcClosed).toBe(closed + 1);
  });

  it("closes the material socket even when the earlier closes fail", async () => {
    const { runtime: r } = await setup({ steps: [claudeResultLine(true)] }, undefined, {
      harness: await loadHarness(READER),
      data: async () => null,
      material: { request: async () => null },
    });
    runtime = undefined;
    const closed = sockets.rpcClosed;
    sockets.failBridgeClose = true;
    sockets.failRpcClose = true;
    try {
      await expect(r.close()).rejects.toThrow();
    } finally {
      sockets.failBridgeClose = false;
      sockets.failRpcClose = false;
    }
    // The data socket's close failed, and the material socket still closed after it.
    expect(sockets.rpcClosed).toBe(closed + 2);
  });

  const uiEnv = (argv: string[]) =>
    (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: { ui: { env: Record<string, string> } } }).mcpServers.ui.env;

  it("with a review handler and an agent that edits the folder: review tools and guide lines (review §4)", async () => {
    const seen: unknown[] = [];
    const { runtime, folder, args } = await setup(
      {
        steps: [
          { write: { path: "spec.md", content: "## Scope\n\nBy size.\n" } },
          {
            mcp: {
              server: "ui",
              tool: "ask_in_document",
              args: { path: "spec.md", quote: "By size.", question: "Which?", options: [{ label: "A", text: "By size." }, { label: "B", text: "By colour." }] },
            },
          },
          claudeResultLine(true),
        ],
      },
      undefined,
      {
        review: async (request) => {
          seen.push(request);
          return { id: "c1" };
        },
      },
    );
    await send(runtime);
    expect(uiEnv(args()).HH_REVIEW_RPC).toBeTruthy();
    expect(seen).toEqual([expect.objectContaining({ op: "ask", path: "spec.md" })]);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("`ask_in_document`");
  });

  it("D0: no review channel without a handler, or for an agent that can't edit the folder", async () => {
    const plain = await setup({ steps: [claudeResultLine(true)] });
    await send(plain.runtime);
    expect(uiEnv(plain.args()).HH_REVIEW_RPC).toBeUndefined();
    expect(fs.readFileSync(path.join(plain.folder, "AGENTS.md"), "utf8")).not.toContain("ask_in_document");
    await plain.runtime.close();
    const readOnly = await setup({ steps: [claudeResultLine(true)] }, undefined, { harness: await loadHarness(READER), review: async () => null });
    await send(readOnly.runtime);
    expect(uiEnv(readOnly.args()).HH_REVIEW_RPC).toBeUndefined();
    expect(fs.readFileSync(path.join(readOnly.folder, "AGENTS.md"), "utf8")).not.toContain("ask_in_document");
  });

  it('D0: with edit "none" a review handler opens no socket and changes neither the ui env nor AGENTS.md', async () => {
    const run = async (extra: Partial<RuntimeOptions>) => {
      const opened = sockets.rpcOpened;
      const r = await setup({ steps: [claudeResultLine(true)] }, undefined, { harness: await loadHarness(READER), ...extra });
      await send(r.runtime);
      // The bridge's socket and token are new on every run; everything else must match byte for byte.
      const env = { ...uiEnv(r.args()), HH_BRIDGE: "<bridge>", HH_BRIDGE_TOKEN: "<token>" };
      const agents = fs.readFileSync(path.join(r.folder, "AGENTS.md"), "utf8");
      const servers = mcpServers(r.args());
      await r.runtime.close();
      runtime = undefined;
      return { env: JSON.stringify(env), agents, servers, opened: sockets.rpcOpened - opened };
    };
    const without = await run({});
    const withReview = await run({ review: async () => null });
    expect(withReview).toEqual(without);
    expect(withReview.opened).toBe(0);
  });
});

describe("reviewHandler", () => {
  it("passes the app's refusals to the agent, and a fixed line for any other error", async () => {
    const refused = reviewHandler(async () => {
      throw new ReviewRefused("spec.md has too many comments", "full");
    });
    await expect(refused({})).rejects.toThrow("spec.md has too many comments");
    const failed = reviewHandler(async () => {
      throw new Error("EACCES: /Users/someone/Work/.harness/reviews/spec.md.json");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await failed({}).catch((e: Error) => e);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("/Users");
    expect((err as Error).message).toBe(REVIEW_FAILED);
    const ok = reviewHandler(async (r) => ({ echo: r }));
    await expect(ok({ op: "read" })).resolves.toEqual({ echo: { op: "read" } });
  });
});

describe("acpFields", () => {
  it("gives OpenCode its modes and the config-option profile", () => {
    const engineEnv = { ...OPENCODE_ENV };
    expect(acpFields(getEngine("opencode"), "folder")).toEqual({ sessionMode: "build", minAdapterVersion: undefined, profileMethod: "config-option", engineEnv });
    expect(acpFields(getEngine("opencode"), "none")).toEqual({ sessionMode: "plan", minAdapterVersion: undefined, profileMethod: "config-option", engineEnv });
  });

  it("gives Codex and Claude no engine environment (D0)", () => {
    for (const id of ["codex", "claude"]) for (const edit of ["folder", "none"] as const) expect(acpFields(getEngine(id), edit)).not.toHaveProperty("engineEnv");
  });

  it("gives Codex what it had, and Claude nothing (D0)", () => {
    expect(acpFields(getEngine("codex"), "folder")).toEqual({ sessionMode: "workspace-write", minAdapterVersion: "2.2.2", profileMethod: undefined });
    expect(acpFields(getEngine("codex"), "none")).toEqual({ sessionMode: "read-only", minAdapterVersion: "2.2.2", profileMethod: undefined });
    expect(acpFields(getEngine("claude"), "folder")).toEqual({ sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined });
    expect(acpFields(getEngine("claude"), "none")).toEqual({ sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined });
  });
});
