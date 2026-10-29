import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkCommand, checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { TOOL_P12_NOTE } from "../src/tool-host-node";
import { testTools } from "../src/tool-test";
import { CORE, dropExampleTool, memoryIo, memoryStream, read, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-template-tool-");
afterAll(cleanup);
const dir = path.join(root, "fresh");
beforeAll(async () => {
  await initHarness({ dir, core: CORE, install: false });
}, 60_000);

describe("the template's example tool (tools spec §11)", () => {
  it("a harness made with init has word-count and its fixture", () => {
    expect(fs.statSync(path.join(dir, "tools", "word-count.ts")).isFile()).toBe(true);
    expect(JSON.parse(read(dir, "tools/word-count/fixtures/basic.json"))).toEqual({
      args: { path: "notes/a.md" },
      files: { "notes/a.md": "one two  three\nfour" },
      expect: { result: { path: "notes/a.md", words: 4 } },
    });
    expect(read(dir, "harness.config.ts")).toContain('tools: { "word-count": "./tools/word-count.ts" }');
    expect(read(dir, "HARNESS.md")).toContain("|---|---|---|---|\n| (example) counting words | Code | word-count | the agent doesn't spend a turn counting |\n");
  });

  it("check on a fresh init passes, running the fixture", { timeout: 60_000 }, async () => {
    const notes: string[] = [];
    const r = await checkHarness(dir, { fixtures: { note: (line) => notes.push(line) } });
    expect(r.findings).toEqual([]);
    expect(notes).toEqual([TOOL_P12_NOTE]);
    const m = memoryIo(dir);
    expect(await checkCommand([], m.io)).toBe(0);
    expect(m.out()).toBe(`${TOOL_P12_NOTE}\nNo problems found.\n`);
    expect(m.err()).toBe("");
  });

  it("tool test word-count passes", { timeout: 60_000 }, async () => {
    const out = memoryStream();
    const reports = await testTools(dir, { tool: "word-count", out: out.stream });
    expect(reports.map((r) => r.tool)).toEqual(["word-count"]);
    expect(reports[0].skipped).toEqual([]);
    expect(reports[0].cases.map((c) => [c.file, c.ok, c.why])).toEqual([["basic.json", true, undefined]]);
  });

  it("dropExampleTool (the D0 pins' harness) takes the tool out entirely", { timeout: 60_000 }, async () => {
    const plain = path.join(root, "plain");
    await initHarness({ dir: plain, core: CORE, install: false });
    dropExampleTool(plain);
    expect(read(plain, "harness.config.ts")).not.toMatch(/\btools: |word-count/);
    expect(read(plain, "HARNESS.md")).toContain("| Moment | Code or AI | Tool or step | Why |\n|---|---|---|---|\n\n## Context");
    expect(fs.existsSync(path.join(plain, "tools"))).toBe(false);
  });
});
