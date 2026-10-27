import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTICE_VERSION, getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, recordingSchema, writeScript } from "@humanharness/fake-agent";
import type { CommandDeps } from "@humanharness/shell/tasks";
import { SharedConfigStore } from "@humanharness/shell/tasks";
import { DATA_PREFIX, History, NOTES_PREFIX, TURN_PREFIX } from "@humanharness/workspace";
import { CliError, UsageError } from "../src/cli";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { type Interrupts, noticeMessage, parseSettings, readyEngine, runTask } from "../src/run";
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
  it("lets the agent write the scope's data through the data tools", { timeout: 60_000 }, async () => {
    const study = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness");
    const folder = path.join(root, "study-data");
    const record = { id: "halves", name: "Halves", state: "seen", evidence: [] };
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
        { match: "# Task: study", steps: [{ mcp: { server: "data", tool: "data_put", args: { collection: "concepts", record } } }, ...claudeTextLines("Saved it."), result] },
      ],
    };
    fs.mkdirSync(path.join(folder, ".harness", "data", "_app"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "data", "_app", "profile.json"), JSON.stringify({ name: "Ana", level: "6th grade" }));
    const prompts = path.join(root, "study-data-prompts.jsonl");
    await runTask({
      harnessDir: study,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: memoryStream().stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_PROMPTS: prompts } },
    });
    const first = readJsonl(prompts)[0] as { prompt: string };
    expect(first.prompt).toContain("## Data: profile\n\n| name | level |\n|---|---|\n| Ana | 6th grade |");
    const file = path.join(".harness", "data", "run", "concepts.json");
    expect(JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"))).toEqual([record]);

    // The turn's own commit holds the file: going back to it brings the file, going back to before it doesn't.
    const gitdir = path.join(os.tmpdir(), "humanharness-run-history", `study-${createHash("sha256").update(folder).digest("hex").slice(0, 12)}`);
    const copy = path.join(root, "study-data-history");
    fs.cpSync(gitdir, copy, { recursive: true });
    fs.rmSync(gitdir, { recursive: true, force: true });
    const check = path.join(root, "study-data-check");
    fs.mkdirSync(check);
    const history = new History(check, copy, [".harness/"], [NOTES_PREFIX, DATA_PREFIX]);
    const entries = await history.list();
    const turn = entries.findLastIndex((e) => e.message.startsWith(TURN_PREFIX));
    expect(entries[turn]).toMatchObject({ task: expect.any(String), action: "study", scope: "run" });
    await history.restore(entries[turn].sha, "check");
    expect(fs.existsSync(path.join(check, file))).toBe(true);
    await history.restore(entries[turn + 1].sha, "check");
    expect(fs.existsSync(path.join(check, file))).toBe(false);
  });

  it("runs a scoped harness's action in a `run` scope: its note, chat, usage and statuses are the scope's", { timeout: 60_000 }, async () => {
    const study = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness");
    const folder = path.join(root, "study-work");
    const scoped: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        {
          match: "save_note",
          steps: [ui("save_note", { title: "Halves", summary: ["A half is one of two parts"], decisions: [], files: [], open: [] }), ...claudeTextLines("Saved."), result],
        },
        { match: "# Task: study", steps: [...claudeTextLines("Let's study."), result] },
      ],
    };
    const out = memoryStream();
    await runTask({
      harnessDir: study,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, scoped) } },
    });
    expect(out.text()).toContain("Let's study.");
    expect(fs.readFileSync(path.join(folder, ".harness", "notes", "run", "study.md"), "utf8")).toContain('title: "Halves"');
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "scopes.json"), "utf8"))).toEqual([expect.objectContaining({ id: "run", title: "Run" })]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "run.jsonl"))).toBe(true);
    expect(readJsonl(path.join(folder, ".harness", "usage.jsonl")).every((r) => r.scope === "run")).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"))).toMatchObject({ open: "run", actions: {}, scopes: { run: { study: "done" } } });
  });

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
    for (const args of [["run"], ["run", "a", "b"], ["run", "example", "--tier", "huge"], ["run", "example", "--language", "not a tag"], ["run", "nope"], ["run", "example", "--engine", "gemini"], ["run", "example", "--force"]]) {
      const m = memoryIo(harnessDir);
      expect(await main(args, m.io), args.join(" ")).toBe(2);
      expect(m.err()).not.toBe("");
      expect(m.err()).not.toContain("Unknown command");
    }
  });

  it("takes any language tag: a bad one is refused, pt-BR is not", async () => {
    const bad = memoryIo(harnessDir);
    expect(await main(["run", "example", "--language", "not a tag"], bad.io)).toBe(2);
    expect(bad.err()).toContain('Unknown language "not a tag": use a language tag such as en, es or pt-BR.');
    const good = memoryIo(harnessDir);
    // pt-BR passes the language check and stops at a later one: the action doesn't exist.
    expect(await main(["run", "nope", "--language", "pt-BR"], good.io)).toBe(2);
    expect(good.err()).toContain('Unknown action "nope"');
    expect(good.err()).not.toContain("Unknown language");
  });
});

