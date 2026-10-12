import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTICE_VERSION, getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import type { CommandDeps } from "@humanharness/shell/tasks";
import { SharedConfigStore } from "@humanharness/shell/tasks";
import { UsageError } from "../src/cli";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { type Interrupts, noticeMessage, readyEngine, runTask } from "../src/run";
import { CORE, memoryIo, memoryStream, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-run-");
afterAll(cleanup);
const harnessDir = path.join(root, "my-harness");
beforeAll(async () => {
  await initHarness({ dir: harnessDir, core: CORE, install: false });
});

const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
const script: ClaudeScript = {
  steps: [...claudeTextLines("Done."), result],
  turns: [
    {
      // The closing turn's core prompt names the save_note tool; the brief doesn't.
      match: "save_note",
      steps: [ui("save_note", { title: "First idea", summary: ["One idea worth keeping"], decisions: [], files: [], open: [] }), ...claudeTextLines("Saved."), result],
    },
    {
      match: "# Task: example",
      steps: [
        ...claudeTextLines("Hello, this harness is still being built."),
        ui("show_example_card", { title: "One idea", body: "Keep it short." }),
        ui("show_choices", { options: [{ label: "Go deeper", followUp: "Tell me more about that idea." }] }),
        result,
      ],
    },
    { match: "Tell me more", steps: [...claudeTextLines("Here is more."), result] },
  ],
};
const lines = (input: string) => {
  const s = new PassThrough();
  s.end(input);
  return s;
};
/** Ctrl-C presses the test makes, at points it chooses. */
function fakeInterrupts(): Interrupts & { press(): void; listeners(): number } {
  const emitter = new EventEmitter();
  return {
    on(listener) {
      emitter.on("interrupt", listener);
      return () => emitter.off("interrupt", listener);
    },
    press: () => emitter.emit("interrupt"),
    listeners: () => emitter.listenerCount("interrupt"),
  };
}
/** An output that copies into `out` and calls `seen` with each chunk, after it is kept. */
const watch = (out: ReturnType<typeof memoryStream>, seen: (text: string) => void) =>
  new Writable({
    write(chunk, _encoding, callback) {
      out.stream.write(chunk);
      seen(String(chunk));
      callback();
    },
  });
/** Command deps with no engine CLI anywhere; `calls` counts what ran. */
function noCli() {
  const cli = { calls: 0, deps: undefined as unknown as CommandDeps };
  cli.deps = {
    shell: "/bin/sh",
    home: root,
    run: async () => {
      cli.calls++;
      return { stdout: "", code: 1 };
    },
    isExecutable: async () => {
      cli.calls++;
      return false;
    },
    electronPath: process.execPath,
    resolveModule: () => {
      throw new Error("not bundled");
    },
  };
  return cli;
}
const readJsonl = (file: string) => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("runTask", () => {
  it("runs the task, follows a picked choice, closes on q with its note, and reports", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const folder = path.join(root, "work");
    const report = await runTask({
      harnessDir,
      action: "example",
      engine: "claude",
      folder,
      input: lines("1\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    const text = out.text();
    expect(text).toContain(`Folder: ${folder}`);
    expect(text).toContain("Hello, this harness is still being built.");
    expect(text).toContain("  [example_card]");
    expect(text).toContain('"title": "One idea"');
    expect(text).toContain("  1. Go deeper");
    expect(text).toContain("Pick 1–1, type a follow-up, or q to close the task:");
    expect(text).toContain("Here is more.");
    const note = path.join(folder, ".harness", "notes", "example.md");
    expect(text).toContain(`Note: ${note}`);
    expect(fs.readFileSync(note, "utf8")).toContain('title: "First idea"');

    expect(report).toMatchObject({ action: "example", cost: "light", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000, peakContext: 2100, notePath: note });
    const turn = { turns: 1, input: 1200, output: 80, cacheRead: 900, cacheWrite: 0 };
    expect(report.phases).toEqual({ run: turn, "follow-up": turn, close: turn });
    expect(text).toContain("used about 3,840 tokens (input+output, uncached), plus 2,700 cache read and 0 cache write; cost hint says light");
    expect(readJsonl(path.join(folder, ".harness", "usage.jsonl")).map((r) => r.phase)).toEqual(["run", "run", "close"]);
  });

  it("--tier overrides the action's tier; with no --folder it works in a new temp folder", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const report = await runTask({
      harnessDir,
      action: "example",
      tier: "light",
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    expect(report).toMatchObject({ tier: "light", model: "haiku", effort: "low", cap: 100_000 });
    expect(path.basename(report.folder)).toMatch(/^hh-run-my-harness-/);
    expect(Object.keys(report.phases)).toEqual(["run", "close"]);
    fs.rmSync(report.folder, { recursive: true, force: true });
  });

  it("Ctrl-C at the prompt closes the task like q, then removes its listener", { timeout: 60_000 }, async () => {
    const ctrlC = fakeInterrupts();
    const out = memoryStream();
    const output = watch(out, (text) => {
      if (text.includes("q to close the task")) ctrlC.press();
    });
    const report = await runTask({
      harnessDir,
      action: "example",
      folder: path.join(root, "work-ctrl-c"),
      input: new PassThrough(),
      output,
      interrupts: ctrlC,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    expect(out.text()).toContain(`Note: ${path.join(root, "work-ctrl-c", ".harness", "notes", "example.md")}`);
    expect(Object.keys(report.phases)).toEqual(["run", "close"]);
    expect(ctrlC.listeners()).toBe(0);
  });

  it("a second Ctrl-C, during the closing turn, cancels it: the task ends without a note and the report prints", { timeout: 60_000 }, async () => {
    // The closing turn is quiet (nothing reaches the terminal): it marks that it runs with a file, then waits
    // for a cancel. The test presses Ctrl-C when the marker appears.
    const marks = path.join(root, "marks");
    fs.mkdirSync(marks);
    const hanging: ClaudeScript = {
      ...script,
      turns: [
        { match: "We are closing this topic", steps: [{ write: { path: path.join(marks, "closing"), content: "" } }, { sleep: 120_000 }] },
        ...(script.turns ?? []).slice(1),
      ],
    };
    const ctrlC = fakeInterrupts();
    const watcher = fs.watch(marks, (_event, name) => {
      if (name === "closing") {
        watcher.close();
        ctrlC.press();
      }
    });
    const out = memoryStream();
    let prompts = 0;
    const output = watch(out, (text) => {
      if (text.includes("q to close the task")) {
        prompts++;
        ctrlC.press();
      }
    });
    const report = await runTask({
      harnessDir,
      action: "example",
      folder: path.join(root, "work-ctrl-c-twice"),
      input: new PassThrough(),
      output,
      interrupts: ctrlC,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, hanging) } },
    });
    const text = out.text();
    expect(prompts).toBe(1);
    expect(text).toContain("No note was saved.");
    expect(text).toContain("\nReport\n");
    expect(Object.keys(report.phases)).toEqual(["run", "close"]);
    expect(report.notePath).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(root, "work-ctrl-c-twice", ".harness", "tasks.json"), "utf8"))).toMatchObject({ current: null });
    expect(ctrlC.listeners()).toBe(0);
  });

  it("a closing note written over the checkpoint's file is reported as saved", { timeout: 60_000 }, async () => {
    const big = { line: { ...result.line, usage: { input_tokens: 170_000, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
    const note = (title: string) => ui("save_note", { title, summary: ["One point"], decisions: [], files: [], open: [] });
    const withCheckpoint = (close: ClaudeScript["steps"]): ClaudeScript => ({
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "Checkpoint: this conversation", steps: [note("Checkpoint idea"), ...claudeTextLines("Kept."), result] },
        { match: "We are closing this topic", steps: close },
        { match: "# Task: example", steps: [...claudeTextLines("A long first answer."), big] },
      ],
    });
    const folder = path.join(root, "work-checkpoint");
    const file = path.join(folder, ".harness", "notes", "example.md");
    const out = memoryStream();
    await runTask({
      harnessDir,
      action: "example",
      folder,
      input: lines("Tell me more\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, withCheckpoint([note("Final idea"), ...claudeTextLines("Saved."), result])) } },
    });
    expect(out.text()).toContain(`Note: ${file}`);
    expect(out.text()).not.toContain("No note was saved.");
    expect(fs.readFileSync(file, "utf8")).toContain('title: "Final idea"');

    const quiet = memoryStream();
    await runTask({
      harnessDir,
      action: "example",
      folder: path.join(root, "work-checkpoint-only"),
      input: lines("Tell me more\nq\n"),
      output: quiet.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, withCheckpoint([...claudeTextLines("Bye."), result])) } },
    });
    expect(quiet.text()).toContain(`The closing turn saved no note; the checkpoint's stands: ${path.join(root, "work-checkpoint-only", ".harness", "notes", "example.md")}`);
  });

  it("stops before making or printing a folder when the engine isn't ready", async () => {
    const tmp = path.join(root, "tmp-not-ready");
    fs.mkdirSync(tmp);
    const before = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    try {
      const out = memoryStream();
      await expect(
        runTask({ harnessDir, action: "example", engine: "claude", input: lines(""), output: out.stream, readiness: { deps: noCli().deps, shared: new SharedConfigStore(path.join(root, "shared-empty")) } }),
      ).rejects.toThrow(noticeMessage("Claude"));
      expect(os.tmpdir()).toBe(tmp);
      expect(fs.readdirSync(tmp)).toEqual([]);
      expect(out.text()).not.toContain("Folder:");
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
  });

  it("refuses an unknown action and an engine the harness doesn't offer, before touching any engine", async () => {
    const base = { harnessDir, input: lines(""), output: memoryStream().stream };
    await expect(runTask({ ...base, action: "nope" })).rejects.toThrow(UsageError);
    await expect(runTask({ ...base, action: "example", engine: "gemini" })).rejects.toThrow(/not available/);
    await expect(runTask({ ...base, action: "nope" })).rejects.toThrow(/Actions: example/);
  });
});

