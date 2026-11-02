import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { type HarnessWorkspace, createWorkspace } from "@humanharness/runtime";
import type { TaskPreset } from "../src/main/engine-config/engine-host";
import { instructionSubagentsOption } from "../src/main/instruction-subagents";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-isub-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const NOTES = path.resolve(__dirname, "../../fake-agent/fixtures/notes-harness/harness.config.ts");
let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  await ws?.close();
  ws = undefined;
});

const withAgents: TaskPreset = { preset: { hash: "h", base: "claude", servers: [], agentsFile: "/x/agents.json" } as never, instructions: "", notice: null };
const without: TaskPreset = { preset: { hash: "h", base: "claude", servers: [] } as never, instructions: "", notice: null };

/** The option as the shell builds it, with a fake engine host answering `got` for the open scope "intro". */
function option(got: TaskPreset | null, extra: { boardMode?: boolean; scope?: string | null } = {}) {
  return instructionSubagentsOption({
    engineHost: () => (got ? { presetFor: async () => got } : undefined),
    currentScope: async () => (extra.scope === undefined ? "intro" : extra.scope),
    boardMode: () => extra.boardMode ?? false,
  });
}

/** Whether the managed AGENTS.md a real workspace writes with this option (and the manifest's setting) has the part. */
async function hasPart(instructionSubagents: () => Promise<boolean>, subagents?: boolean): Promise<boolean> {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(base, "Work");
  const loaded = await loadHarness(NOTES);
  ws = await createWorkspace({
    harness: subagents === undefined ? loaded : { ...loaded, permissions: { ...loaded.permissions, subagents } },
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(base, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [] }) },
    instructionSubagents,
  });
  const text = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
  await ws.close();
  ws = undefined;
  return text.includes("### Subagents");
}

describe("instructionSubagents wiring (the open scope's preset)", () => {
  it("a preset with agentsFile puts the Subagents part in AGENTS.md", async () => {
    expect(await hasPart(option(withAgents))).toBe(true);
  });

  it("no agentsFile in the preset, no preset, or no enginePresets: the part is absent", async () => {
    expect(await hasPart(option(without))).toBe(false);
    expect(await hasPart(option({ preset: null, instructions: "", notice: "unapproved" }))).toBe(false);
    expect(await hasPart(option(null))).toBe(false);
  });

  it("an explicit manifest false wins over a preset with agentsFile", async () => {
    expect(await hasPart(option(withAgents), false)).toBe(false);
  });

  it("manifest true still writes it without a preset", async () => {
    expect(await hasPart(option(without), true)).toBe(true);
  });

  it("no open scope, board mode, or a failure read as no", async () => {
    expect(await option(withAgents, { scope: null })()).toBe(false);
    expect(await option(withAgents, { boardMode: true })()).toBe(false);
    const failing = instructionSubagentsOption({
      engineHost: () => ({ presetFor: async () => Promise.reject(new Error("x")) }),
      currentScope: async () => "intro",
      boardMode: () => false,
    });
    expect(await failing()).toBe(false);
  });
});