describe("run --record", () => {
  const engineCommand = () => ({ command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } });
  const mockFile = path.join(harnessDir, "mock", "example.json");

  it("writes mock/<action>.json from the run, and it replays", { timeout: 60_000 }, async () => {
    fs.rmSync(path.join(harnessDir, "mock"), { recursive: true, force: true });
    const out = memoryStream();
    await runTask({ harnessDir, action: "example", record: true, input: lines("1\nq\n"), output: out.stream, engineCommand: engineCommand() });
    const rec = JSON.parse(fs.readFileSync(mockFile, "utf8"));
    expect(recordingSchema.parse(rec)).toEqual(rec);
    expect(rec).toMatchObject({ version: 1, action: "example", match: "# Task: example", recordedWith: "claude" });
    expect(rec.turns.map((t: { id: string }) => t.id)).toEqual(["t1", "t2", "close"]);
    expect(rec.turns[0].blocks.map((b: { tool: string }) => b.tool)).toEqual(["show_example_card", "show_choices"]);
    // The app's generated instruction files (AGENTS.md holds absolute paths) never end up in a recording.
    const written = rec.turns.flatMap((t: { writes: { path: string }[] }) => t.writes.map((w) => w.path));
    expect(written.filter((p: string) => ["AGENTS.md", "CLAUDE.md"].includes(p) || p.startsWith(".claude") || p.startsWith(".harness"))).toEqual([]);
    expect(rec.turns[0].next).toEqual({ "Go deeper": "t2" });
    expect(rec.turns[2].note.title).toBe("First idea");
    expect(out.text()).toContain(`Recorded: ${mockFile}`);
    expect(out.text()).toContain("review it before committing");

    // The recording replays through the real task manager: t1, "Go deeper", t2, then the closing note.
    const replay = memoryStream();
    const folder = path.join(root, "replayed");
    const report = await runTask({
      harnessDir,
      action: "example",
      folder,
      input: lines("1\nq\n"),
      output: replay.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_MOCK_DIR: path.join(harnessDir, "mock"), HH_FAKE_MOCK_STATE: path.join(root, "replay-state.json") } },
    });
    expect(replay.text()).toContain("Hello, this harness is still being built.");
    expect(replay.text()).toContain("1. Go deeper");
    expect(replay.text()).toContain("Here is more.");
    expect(fs.readFileSync(report.notePath!, "utf8")).toContain('title: "First idea"');
  });

  it("refuses to overwrite an existing recording without --force, before the engine runs", { timeout: 60_000 }, async () => {
    await expect(
      runTask({ harnessDir, action: "example", record: true, input: lines("q\n"), output: memoryStream().stream, engineCommand: { command: ["/nonexistent-engine"], env: {} } }),
    ).rejects.toThrow(/already exists/);
    await runTask({ harnessDir, action: "example", record: true, force: true, input: lines("q\n"), output: memoryStream().stream, engineCommand: engineCommand() });
    expect(JSON.parse(fs.readFileSync(mockFile, "utf8")).turns.map((t: { id: string }) => t.id)).toEqual(["t1", "close"]);
  });
});

