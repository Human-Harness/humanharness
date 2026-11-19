import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { EngineSession, SidekickSession } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-es-rt-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 100_000 };
const result = (text: string) => ({ line: { type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });

function fakeClaude(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "c-"));
  const argsFile = path.join(dir, "args.json");
  return { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_ARGS: argsFile }, args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], folder: dir };
}

describe("EngineSession: the generic tool-less session (mods 1a)", () => {
  it("Sidekick's session and a mod's engine run are the same primitive", () => {
    expect(SidekickSession).toBe(EngineSession);
  });

  it("one tool-less turn in its own folder: the text and the usage", async () => {
    const fake = fakeClaude({ steps: [...claudeTextLines("hello"), result("hello")] });
    const s = new EngineSession({ engine: getEngine("claude"), command: fake.command, env: fake.env, folder: fake.folder, profile });
    const a = await s.ask("a mod's prompt", new AbortController().signal);
    expect(a).toMatchObject({ ok: true, text: "hello", usage: { inputTokens: 10, outputTokens: 2 } });
    expect(fake.args()).toContain("--tools");
    await s.close();
  });
});
