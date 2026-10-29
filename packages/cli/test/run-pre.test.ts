import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { initHarness } from "../src/init";
import { runTask } from "../src/run";
import { CORE, memoryStream, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-run-pre-");
afterAll(cleanup);
let n = 0;

const NOTICE = "Pre-steps are not run in the terminal yet.";
const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
};
const script: ClaudeScript = {
  steps: [...claudeTextLines("Done."), result],
  turns: [
    { match: "save_note", steps: [{ mcp: { server: "ui", tool: "save_note", args: { title: "x", summary: ["x"], decisions: [], files: [], open: [] } } }, result] },
    { match: "# Task: example", steps: [...claudeTextLines("First turn here."), result] },
  ],
};
const tool = `import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: "Lists the cards due today.",
  params: z.object({}),
  returns: z.array(z.string()),
  uses: { files: "read" },
  async run() {
    return ["card one"];
  },
});
`;

/** The template with one tool, and `pre` on its action when `withPre`. */
async function fixture(withPre: boolean): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  replaceIn(dir, "harness.config.ts", "  actions: {\n", '  tools: { "due-today": "./tools/due-today.ts" },\n  actions: {\n');
  if (withPre) replaceIn(dir, "harness.config.ts", '      tier: "standard",\n', '      tier: "standard",\n      pre: [{ tool: "due-today", as: "today" }],\n');
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tools", "due-today.ts"), tool);
  return dir;
}

/** Runs the example action to its close; returns what it printed and the prompts the engine got. */
async function run(harnessDir: string) {
  const out = memoryStream();
  const prompts = path.join(root, `prompts-${++n}.jsonl`);
  const input = new PassThrough();
  input.end("q\n");
  await runTask({
    harnessDir,
    action: "example",
    engine: "claude",
    folder: path.join(root, `work-${n}`),
    input,
    output: out.stream,
    engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_PROMPTS: prompts } },
  });
  const sent = fs.readFileSync(prompts, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { prompt: string }).prompt);
  return { text: out.text(), first: sent[0] };
}

describe("run: pre-steps (tools Decision 18)", () => {
  it("runs the pre-steps and prints no notice", { timeout: 60_000 }, async () => {
    // Slice 5 Task 8: the terminal runs pre-steps, so slice 3's notice is gone and the first message has the section.
    const { text, first } = await run(await fixture(true));
    expect(text).not.toContain(NOTICE);
    expect(first).toContain("# Task: example");
    expect(first).toContain("## Prepared data");
    expect(first).toContain("card one");
  });

  it("D0: an action without pre prints nothing new", { timeout: 60_000 }, async () => {
    const { text, first } = await run(await fixture(false));
    expect(text).not.toContain("Pre-steps");
    expect(text).toContain("First turn here.");
    expect(first).not.toContain("Prepared data");
  });
});