describe("run: input blocks", () => {
  const quizDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/input-harness");
  const quizScript: ClaudeScript = {
    steps: [...claudeTextLines("Done."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), result] },
      { match: "\\[answer to commit_answer\\]", steps: [...claudeTextLines("Two halves make one whole: well seen."), result] },
      { match: "# Task: practice", steps: [...claudeTextLines("First, commit."), ui("show_commit_answer", { question: "Who ate more?", options: ["Me", "Both the same"] }), result] },
    ],
  };

  it("a answers the pending question field by field; the chat keeps the answer on its block", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const folder = path.join(root, "quiz-work");
    await runTask({
      harnessDir: quizDir,
      action: "practice",
      engine: "claude",
      folder,
      input: lines("a\n2\nTwo halves are one whole\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, quizScript) } },
    });
    const text = out.text();
    expect(text).toContain("    Answer with a: I pick (choice), Why? In your own words (longText)");
    expect(text).toContain("a to answer, or type a follow-up, or q to close the task:");
    expect(text).toContain("  1. Me\n  2. Both the same\n");
    expect(text).toContain("> I pick: Both the same\n> \n> Why? In your own words: Two halves are one whole");
    expect(text).toContain("Two halves make one whole: well seen.");
    const chat = readJsonl(path.join(folder, ".harness", "chats", "main.jsonl"));
    const shown = chat.flatMap((e) => (e.blocks ?? []) as { name: string; id?: string; input?: { value: unknown } }[]).find((b) => b.name === "commit_answer");
    expect(shown?.id).toMatch(/:0:0$/);
    expect(shown?.input?.value).toEqual({ choice: "Both the same", why: "Two halves are one whole" });
    expect(chat.some((e) => e.role === "user" && e.text === "I pick: Both the same\n\nWhy? In your own words: Two halves are one whole")).toBe(true);
  });

  it("--record keeps the answer under the asking turn's respond, linked to the turn it led to", { timeout: 60_000 }, async () => {
    // A copy: recording writes mock/practice.json into the harness.
    const copy = path.join(root, "quiz-record");
    fs.cpSync(quizDir, copy, { recursive: true });
    // Its config imports zod and the SDK: resolve them as the fixture does.
    fs.symlinkSync(path.resolve(quizDir, "../../node_modules"), path.join(copy, "node_modules"), "dir");
    await runTask({
      harnessDir: copy,
      action: "practice",
      engine: "claude",
      folder: path.join(root, "quiz-record-work"),
      record: true,
      input: lines("a\n2\nTwo halves are one whole\nq\n"),
      output: memoryStream().stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, quizScript) } },
    });
    const rec = recordingSchema.parse(JSON.parse(fs.readFileSync(path.join(copy, "mock", "practice.json"), "utf8")));
    expect(rec.turns.map((t) => t.id)).toEqual(["t1", "t2", "close"]);
    expect(rec.turns[0].respond).toEqual([{ block: "commit_answer", value: { choice: "Both the same", why: "Two halves are one whole" }, next: "t2" }]);
    expect(rec.turns[0].next).toBeUndefined();
  });

  it("Ctrl-C while a field waits drops the answer and goes back to the prompt", { timeout: 60_000 }, async () => {
    const ctrlC = fakeInterrupts();
    const input = new PassThrough();
    const out = memoryStream();
    let prompts = 0;
    const output = watch(out, (text) => {
      if (text.includes("q to close the task")) {
        // First prompt: answer; second (back after the drop): Ctrl-C closes the task like q.
        if (++prompts === 1) input.write("a\n");
        else ctrlC.press();
      } else if (text.includes("I pick (optional) (number): ")) ctrlC.press();
    });
    const folder = path.join(root, "quiz-ctrl-c");
    await runTask({
      harnessDir: quizDir,
      action: "practice",
      engine: "claude",
      folder,
      input,
      output,
      interrupts: ctrlC,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, quizScript) } },
    });
    const text = out.text();
    expect(prompts).toBe(2);
    expect(text).toContain("Answer dropped.");
    expect(text).not.toContain("well seen");
    const chat = readJsonl(path.join(folder, ".harness", "chats", "main.jsonl"));
    const shown = chat.flatMap((e) => (e.blocks ?? []) as { name: string; input?: unknown }[]).find((b) => b.name === "commit_answer");
    expect(shown?.input).toBeUndefined();
    expect(ctrlC.listeners()).toBe(0);
  });
});

