import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { ClaudeCliTransport } from "../src/claude-cli";
import type { Event } from "../src/events";
import { type HarnessRuntime, type RuntimeOptions, createRuntime } from "../src/runtime";
import type { Session } from "../src/transport";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const STUDY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
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
    expect(agents).toContain("Always answer in English.");
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
});
