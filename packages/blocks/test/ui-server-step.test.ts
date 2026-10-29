import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_RESULT_TOOL, STEP_OUTPUT_TOOL, loadHarness, z } from "@humanharness/harness-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockMessage, type Bridge, devLauncher, openBridge, uiServerSpec } from "../src";
import { stepServer } from "../src/ui-server";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECIPE = path.resolve(here, "fixtures/recipe-harness/harness.config.ts");

let bridge: Bridge | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await bridge?.close();
  client = undefined;
  bridge = undefined;
});

/** Starts the real `ui` server binary with these extra env keys (a key set to undefined is removed). */
async function connect(received: BlockMessage[], extra: Record<string, string | undefined>) {
  bridge = await openBridge((m) => received.push(m));
  const spec = uiServerSpec({ harnessConfig: RECIPE, bridge: { path: bridge.path, token: bridge.token }, launcher: devLauncher() });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...spec.env };
  delete env.HH_JOB;
  delete env.HH_STEP;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env }));
  return client;
}

/** Runs the `ui` server binary to its exit (it never connects): the exit code and what it wrote to stderr. */
function runBin(step: string): { status: number | null; stderr: string } {
  const spec = uiServerSpec({ harnessConfig: RECIPE, bridge: { path: "/nowhere", token: "t" }, launcher: devLauncher() });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...spec.env, HH_STEP: step };
  delete env.HH_JOB;
  const r = spawnSync(spec.command, spec.args, { env, encoding: "utf8", input: "", timeout: 30_000 });
  return { status: r.status, stderr: r.stderr };
}

const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();
const textOf = (r: Record<string, unknown>) => (r.content as { text: string }[])[0].text;

describe("the ui server's step mode (tools spec §7.1, R1)", () => {
  it("D0: without step the tools are as before", async () => {
    // The recipe harness declares no block: a task's ui server has the core blocks alone, a job's adds job_result.
    const task = await names(await connect([], {}));
    expect(task).toEqual(["save_note", "show_choices"]);
    await client?.close();
    await bridge?.close();
    const job = await names(await connect([], { HH_JOB: "1" }));
    expect(job).toEqual([JOB_RESULT_TOOL, ...task].sort());
    expect(job).not.toContain(STEP_OUTPUT_TOOL);
  });

  it("with HH_STEP=<job> the only tool is step_output, its input schema the job's output", async () => {
    const { tools } = await (await connect([], { HH_STEP: "triage" })).listTools();
    expect(tools.map((t) => t.name)).toEqual([STEP_OUTPUT_TOOL]);
    const schema = tools[0].inputSchema as { properties: Record<string, { type?: string; items?: { type?: string } }>; required?: string[] };
    expect(schema.properties.ids).toMatchObject({ type: "array", items: { type: "string" } });
    expect(schema.properties.again).toMatchObject({ type: "boolean" });
    expect([...(schema.required ?? [])].sort()).toEqual(["again", "ids"]);
  });

  it("HH_STEP wins over HH_JOB: a step slot is never a job's", async () => {
    expect(await names(await connect([], { HH_STEP: "triage", HH_JOB: "1" }))).toEqual([STEP_OUTPUT_TOOL]);
  });

  it("a valid call reaches the bridge as a block step_output and answers 'Done'", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, { HH_STEP: "triage" });
    const r = await c.callTool({ name: STEP_OUTPUT_TOOL, arguments: { ids: ["a"], again: false } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe("Done: the result is recorded. End your turn now.");
    expect(received).toEqual([{ name: STEP_OUTPUT_TOOL, data: { ids: ["a"], again: false } }]);
  });

  it("an invalid call is refused by the schema and never reaches the bridge", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, { HH_STEP: "triage" });
    const r = await c.callTool({ name: STEP_OUTPUT_TOOL, arguments: { ids: ["a"], again: "yes" } }).catch(() => ({ isError: true }));
    expect(r.isError).toBe(true);
    expect(received).toEqual([]);
  });

  it("a block's tool is not there to call", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, { HH_STEP: "triage" });
    const r = await c.callTool({ name: "show_choices", arguments: { options: [{ label: "Go on" }] } }).catch(() => ({ isError: true }));
    expect(r.isError).toBe(true);
    expect(received).toEqual([]);
  });

  it("answers with a tool error when the bridge is down", async () => {
    const c = await connect([], { HH_STEP: "triage" });
    await bridge?.close();
    const r = await c.callTool({ name: STEP_OUTPUT_TOOL, arguments: { ids: [], again: true } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Could not reach the app \(.+\)\.$/);
  });

  it("HH_STEP naming no recipe job with an AI step exits with an error", () => {
    const r = runBin("nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No AI step for job "nope"');
  });

  it("HH_STEP empty is no step mode", async () => {
    expect(await names(await connect([], { HH_STEP: "" }))).toEqual(["save_note", "show_choices"]);
  });

  it("HH_STEP that isn't a job id exits with an error", () => {
    for (const bad of ["../x", "Triage", "a b", "constructor"]) {
      const r = runBin(bad);
      if (bad === "constructor") {
        // A job id by shape but not an own job: never a prototype key.
        expect(r.status, bad).toBe(1);
        expect(r.stderr).toContain('No AI step for job "constructor"');
      } else {
        expect(r.status, bad).toBe(1);
        expect(r.stderr).toContain("HH_STEP is not a job id");
      }
    }
  });

  it("fails closed when the AI step's output has no JSON Schema", async () => {
    const harness = await loadHarness(RECIPE);
    const jobs = harness.jobs as Record<string, { steps?: unknown[] }>;
    const steps = jobs.triage.steps as Record<string, unknown>[];
    // A manifest check refuses such an output at load; the server never trusts that it ran.
    const broken = { ...harness, jobs: { triage: { ...jobs.triage, steps: [steps[0], { ...steps[1], output: z.object({ at: z.date() }) }] } } } as unknown as typeof harness;
    expect(() => stepServer(broken, "triage", { path: "/nowhere", token: "t" })).toThrow(
      'The AI step\'s output of job "triage" can\'t be a tool\'s input',
    );
  });
});