describe("run --set (harness settings)", () => {
  const tutor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/settings-harness");
  const tutorScript: ClaudeScript = {
    steps: [...claudeTextLines("Done."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
      { match: "# Task: practice", steps: [...claudeTextLines("One question."), result] },
    ],
  };

  it("stores the values before the task, and AGENTS.md carries their sentences", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-set");
    const out = memoryStream();
    await runTask({
      harnessDir: tutor,
      action: "practice",
      engine: "claude",
      folder,
      settings: { tone: "demanding", hintAfter: "4", examples: "true" },
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
    });
    // `examples: true` is the default: not stored.
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "data", "_app", "settings.json"), "utf8"))).toEqual({ tone: "demanding", hintAfter: 4 });
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("### How to work with this person\n\n- Use a Demanding tone.\n- Give a hint after 4 failed tries, not before.\n");
    expect(out.text()).toContain("Settings: tone=demanding, hintAfter=4, examples=true");
  });

  it("D0: without --set nothing is stored, and AGENTS.md has the defaults' sentences", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-plain");
    const out = memoryStream();
    await runTask({
      harnessDir: tutor,
      action: "practice",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
    });
    expect(fs.existsSync(path.join(folder, ".harness", "data"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("- Use a Patient tone.");
    expect(out.text()).not.toContain("Settings:");
  });

  it("parseSettings: the text as typed when the field takes it, else JSON; refuses unknown, invalid and settings-less", async () => {
    const { loadHarness } = await import("@humanharness/harness-sdk");
    const h = await loadHarness(path.join(tutor, "harness.config.ts"));
    expect(parseSettings(h.settings, { hintAfter: "3", tone: "neutral", nickname: "42" })).toEqual({ hintAfter: 3, tone: "neutral", nickname: "42" });
    // The typed text comes first: a text field keeps quotes that would read as a JSON string.
    expect(parseSettings(h.settings, { nickname: '"Bob"', examples: "false" })).toEqual({ nickname: '"Bob"', examples: false });
    expect(() => parseSettings(h.settings, { nope: "1" })).toThrow(UsageError);
    expect(() => parseSettings(h.settings, { nope: "1" })).toThrow('Unknown setting "nope". Settings: nickname, tone, examples, hintAfter.');
    expect(() => parseSettings(h.settings, { hintAfter: "9" })).toThrow('"9" is not a valid value for the setting "hintAfter".');
    expect(() => parseSettings(h.settings, { toString: "x" })).toThrow(/Unknown setting "toString"/);
    expect(() => parseSettings(undefined, { tone: "x" })).toThrow("This harness declares no settings: drop --set.");
    expect(parseSettings(undefined, {})).toEqual({});
  });

  it("the command line takes --set name=value, and refuses a pair with no name", async () => {
    for (const pair of ["tone", "=x"]) {
      const m = memoryIo(root);
      expect(await main(["run", "practice", "--harness", tutor, "--set", pair], m.io)).toBe(2);
      expect(m.err()).toContain("--set takes name=value");
    }
    // A known pair passes the command line and stops at the setting's own check, before any engine.
    const bad = memoryIo(root);
    expect(await main(["run", "practice", "--harness", tutor, "--set", "tone=x", "--set", "hintAfter=3"], bad.io)).toBe(2);
    expect(bad.err()).toContain('"x" is not a valid value for the setting "tone".');
    // `__proto__` is a name like any other: refused as unknown, never dropped.
    const proto = memoryIo(root);
    expect(await main(["run", "practice", "--harness", tutor, "--set", "__proto__=x"], proto.io)).toBe(2);
    expect(proto.err()).toContain('Unknown setting "__proto__"');
  });

  it("a settings file broken by hand stops the run with the store's message, not a stack", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-broken");
    fs.mkdirSync(path.join(folder, ".harness", "data", "_app"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "data", "_app", "settings.json"), "[1, 2]\n");
    const out = memoryStream();
    const run = runTask({
      harnessDir: tutor,
      action: "practice",
      engine: "claude",
      folder,
      settings: { tone: "demanding" },
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
    });
    await expect(run).rejects.toBeInstanceOf(CliError);
    await expect(run).rejects.toThrow(/was changed by hand/);
  });
});

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/modes-harness");
const coachScript: ClaudeScript = {
  steps: [...claudeTextLines("Done."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
    { match: 'From now on work in the mode "Worked examples"', steps: [...claudeTextLines("Step one."), result] },
    { match: 'From now on work in the mode "Feynman"', steps: [...claudeTextLines("Explain it to me."), result] },
    {
      match: "# Task: study",
      steps: [
        ...claudeTextLines("Let's pick a way."),
        ui("show_recommend_mode", {
          recommended: "socratic",
          reasons: ["One key idea."],
          alternatives: [
            { mode: "feynman", why: "To say it back." },
            { mode: "nope", why: "Not listed." },
          ],
        }),
        result,
      ],
    },
  ],
};
/** Runs the modes fixture's `study` action (the coach). */
const runCoach = (name: string, input: string, extra: { mode?: string } = {}) => {
  const out = memoryStream();
  const prompts = path.join(root, `${name}-prompts.jsonl`);
  const folder = path.join(root, name);
  const done = runTask({
    harnessDir: coach,
    action: "study",
    engine: "claude",
    folder,
    ...extra,
    input: lines(input),
    output: out.stream,
    engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, coachScript), HH_FAKE_PROMPTS: prompts } },
  });
  return { done, out, folder, prompts: () => readJsonl(prompts).map((p) => (p as { prompt: string }).prompt) };
};

