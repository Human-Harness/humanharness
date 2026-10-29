import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta, ToolsManifest } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readToolsJson } from "../../src/main/tools/tools-json";

let root: string;
let logs: string[];
const log = (m: string) => void logs.push(m);

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-json-pre-")));
  logs = [];
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const TOOLS = { "due-today": "./tools/due-today.ts", "warmup-cards": "./tools/warmup-cards.ts" };
const manifest = (actions: ToolsManifest["actions"]): ToolsManifest => ({ permissions: { edit: "folder", exec: false, web: false }, data: {}, tools: TOOLS, ...(actions ? { actions } : {}) });

function meta(id: string, over: Partial<ToolMeta> = {}): ToolMeta {
  return { description: "Lists the cards due today, oldest first", agent: "call", uses: {}, params: { type: "object", properties: {} }, timeout: 30, file: `tools/${id}.js`, ...over };
}
async function writeJson(tools: Record<string, ToolMeta>): Promise<void> {
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools }));
}

describe("readToolsJson: pre and expects against tools.json (tools spec §3.3)", () => {
  it("a pre-step's input from a tool without returns: off with its message, logged once", async () => {
    await writeJson({ "due-today": meta("due-today"), "warmup-cards": meta("warmup-cards") });
    const s = await readToolsJson(root, manifest({ study: { pre: [{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }] } }), log);
    expect(s).toEqual({ on: false, reason: 'study: pre[1]: input "today": due-today declares no returns' });
    expect(logs).toEqual(['Tools are off: study: pre[1]: input "today": due-today declares no returns']);
  });

  it("expects naming an agent: none tool: off", async () => {
    await writeJson({ "due-today": meta("due-today", { agent: "none" }), "warmup-cards": meta("warmup-cards") });
    const s = await readToolsJson(root, manifest({ study: { phases: [{ id: "close", expects: ["due-today"] }] } }), log);
    expect(s).toEqual({ on: false, reason: 'study: phase close: expects "due-today" is a tool the agent can\'t call (agent: "none")' });
  });

  it("valid pre-steps: tools on", async () => {
    const tools = { "due-today": meta("due-today", { returns: { type: "array", items: { type: "string" } } }), "warmup-cards": meta("warmup-cards") };
    await writeJson(tools);
    const s = await readToolsJson(root, manifest({ study: { pre: [{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }] } }), log);
    expect(s).toEqual({ on: true, tools });
    expect(logs).toEqual([]);
  });

  it("toolProblems come first: a tool problem is the reason even with a pre problem", async () => {
    await writeJson({ "due-today": meta("due-today", { uses: { exec: [{ cmd: "gh", args: [] }] } }), "warmup-cards": meta("warmup-cards") });
    const s = await readToolsJson(root, manifest({ study: { pre: [{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }] } }), log);
    expect(s).toEqual({ on: false, reason: "due-today: uses.exec needs permissions.exec" });
  });
});