describe("readyEngine", () => {
  it("stops before touching the CLI when the app's notice wasn't accepted on this computer", async () => {
    const cli = noCli();
    await expect(readyEngine(getEngine("claude"), cli.deps, new SharedConfigStore(path.join(root, "shared-none")))).rejects.toThrow(noticeMessage("Claude"));
    expect(noticeMessage("Claude")).toContain("humanharness dev");
    expect(cli.calls).toBe(0);
  });

  it("with the notice accepted, stops with the app's message when the engine's CLI isn't there; nothing else is read", async () => {
    const shared = new SharedConfigStore(path.join(root, "shared"));
    await shared.update("claude", { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
    await expect(readyEngine(getEngine("claude"), noCli().deps, shared)).rejects.toThrow("I can't find Claude on this computer.");
  });
});

describe("humanharness run", () => {
  it("checks its command line before touching any engine", async () => {
    for (const args of [["run"], ["run", "a", "b"], ["run", "example", "--tier", "huge"], ["run", "example", "--language", "fr"], ["run", "nope"], ["run", "example", "--engine", "gemini"]]) {
      const m = memoryIo(harnessDir);
      expect(await main(args, m.io), args.join(" ")).toBe(2);
      expect(m.err()).not.toBe("");
      expect(m.err()).not.toContain("Unknown command");
    }
  });
});
