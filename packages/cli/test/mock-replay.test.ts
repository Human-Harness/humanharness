import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeClaudeCommand } from "@humanharness/fake-agent";
import { initHarness } from "../src/init";
import { runTask } from "../src/run";
import { CORE, memoryStream, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-mock-replay-");
afterAll(cleanup);
const harnessDir = path.join(root, "h");
const mockDir = path.join(root, "mock");
beforeAll(async () => {
  await initHarness({ dir: harnessDir, core: CORE, install: false });
  fs.mkdirSync(mockDir);
  fs.writeFileSync(
    path.join(mockDir, "example.json"),
    JSON.stringify({
      version: 1,
      action: "example",
      match: "# Task: example",
      fallback: { text: "Not recorded." },
      turns: [
        {
          id: "t1",
          text: "Hello from the recording.",
          delayMs: 0,
          blocks: [
            { tool: "show_example_card", input: { title: "One idea", body: "Keep it short." } },
            { tool: "show_choices", input: { options: [{ label: "Go deeper", followUp: "Tell me more." }] } },
          ],
          writes: [{ path: "idea.md", content: "an idea\n" }],
          usage: { input: 1000, output: 50 },
          next: { "Go deeper": "t2" },
        },
        { id: "t2", text: "Here is more.", delayMs: 0 },
        { id: "close", note: { title: "Recorded idea", summary: ["One idea"], decisions: [], files: [], open: [] } },
      ],
    }),
  );
});

const lines = (input: string) => {
  const s = new PassThrough();
  s.end(input);
  return s;
};

describe("fake-claude in mock mode", () => {
  it("plays the recording through the real task manager: blocks, choice, fallback, writes, note, usage", async () => {
    const out = memoryStream();
    const folder = path.join(root, "work");
    const report = await runTask({
      harnessDir,
      action: "example",
      folder,
      // 1 picks "Go deeper"; then an unrecorded line; then q closes.
      input: lines("1\nsomething else\nq\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_MOCK_DIR: mockDir, HH_FAKE_MOCK_STATE: path.join(root, "state.json") } },
    });
    const text = out.text();
    expect(text).toContain("Hello from the recording.");
    expect(text).toContain("[example_card]");
    expect(text).toContain("1. Go deeper");
    expect(text).toContain("Here is more.");
    expect(text).toContain("Not recorded.");
    expect(fs.readFileSync(path.join(folder, "idea.md"), "utf8")).toBe("an idea\n");
    expect(fs.readFileSync(report.notePath!, "utf8")).toContain('title: "Recorded idea"');
    expect(report.phases.run?.input).toBeGreaterThanOrEqual(1000);
  });

  /** Runs one throwaway recording through runTask with the given typed input. */
  async function playOne(name: string, turns: unknown[], typed: string, prep?: (folder: string) => void) {
    const dir = path.join(root, `mock-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "example.json"), JSON.stringify({ version: 1, action: "example", match: "# Task: example", turns }));
    const folder = path.join(root, `work-${name}`);
    fs.mkdirSync(folder, { recursive: true });
    prep?.(folder);
    const out = memoryStream();
    await runTask({
      harnessDir,
      action: "example",
      folder,
      input: lines(typed),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_MOCK_DIR: dir, HH_FAKE_MOCK_STATE: path.join(root, `state-${name}.json`) } },
    }).catch(() => undefined);
    return { folder, text: out.text(), state: path.join(root, `state-${name}.json`) };
  }

  it("a write with content null deletes the file", async () => {
    const { folder } = await playOne("delete", [{ id: "t1", text: "ok", delayMs: 0, writes: [{ path: "gone.md", content: null }] }], "q\n", (f) =>
      fs.writeFileSync(path.join(f, "gone.md"), "x"),
    );
    expect(fs.existsSync(path.join(folder, "gone.md"))).toBe(false);
  });

  it("a long text with delayMs > 0 still arrives whole", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const { text } = await playOne("long", [{ id: "t1", text: long, delayMs: 80 }], "q\n");
    expect(text).toContain(long);
  });

  it("a block the ui server rejects shows an error instead of crashing", async () => {
    const { text, state } = await playOne("badblock", [{ id: "t1", text: "hi", delayMs: 0, blocks: [{ tool: "no_such_tool", input: {} }] }], "q\n");
    expect(text).toContain("mock: ");
    expect(text).toContain("no_such_tool");
    expect(fs.existsSync(state)).toBe(false);
  });

  it("refuses a write that leaves the folder through a symlink", async () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside, { recursive: true });
    const { text } = await playOne("symlink", [{ id: "t1", text: "hi", delayMs: 0, writes: [{ path: "link/x.md", content: "nope" }] }], "q\n", (f) =>
      fs.symlinkSync(outside, path.join(f, "link")),
    );
    expect(fs.existsSync(path.join(outside, "x.md"))).toBe(false);
    expect(text).toContain("symlink");
  });
});
