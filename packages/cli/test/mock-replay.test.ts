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
});