describe("run: task modes", () => {
  it("recommends first, then `m <id>` switches in the same session; a tier refusal says so and goes on", { timeout: 60_000 }, async () => {
    const r = runCoach("coach-switch", "m feynman\nm feynman\nm nope\nm worked\nq\n");
    await r.done;
    const text = r.out.text();
    expect(text).toContain("Recommended mode: socratic");
    // An alternative the action doesn't list is dropped.
    expect(text).toContain("Or:\n    feynman: To say it back.\n  Type m <mode> to pick one.");
    expect(text).not.toContain("Not listed.");
    expect(text).toContain("m <mode> to switch mode");
    expect(text).toContain("Already in Feynman.");
    expect(text).toContain("Not switched (unknown). Modes: socratic, feynman, worked.");
    expect(text).toContain("Worked examples asks for the deep tier; this run is at standard. Switching anyway; rerun with --tier deep --mode worked for it.");
    const [first, feynman, worked, close] = r.prompts();
    expect(first).toContain("## How to work");
    expect(feynman).toContain('From now on work in the mode "Feynman"');
    expect(worked).toContain('From now on work in the mode "Worked examples"');
    expect(close).toContain("save_note");
    const usage = readJsonl(path.join(r.folder, ".harness", "usage.jsonl"));
    expect(usage.map((u) => u.mode)).toEqual([undefined, "feynman", "worked", "worked"]);
    const note = fs.readFileSync(path.join(r.folder, ".harness", "notes", "study.md"), "utf8");
    expect(note).toContain('modes: ["feynman","worked"]');
    // The chat keeps each switch as its short line, never the mode's prompt.
    const chat = readJsonl(path.join(r.folder, ".harness", "chats", "main.jsonl"));
    expect(chat.filter((e) => e.role === "user" && e.mode !== undefined).map((e) => e.text)).toEqual(["Switched to Feynman", "Switched to Worked examples"]);
  });

  it("`m` is a pick only before a single mode id; a refused or same pick keeps the choices", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const prompts = path.join(root, "coach-m-prompts.jsonl");
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
        { match: "# Task: study", steps: [...claudeTextLines("Here we go."), ui("show_choices", { options: [{ label: "Keep going" }] }), result] },
      ],
    };
    await runTask({
      harnessDir: coach,
      action: "study",
      engine: "claude",
      folder: path.join(root, "coach-m"),
      mode: "socratic",
      input: lines("m socratic\nm nope\n1\nm tell me more\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_PROMPTS: prompts } },
    });
    const text = out.text();
    expect(text).toContain("Already in Socratic.");
    expect(text).toContain("Not switched (unknown). Modes: socratic, feynman, worked.");
    const sent = readJsonl(prompts).map((p) => (p as { prompt: string }).prompt);
    expect(sent.slice(1, 3)).toEqual(["Keep going", "m tell me more"]);
    expect(sent).toHaveLength(4);
  });

  it("--mode starts in that mode, its brief and default settings after the action's", { timeout: 60_000 }, async () => {
    const r = runCoach("coach-mode", "q\n", { mode: "socratic" });
    await r.done;
    expect(r.prompts()[0]).toContain(
      "## Mode: Socratic\n\nWork in this mode.\n\nLead with questions; let the person find the idea before you name it. Answer in English.\n\n- Ask few questions before explaining.",
    );
    expect(JSON.parse(fs.readFileSync(path.join(r.folder, ".harness", "tasks.json"), "utf8")).actions).toEqual({ study: "done" });
  });

  it("refuses a mode the action doesn't list, before anything runs", async () => {
    await expect(runCoach("coach-bad", "q\n", { mode: "nope" }).done).rejects.toThrow('Unknown mode "nope" for study. Modes: socratic, feynman, worked.');
    expect(fs.existsSync(path.join(root, "coach-bad"))).toBe(false);
  });

  it("humanharness run parses --mode; a mode the action doesn't list exits 2", async () => {
    const m = memoryIo(root);
    expect(await main(["run", "study", "--mode", "Bad Mode", "--harness", coach], m.io)).toBe(2);
    expect(m.err()).toContain('Invalid mode "Bad Mode": use a mode id from the manifest.');
    const n = memoryIo(root);
    expect(await main(["run", "quiz", "--mode", "socratic", "--harness", coach], n.io)).toBe(2);
    expect(n.err()).toContain('Unknown mode "socratic" for quiz. Modes: (none).');
  });
});

