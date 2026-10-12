import fs from "node:fs";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import type { CommandDeps } from "@humanharness/shell/tasks";
import { SharedConfigStore } from "@humanharness/shell/tasks";
import { UsageError } from "../src/cli";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { readyEngine, runTask } from "../src/run";
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
    expect(text).toContain("used about 3,840 tokens; cost hint says light");
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

  it("q stopped before the closing turn keeps the task open; the next q closes it", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const input = new PassThrough();
    const controller = new AbortController();
    let asked = 0;
    // When the first prompt is shown, type q and press Ctrl-C while the closing operation starts.
    const output = new Writable({
      write(chunk, _encoding, callback) {
        out.stream.write(chunk);
        if (String(chunk).includes("q to close the task") && ++asked === 1) {
          input.write("q\n");
          setImmediate(() => controller.abort());
        } else if (String(chunk).includes("still open")) input.end();
        callback();
      },
    });
    const report = await runTask({
      harnessDir,
      action: "example",
      folder: path.join(root, "work-stop"),
      input,
      output,
      signal: controller.signal,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    const text = out.text();
    expect(text).toContain("Stopped before the closing turn; the task is still open.");
    expect(text).toContain("Note: ");
    expect(Object.keys(report.phases)).toEqual(["run", "close"]);
  });

  it("refuses an unknown action and an engine the harness doesn't offer, before touching any engine", async () => {
    const base = { harnessDir, input: lines(""), output: memoryStream().stream };
    await expect(runTask({ ...base, action: "nope" })).rejects.toThrow(UsageError);
    await expect(runTask({ ...base, action: "example", engine: "gemini" })).rejects.toThrow(/not available/);
    await expect(runTask({ ...base, action: "nope" })).rejects.toThrow(/Actions: example/);
  });
});

describe("readyEngine", () => {
  it("stops with the app's message when the engine's CLI isn't there; nothing else is read", async () => {
    const deps: CommandDeps = {
      shell: "/bin/sh",
      home: root,
      run: async () => ({ stdout: "", code: 1 }),
      isExecutable: async () => false,
      electronPath: process.execPath,
      resolveModule: () => {
        throw new Error("not bundled");
      },
    };
    await expect(readyEngine(getEngine("claude"), deps, new SharedConfigStore(path.join(root, "shared")))).rejects.toThrow("I can't find Claude on this computer.");
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
