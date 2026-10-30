import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type JobStep, type ToolMeta, type ToolsManifest, z } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readToolsJson } from "../../src/main/tools/tools-json";

let root: string;
let logs: string[];
const log = (m: string) => void logs.push(m);

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-json-recipes-")));
  logs = [];
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const TOOLS = { "open-prs": "./tools/open-prs.ts", "pr-ci": "./tools/pr-ci.ts", "apply-triage": "./tools/apply-triage.ts" };
/** The manifest main reads, with one job `sync` whose steps are given. */
const manifest = (steps: JobStep[]) => ({
  permissions: { edit: "folder" as const, exec: false, web: false },
  data: {},
  tools: TOOLS,
  jobs: { sync: { label: "Sync", on: { manual: true }, steps } },
});
const ai = (output: z.ZodObject = z.object({ ids: z.array(z.string()) })): JobStep => ({ ai: "./jobs/classify.md", input: ["ci"], output, as: "triage", tier: "light" });

function meta(id: string, over: Partial<ToolMeta> = {}): ToolMeta {
  return { description: "Reads the CI runs of the open pull requests", agent: "call", uses: {}, params: { type: "object", properties: {} }, timeout: 30, file: `tools/${id}.js`, ...over };
}
const LIST = { type: "array", items: { type: "object" } };
async function writeJson(tools: Record<string, ToolMeta>): Promise<void> {
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools }));
}
const ALL = () => ({ "open-prs": meta("open-prs"), "pr-ci": meta("pr-ci", { returns: LIST }), "apply-triage": meta("apply-triage") });

describe("readToolsJson: job recipes against tools.json (tools spec §3.3)", () => {
  it("a post-step reading a tool without returns: off with its message, logged once", async () => {
    await writeJson(ALL());
    const s = await readToolsJson(root, manifest([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", as: "ci" }, ai(), { tool: "apply-triage", input: ["prs"] }]), log);
    expect(s).toEqual({ on: false, reason: 'Job "sync": steps[3]: input "prs": open-prs declares no returns' });
    expect(logs).toEqual(['Tools are off: Job "sync": steps[3]: input "prs": open-prs declares no returns']);
  });

  it("an AI step output that can't convert to JSON Schema: off with a reason, no throw", async () => {
    await writeJson(ALL());
    const s = await readToolsJson(root, manifest([{ tool: "pr-ci", as: "ci" }, ai(z.object({ at: z.date() })), { tool: "apply-triage", input: ["triage"] }]), log);
    expect(s).toEqual({ on: false, reason: "Job \"sync\": steps[1]: the AI step's output must convert to JSON Schema (no dates, transforms or other types JSON can't hold)" });
    expect(logs).toHaveLength(1);
  });

  it("a valid recipe: tools on", async () => {
    const tools = ALL();
    await writeJson(tools);
    const s = await readToolsJson(root, manifest([{ tool: "pr-ci", as: "ci" }, ai(), { tool: "apply-triage", input: ["triage"] }]), log);
    expect(s).toEqual({ on: true, tools });
    expect(logs).toEqual([]);
  });

  it("pre-step problems come first: stepProblems before recipes", async () => {
    await writeJson(ALL());
    const m: ToolsManifest & ReturnType<typeof manifest> = {
      ...manifest([{ tool: "open-prs", as: "prs" }, { tool: "apply-triage", input: ["prs"] }]),
      actions: { study: { pre: [{ tool: "open-prs", as: "today" }, { tool: "apply-triage", input: ["today"] }] } },
    };
    const s = await readToolsJson(root, m, log);
    expect(s).toEqual({ on: false, reason: 'study: pre[1]: input "today": open-prs declares no returns' });
  });

  it("D0: prompt jobs only (main reads no steps): tools on as before", async () => {
    const tools = ALL();
    await writeJson(tools);
    const s = await readToolsJson(root, { ...manifest([]), jobs: { sync: { permissions: { exec: false } } } }, log);
    expect(s).toEqual({ on: true, tools });
  });
});