describe("run: task phases (task-phases spec §6)", () => {
  const tutor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/phases-harness");
  const tutorScript: ClaudeScript = {
    steps: [...claudeTextLines("Listo."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Fractions", summary: ["x"], decisions: [], files: [], open: [] }), result] },
      { match: 'Next part of this task: "Close"', steps: [...claudeTextLines("Sum it up."), result] },
      { match: 'Next part of this task: "Main block"', steps: [...claudeTextLines("Main now."), ui("set_phase", { to: "close", reason: "Covered." }), result] },
      { match: "# Task: session", steps: [...claudeTextLines("What is a half?"), ui("set_phase", { to: "main", reason: "Recall done." }), result] },
    ],
  };
  const run = (name: string, input: string, extra: { time?: number } = {}) => {
    const out = memoryStream();
    const prompts = path.join(root, `${name}-prompts.jsonl`);
    const folder = path.join(root, name);
    const done = runTask({
      harnessDir: tutor,
      action: "session",
      engine: "claude",
      folder,
      ...extra,
      input: lines(input),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript), HH_FAKE_PROMPTS: prompts } },
    });
    return { done, out, folder, prompts: () => readJsonl(prompts).map((p) => (p as { prompt: string }).prompt) };
  };

  it("auto moves from the warm-up; a proposal prints with its command; >phase moves; the close part closes on q", { timeout: 60_000 }, async () => {
    const r = run("tutor-phases", ">phase close\nq\n");
    await r.done;
    const text = r.out.text();
    expect(text).toContain("— Main block —");
    expect(text).toContain("The AI proposes to move to Close: Covered. Type >phase close to go there.");
    expect(text).toContain(">phase <id> to change part");
    expect(text).toContain("— Close —");
    const [first, main, close, closing] = r.prompts();
    expect(first).toContain("## Parts of this task");
    expect(main.startsWith('Next part of this task: "Main block" (`main`).')).toBe(true);
    expect(close.startsWith('Next part of this task: "Close" (`close`).')).toBe(true);
    expect(closing).toContain("save_note");
    const usage = readJsonl(path.join(r.folder, ".harness", "usage.jsonl"));
    expect(usage.map((u) => [u.phase, u.taskPhase])).toEqual([
      ["run", "warmup"],
      ["phase-change", "main"],
      ["phase-change", "close"],
      ["close", "close"],
    ]);
  });

  it(">phase to the close part the task is in finishes it; a refused move says why", { timeout: 60_000 }, async () => {
    const r = run("tutor-finish", ">phase nope\n>phase close\n>phase close\n");
    await r.done;
    const text = r.out.text();
    expect(text).toContain("Not moved (unknown). Parts: warmup, main, close.");
    expect(text).toContain(`Note: ${path.join(r.folder, ".harness", "notes", "session.md")}`);
    expect(r.prompts().at(-1)).toContain("save_note");
    expect(JSON.parse(fs.readFileSync(path.join(r.folder, ".harness", "tasks.json"), "utf8")).current).toBeNull();
  });

  it("--time starts with a time box: the first message says the time; a length not offered is refused", { timeout: 60_000 }, async () => {
    const r = run("tutor-time", "q\n", { time: 30 });
    await r.done;
    expect(r.prompts()[0]).toContain("Time left: about 30 minutes.");
    await expect(run("tutor-bad-time", "q\n", { time: 20 }).done).rejects.toThrow('Unknown time box "20" for session. Lengths: 15, 30, 45.');
    expect(fs.existsSync(path.join(root, "tutor-bad-time"))).toBe(false);
  });

  it("--time: a line typed while the time box runs its own turn waits for it, then goes to the task", { timeout: 60_000 }, async () => {
    const prompts = path.join(root, "tutor-wrap-prompts.jsonl");
    const folder = path.join(root, "tutor-wrap");
    const input = new PassThrough();
    const out = memoryStream();
    // Typed as soon as the wrap-up starts: the app's turn runs while the line arrives.
    const output = watch(out, (text) => {
      if (text.includes("Time is almost up")) input.end("Tell me more\nq\n");
    });
    await runTask({
      harnessDir: tutor,
      action: "session",
      engine: "claude",
      folder,
      time: 15,
      // A 20 ms minute: the wrap-up is due about a quarter of a second in.
      minuteMs: 20,
      input,
      output,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript), HH_FAKE_PROMPTS: prompts } },
    });
    const sent = readJsonl(prompts).map((p) => (p as { prompt: string }).prompt);
    const wrap = sent.findIndex((p) => p.startsWith("Time is almost up:"));
    expect(wrap).toBeGreaterThan(-1);
    // The wrap-up, the move to the close part, then the person's line, then the closing turn.
    expect(sent[wrap + 1].startsWith('Next part of this task: "Close"')).toBe(true);
    expect(sent[wrap + 2]).toBe("Tell me more");
    expect(sent.at(-1)).toContain("save_note");
    expect(out.text()).toContain(`Note: ${path.join(folder, ".harness", "notes", "session.md")}`);
  });

  it("--time: a run that stops with the task open pauses its time box and leaves no timer behind", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-broken-input");
    const input = new PassThrough();
    const out = memoryStream();
    const output = watch(out, (text) => {
      if (text.includes("q to close the task")) input.destroy(new Error("The input broke"));
    });
    await expect(
      runTask({
        harnessDir: tutor,
        action: "session",
        engine: "claude",
        folder,
        time: 15,
        input,
        output,
        engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
      }),
    ).rejects.toThrow("The input broke");
    const current = JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8")).current;
    expect(current.timeBox).toMatchObject({ minutes: 15 });
    expect(current.timeBox).not.toHaveProperty("runningSince");
  });

  it("humanharness run refuses a --time that isn't whole minutes", async () => {
    const m = memoryIo(root);
    expect(await main(["run", "session", "--time", "half", "--harness", tutor], m.io)).toBe(2);
    expect(m.err()).toContain("--time takes minutes, such as 30.");
  });

  it("D0: an action without phases prints no part hint and >phase is a follow-up", { timeout: 60_000 }, async () => {
    // The coach fixture's study action has no phases.
    const r = runCoach("coach-no-phases", ">phase main\nq\n");
    await r.done;
    expect(r.out.text()).not.toContain(">phase <id>");
    expect(r.prompts()[1]).toBe(">phase main");
  });
});
