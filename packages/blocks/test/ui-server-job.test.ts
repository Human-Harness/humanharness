import path from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_CANNOT_ASK, JOB_NO_NOTE, JOB_RESULT_TOOL } from "@humanharness/harness-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockMessage, type Bridge, devLauncher, openBridge, uiServerSpec } from "../src";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const INPUT_FIXTURE = path.resolve(here, "../../fake-agent/fixtures/input-harness/harness.config.ts");
const PHASES_FIXTURE = path.resolve(here, "../../fake-agent/fixtures/phases-harness/harness.config.ts");
const MODES_FIXTURE = path.resolve(here, "../../fake-agent/fixtures/modes-harness/harness.config.ts");

let bridge: Bridge | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await bridge?.close();
  client = undefined;
  bridge = undefined;
});

/** Starts the real `ui` server binary, as a job slot does (`HH_JOB=1`) or as a task slot does (no `HH_JOB`). */
async function connect(received: BlockMessage[], harnessConfig: string, job: boolean) {
  bridge = await openBridge((m) => received.push(m));
  const spec = uiServerSpec({ harnessConfig, bridge: { path: bridge.path, token: bridge.token }, launcher: devLauncher() });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...spec.env };
  if (job) env.HH_JOB = "1";
  else delete env.HH_JOB;
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env }));
  return client;
}

const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();
const textOf = (r: Record<string, unknown>) => (r.content as { text: string }[])[0].text;

/** Minimal valid arguments, so a refusal comes from job mode and not from the schema. */
const ASKS: { tool: string; fixture: string; args: Record<string, unknown>; text: string }[] = [
  { tool: "show_choices", fixture: FIXTURE, args: { options: [{ label: "Go on" }] }, text: JOB_CANNOT_ASK },
  {
    tool: "save_note",
    fixture: FIXTURE,
    args: { title: "T", summary: ["a"], decisions: [], files: [], open: [] },
    text: JOB_NO_NOTE,
  },
  { tool: "set_phase", fixture: PHASES_FIXTURE, args: { to: "main", reason: "Warm-up done" }, text: JOB_CANNOT_ASK },
  { tool: "show_commit_answer", fixture: INPUT_FIXTURE, args: { question: "Who ate more?" }, text: JOB_CANNOT_ASK },
  // The person picks a recommended mode: a job has no one to pick.
  { tool: "show_recommend_mode", fixture: MODES_FIXTURE, args: { recommended: "socratic", reasons: ["One key idea"] }, text: JOB_CANNOT_ASK },
];

describe("ui server in job mode (parallel spec §8, J1)", () => {
  it("D0: without HH_JOB, the tool list is exactly today's", async () => {
    expect(await names(await connect([], FIXTURE, false))).toEqual(["save_note", "show_choices", "show_note", "update_progress"]);
    await client?.close();
    await bridge?.close();
    expect(await names(await connect([], INPUT_FIXTURE, false))).toEqual([
      "save_note",
      "show_annotate",
      "show_card",
      "show_choices",
      "show_commit_answer",
      "show_summary",
    ]);
    await client?.close();
    await bridge?.close();
    expect(await names(await connect([], PHASES_FIXTURE, false))).not.toContain(JOB_RESULT_TOOL);
  });

  it("D0: without HH_JOB, choices still reach the bridge", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, FIXTURE, false);
    const r = await c.callTool({ name: "show_choices", arguments: { options: [{ label: "Go on" }] } });
    expect(r.isError).toBeFalsy();
    expect(received).toEqual([{ name: "choices", data: { options: [{ label: "Go on" }] } }]);
  });

  it("job mode adds job_result and keeps every other tool name", async () => {
    expect(await names(await connect([], FIXTURE, true))).toEqual(["job_result", "save_note", "show_choices", "show_note", "update_progress"]);
  });

  it("job_result reaches the bridge as a block named job_result", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, FIXTURE, true);
    const r = await c.callTool({ name: JOB_RESULT_TOOL, arguments: { status: "ok", summary: "Synced 3 tickets" } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe("Done: the result is recorded. End your turn now.");
    expect(received).toEqual([{ name: "job_result", data: { status: "ok", summary: "Synced 3 tickets" } }]);
  });

  it("job_result rejects a result that breaks its schema and forwards nothing", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, FIXTURE, true);
    const r = await c.callTool({ name: JOB_RESULT_TOOL, arguments: { status: "maybe", summary: "" } }).catch(() => ({ isError: true }));
    expect(r.isError).toBe(true);
    expect(received).toEqual([]);
  });

  it("job_result answers with a tool error when the bridge is down", async () => {
    const c = await connect([], FIXTURE, true);
    await bridge?.close();
    const r = await c.callTool({ name: JOB_RESULT_TOOL, arguments: { status: "failed", summary: "No access" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Could not reach the app \(.+\)\.$/);
  });

  it.each(ASKS)("refuses $tool with the spec's message and sends nothing", async ({ tool, fixture, args, text }) => {
    const received: BlockMessage[] = [];
    const c = await connect(received, fixture, true);
    const r = await c.callTool({ name: tool, arguments: args });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe(text);
    expect(received).toEqual([]);
  });

  it("still forwards a block that does not ask the person", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, FIXTURE, true);
    const r = await c.callTool({ name: "update_progress", arguments: { percent: 5 } });
    expect(r.isError).toBeFalsy();
    expect(received).toEqual([{ name: "progress", data: { percent: 5 } }]);
  });
});
