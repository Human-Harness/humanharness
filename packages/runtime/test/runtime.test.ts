import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import { type HarnessRuntime, createRuntime } from "../src/runtime";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");
let runtime: HarnessRuntime | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});

async function setup(script: ClaudeScript, folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")), "Work")) {
  const argsFile = path.join(os.tmpdir(), `args-${Date.now()}-${Math.random()}.json`);
  runtime = await createRuntime({
    harness: await loadHarness(DEMO),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(path.dirname(folder), "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(os.tmpdir(), script), HH_FAKE_ARGS: argsFile },
  });
  return { runtime, folder, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[] };
}

async function send(r: HarnessRuntime, message = "hi") {
  const events: Event[] = [];
  await r.send(message, (e) => events.push(e)).done;
  return events;
}

describe("createRuntime", () => {
  it("prepares the folder: seed, AGENTS.md with managed section, CLAUDE.md", async () => {
    const { folder } = await setup({ steps: [] });
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("demo app");
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
    expect(fs.readFileSync(path.join(folder, "README.md"), "utf8")).toContain("demo app");
  });

  it("keeps changes when the user cancels", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const turn = runtime.send("hi", () => {});
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect(fs.existsSync(path.join(folder, "kept.md"))).toBe(true);
  });

  it("persists the session and resumes it in the next runtime", async () => {
    const script: ClaudeScript = { steps: [...claudeTextLines("ok"), claudeResultLine(true)] };
    const first = await setup(script);
    await send(first.runtime);
    const firstId = first.args()[first.args().indexOf("--session-id") + 1];
    await first.runtime.close();

    const second = await setup(script, first.folder);
    await send(second.runtime);
    expect(second.args()[second.args().indexOf("--resume") + 1]).toBe(firstId);
  });

  it("refuses a second turn while one is running", async () => {
    const { runtime } = await setup({ steps: [{ sleep: 2000 }] });
    const turn = runtime.send("one", () => {});
    expect(() => runtime.send("two", () => {})).toThrow(/already running/);
    turn.cancel();
    await turn.done;
  });
});
